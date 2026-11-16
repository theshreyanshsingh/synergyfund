// How pm2 runs SynergiFund on a server: the API and the web app, each started again if it stops. deploy.sh
// (npm run deploy) starts them and brings them up to date; DEPLOY.md says how.
//
// Each runs as one process. The API keeps live chat, calls and its background jobs (backups, the Agent's reading and
// summaries, repeating prompts) in memory, so it must never run twice.
const fs = require("node:fs")
const path = require("node:path")

const root = __dirname
const web = path.join(root, "apps/web")

// The API's port: the server's own setting, else the PORT line in .env (the API reads .env itself), else 4000.
function apiPort() {
  if (process.env.PORT) return process.env.PORT
  try {
    const lines = [...fs.readFileSync(path.join(root, ".env"), "utf8").matchAll(/^\s*PORT\s*=\s*["']?(\d+)/gm)]
    return lines.length ? lines[lines.length - 1][1] : "4000"
  } catch {
    return "4000"
  }
}

// Next.js as the web app installed it (node_modules is shared by the whole repository).
function nextBin() {
  try {
    return require.resolve("next/dist/bin/next", { paths: [web] })
  } catch {
    return path.join(root, "node_modules/next/dist/bin/next")
  }
}

// Started again after a crash, a little later each time it crashes straight away, and given 8 seconds to finish
// what it is doing when it is stopped. Log lines are timed.
const always = { exec_mode: "fork", instances: 1, autorestart: true, min_uptime: "20s", max_restarts: 15, exp_backoff_restart_delay: 500, kill_timeout: 8000, time: true }

module.exports = {
  apps: [
    {
      name: "synergifund-api",
      cwd: path.join(root, "apps/api"),
      script: path.join(root, "apps/api/src/index.js"),
      env: { NODE_ENV: "production" },
      ...always,
    },
    {
      name: "synergifund-web",
      cwd: web,
      script: nextBin(),
      // The site's port (3007, as npm start in apps/web has it; WEB_PORT changes it). It passes /api and live chat
      // on to the API at API_URL, which is the API's port on this server unless set otherwise.
      args: `start --port ${process.env.WEB_PORT || "3007"}`,
      env: { NODE_ENV: "production", API_URL: process.env.API_URL || `http://127.0.0.1:${apiPort()}` },
      ...always,
    },
  ],
}
