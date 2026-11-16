# Deploying SynergiFund

SynergiFund runs on the EC2 server under pm2: the API (`synergifund-api`) and the website (`synergifund-web`).
A deploy puts what is on `main` on GitHub live, in one go:

- **One click:** GitHub › Actions › **Deploy to EC2** › Run workflow.
- **Or on the server:** `cd ~/synergyfund && npm run deploy`

Either way it runs `deploy.sh` on the server, which:

1. Gets the latest code (`git pull`), and installs packages only when they changed.
2. Builds the website into a folder the site isn't using (`apps/web/.next-a` and `.next-b` in turn). If the build
   fails, the site is left exactly as it was.
3. Starts the API and the website with pm2 (`ecosystem.config.cjs`), or restarts them on the new code, and waits
   until both answer: the API at `/health`, the website's sign-in page.
4. Runs `npm run db:encrypt` when encryption is on (see ENCRYPTION.md), as after every update.

It prints each step. It ends with `Done: <commit> is live` and the `pm2 ls` table, or with `Deploy stopped:` and the
reason.

## Setting it up (once)

### 1. The first deploy, on the server

```bash
cd ~/synergyfund && git pull && npm run deploy
```

This replaces the pm2 processes the old command restarted (`pm2 restart 0 1`) with the two named ones. It finds them
because they run from this folder. It saves pm2's list, makes pm2 start SynergiFund again when the server restarts,
and rotates pm2's logs so they never fill the disk (pm2-logrotate: 10 MB a file, 30 files kept).

From then on, use the names: `pm2 restart synergifund-api synergifund-web`, not `0 1`.

If pm2 can't set up starting with the server by itself (the server user can't use sudo without a password), the
deploy says so: run `pm2 startup` once and then the command it prints.

### 2. The GitHub button

GitHub signs in to the server over SSH with a key of its own.

1. **Make the key.** On the Mac:

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/synergifund_deploy -N "" -C "github-deploy"
   ```

   Then add `~/.ssh/synergifund_deploy.pub` to the server's `~/.ssh/authorized_keys` (one line at the end).

2. **Read the server's own key**, so each run can check it reached the right server:

   ```bash
   ssh-keyscan -t ed25519 <server address>
   ```

3. **Add the secrets.** On GitHub, go to the repository › Settings › Secrets and variables › Actions › New
   repository secret. Or with `gh` from the repository folder:

   ```bash
   gh secret set EC2_HOST --body "<server address>"
   gh secret set EC2_USER --body "ubuntu"
   gh secret set EC2_SSH_KEY < ~/.ssh/synergifund_deploy
   ssh-keyscan -t ed25519 <server address> | gh secret set EC2_KNOWN_HOSTS
   ```

   `EC2_HOST` is the server's Elastic IP or domain name. If the checkout isn't `~/synergyfund`, set a variable (not a
   secret) `EC2_APP_DIR` to its folder.

4. **Let GitHub reach the server.** In the server's EC2 security group, port 22 must accept GitHub's runners. If SSH
   only accepts your own IP, the button can't connect. Either open port 22 more widely (an EC2 server accepts keys
   only, never passwords, unless someone changed that), or keep using `npm run deploy` over your own SSH.

5. **Click it:** Actions › Deploy to EC2 › Run workflow. It deploys `main` as it is on GitHub, whichever branch the
   form shows. A second click while one runs waits for the first to finish.

## Every day

| To | Run on the server |
| --- | --- |
| Deploy | the button, or `npm run deploy` |
| See what runs | `pm2 ls` |
| Read the logs | `pm2 logs synergifund-api` or `pm2 logs synergifund-web --lines 100` |
| Restart without deploying | `pm2 restart synergifund-api synergifund-web` |

The website listens on port 3007 (`WEB_PORT` changes it) and the API on `PORT` from `.env` (4000 if not set). Nginx
and HTTPS in front of them stay as they are. MongoDB isn't run by pm2: the API connects to `MONGODB_URI` from `.env`.

## When a deploy stops

- **The website didn't build:** the site wasn't changed. Fix the code, push, and deploy again.
- **The API or the website didn't come up in 2 minutes:** the deploy prints the app's last log lines. The new code
  is in place but not answering. Fix and deploy again. To go back to the version before, revert the commit on GitHub,
  then deploy.
- **`git pull` did not work:** something was changed in the checkout on the server. `git status` there shows what.
- **Another deploy is running:** wait for it. If none is running, an earlier one was cut short: remove
  `.deploy.lock` in the checkout and deploy again.

## Where things are

- `deploy.sh`: the deploy itself.
- `ecosystem.config.cjs`: how pm2 runs the two apps. One process each: the API keeps live chat, calls and its
  background jobs in memory, so it must never run twice.
- `.github/workflows/deploy.yml`: the button.
- `apps/web/.next-live`: names the website build in use (`.next-a` or `.next-b`). The other folder holds the build
  before it, until the next deploy. After the first deploy, the old `apps/web/.next` isn't used any more and can be
  deleted. A build made by hand (`npm run build -w @synergifund/web`) goes into the folder in use, as it always did.
