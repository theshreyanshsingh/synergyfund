#!/usr/bin/env bash
# Puts the latest SynergiFund from GitHub live on this server, in one go: npm run deploy (or bash deploy.sh) in this
# folder, or the "Deploy to EC2" button on GitHub (.github/workflows/deploy.yml). DEPLOY.md says how to set it up.
#
#   1. Gets the latest code (git pull), and installs packages when they changed.
#   2. Builds the web app in a folder the site is not using, so the site keeps running, untouched, if the build fails.
#   3. Starts the API and the web app with pm2 (ecosystem.config.cjs), or restarts them on the new code, and waits
#      until both answer.
#   4. Encrypts records saved before encryption was on (npm run db:encrypt), as after every update.
#
# WEB_PORT: the site's port (3007). The API's port is the PORT line in .env (4000).

# Node and pm2 installed with nvm are only on the PATH of a login shell, and the GitHub button's SSH session is not one.
if ! command -v node >/dev/null 2>&1 && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
fi

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$ROOT/apps/web"
APPS=(synergifund-api synergifund-web)
WEB_PORT="${WEB_PORT:-3007}"
cd "$ROOT"

step() { printf '\n==> %s\n' "$*"; }
fail() {
  printf '\nDeploy stopped: %s\n' "$*" >&2
  exit 1
}
# pm2's list of processes as JSON ([] when it has none, or cannot say).
processes() { pm2 jlist 2>/dev/null || echo "[]"; }

command -v node >/dev/null 2>&1 || fail "Node.js is not installed here (or not on the PATH)."
command -v git >/dev/null 2>&1 || fail "git is not installed here."
command -v curl >/dev/null 2>&1 || fail "curl is not installed here."
if ! command -v pm2 >/dev/null 2>&1; then
  step "Installing pm2"
  npm install -g pm2 || fail "pm2 could not be installed. Install it with: sudo npm install -g pm2"
fi

# One deploy at a time: a second click while one runs stops here.
LOCK="$ROOT/.deploy.lock"
mkdir "$LOCK" 2>/dev/null || fail "another deploy is running. (If none is, one was cut short: remove $LOCK and try again.)"
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

# The API's port, as the API itself reads it: the server's own setting, else the PORT line in .env, else 4000.
API_PORT="${PORT:-}"
if [ -z "$API_PORT" ] && [ -f .env ]; then
  API_PORT="$(sed -nE 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*["'\'']?([0-9]+).*/\1/p' .env | tail -n 1)"
fi
API_PORT="${API_PORT:-4000}"
# (The web app is built and run passing live chat and /api on to it.)
export API_URL="${API_URL:-http://127.0.0.1:$API_PORT}"

step "Getting the latest code"
before="$(git rev-parse HEAD)"
git pull --ff-only || fail "git pull did not work, so nothing was changed. Run git status here: a change made on this server may be in the way."
after="$(git rev-parse HEAD)"
git log -1 --format='%h %s' | cut -c1-110

# (--include=dev: the web build needs Tailwind, also where NODE_ENV=production is set for the whole server.)
if [ ! -d node_modules ]; then
  step "Installing packages"
  npm ci --include=dev --no-audit --no-fund
elif [ "$before" != "$after" ] && ! git diff --quiet "$before" "$after" -- package.json package-lock.json 'apps/*/package.json' 'packages/*/package.json'; then
  step "Installing the packages that changed"
  npm install --include=dev --no-audit --no-fund
  # (Left as committed, so the next git pull is never blocked by it.)
  git diff --quiet -- package-lock.json || git checkout -- package-lock.json
fi

live="$(cat "$WEB/.next-live" 2>/dev/null || true)"
case "$live" in
  .next-a) next=.next-b ;;
  *) next=.next-a ;;
esac
step "Building the web app (into apps/web/$next, while the site keeps running)"
rm -rf "${WEB:?}/$next"
# (The last build's cache makes this one quicker.)
if [ -d "$WEB/${live:-.next}/cache" ]; then
  mkdir -p "$WEB/$next"
  cp -R "$WEB/${live:-.next}/cache" "$WEB/$next/cache"
fi
NEXT_DIST_DIR="$next" npm run build -w @synergifund/web || fail "the web app did not build, so the site was not changed. The error is above."
printf '%s\n' "$next" > "$WEB/.next-live"

step "Starting the API and the web app with pm2"
# The processes started by hand before this file existed (the ones "pm2 restart 0 1" restarted) run from this folder
# under other names, and they hold the same ports: they are replaced by these, once.
earlier="$(processes | node -e '
  let raw = ""
  process.stdin.on("data", (chunk) => (raw += chunk)).on("end", () => {
    let list = []
    try { list = JSON.parse(raw.slice(raw.indexOf("["))) } catch {}
    const [root, ...ours] = process.argv.slice(1)
    for (const item of list) {
      const cwd = String(item.pm2_env?.pm_cwd || "")
      if (!ours.includes(item.name) && (cwd === root || cwd.startsWith(`${root}/`))) console.log(`${item.pm_id} ${item.name}`)
    }
  })
' "$ROOT" "${APPS[@]}")"
if [ -n "$earlier" ]; then
  while read -r id name; do
    echo "Replacing pm2 process $id ($name), which ran SynergiFund from this folder before"
    pm2 delete "$id" >/dev/null
  done <<< "$earlier"
fi
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save >/dev/null

# Each app is up once pm2 has kept it running for 10 seconds and it answers: the API at /health, the site's sign-in
# page. (A process that keeps stopping again, for example because its port is taken, is not up however the port answers.)
step "Waiting for the API (port $API_PORT) and the site (port $WEB_PORT) to answer"
state() {
  processes | node -e '
    let raw = ""
    process.stdin.on("data", (chunk) => (raw += chunk)).on("end", () => {
      let list = []
      try { list = JSON.parse(raw.slice(raw.indexOf("["))) } catch {}
      const item = list.find((entry) => entry.name === process.argv[1])
      const env = item?.pm2_env || {}
      console.log(env.status === "online" && Date.now() - env.pm_uptime > 10000 ? "up" : `${env.status || "not started"}, restarted ${env.restart_time || 0} times`)
    })
  ' "$1"
}
encryption=""
for app in "${APPS[@]}"; do
  ready=""
  for _ in $(seq 1 60); do
    if [ "$(state "$app")" = "up" ]; then
      if [ "$app" = synergifund-api ]; then
        health="$(curl -fsS -m 5 "http://127.0.0.1:$API_PORT/health" 2>/dev/null || true)"
        case "$health" in *'"ok":true'*) ready=1 ;; esac
        case "$health" in *'"encryption":"on"'*) encryption=on ;; esac
      elif curl -fsS -m 15 -o /dev/null "http://127.0.0.1:$WEB_PORT/login" 2>/dev/null; then
        ready=1
      fi
    fi
    [ -n "$ready" ] && break
    sleep 2
  done
  if [ -z "$ready" ]; then
    pm2 logs "$app" --lines 40 --nostream 2>&1 | tail -n 60 || true
    now="$(state "$app")"
    [ "$now" = up ] && now="it is running but does not answer" || now="pm2 says it is $now"
    fail "$app did not come up in 2 minutes ($now). Its last log lines are above."
  fi
  echo "$app is up"
done

# Housekeeping, once per server: pm2 starts both again after the server restarts, and its logs are rotated so they
# never fill the disk.
if command -v systemctl >/dev/null 2>&1 && ! systemctl is-enabled --quiet "pm2-$(whoami)" 2>/dev/null; then
  if sudo -n true 2>/dev/null; then
    step "Making pm2 start SynergiFund when the server starts"
    sudo env PATH="$PATH" "$(command -v pm2)" startup systemd -u "$(whoami)" --hp "$HOME" >/dev/null
    pm2 save >/dev/null
  else
    echo "To have SynergiFund start again after the server restarts, run pm2 startup once and the command it prints."
  fi
fi
if [ ! -d "${PM2_HOME:-$HOME/.pm2}/modules/pm2-logrotate" ]; then
  step "Rotating pm2's logs (pm2-logrotate)"
  pm2 install pm2-logrotate >/dev/null 2>&1 || echo "pm2-logrotate could not be installed, so pm2's logs are kept whole."
fi

if [ "$encryption" = on ]; then
  step "Encrypting records saved before encryption was on"
  npm run db:encrypt || fail "the new version is live, but encrypting older records did not work (the error is above). Run npm run db:encrypt here once it is fixed."
fi

step "Done: commit $(git log -1 --format='%h') is live"
pm2 ls
