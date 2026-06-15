# Deployment — green PR → live on the Hostinger VPS

Continuous deployment for the Nuru Pathway backend.

## How it works

```
 PR ──▶ CI "validate" must pass ──▶ merge to main
                                         │  (branch protection blocks un-green merges)
                                         ▼
                              push to main triggers:
                         build ─▶ image pushed to GHCR (tagged with commit SHA)
                                         │
                                         ▼
                         deploy ─▶ SSH to VPS ─▶ docker compose pull
                                              ─▶ run migrations (migrate:up)
                                              ─▶ docker compose up -d   (live)
```

- **Image registry:** `ghcr.io/mosesmwicigi24-pixel/pathway-backend`, tagged `sha-<commit>` (immutable, used for the live deploy) and `latest`.
- **The VPS never compiles.** It pulls the prebuilt image. Only deploy *config* (`docker-compose.prod.yml`, `Caddyfile`) is refreshed from git on the VPS.
- **TLS:** Caddy obtains/renews a Let's Encrypt cert for `$DOMAIN` automatically.
- Pipeline: [.github/workflows/ci.yml](../.github/workflows/ci.yml). Live stack: [docker-compose.prod.yml](../docker-compose.prod.yml).

## One-time setup

### 1. GitHub repository secrets

Set these (Settings → Secrets and variables → Actions, or `gh secret set NAME`):

| Secret | What | Example |
|---|---|---|
| `VPS_HOST` | VPS IP or hostname | `203.0.113.10` |
| `VPS_USER` | SSH user used to deploy | `deploy` |
| `VPS_SSH_KEY` | **Private** SSH key (full PEM) the Action uses to log in | contents of `~/.ssh/id_ed25519` |
| `VPS_SSH_PORT` | SSH port | `22` |
| `DEPLOY_PATH` | Path of the repo checkout on the VPS | `/opt/pathway` |

```bash
gh secret set VPS_HOST     --body "203.0.113.10"
gh secret set VPS_USER     --body "deploy"
gh secret set VPS_SSH_PORT --body "22"
gh secret set DEPLOY_PATH  --body "/opt/pathway"
gh secret set VPS_SSH_KEY  < ~/.ssh/id_ed25519     # the PRIVATE key
```

`GITHUB_TOKEN` (used to push to and pull from GHCR) is provided automatically — no secret needed.

### 2. The VPS

```bash
# Docker + compose plugin
curl -fsSL https://get.docker.com | sh

# Deploy user (or use an existing one) and authorize the PUBLIC key whose
# private half you stored in VPS_SSH_KEY
adduser --disabled-password deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh && nano /home/deploy/.ssh/authorized_keys   # paste public key

# Clone the repo to DEPLOY_PATH
git clone https://github.com/mosesmwicigi24-pixel/pathway.git /opt/pathway
cd /opt/pathway

# Production secrets — create .env from the template, fill in real values
cp .env.prod.example .env
nano .env       # set DOMAIN, POSTGRES_PASSWORD, JWT_SIGNING_KEY
```

### 3. DNS

Point an **A record** for your `DOMAIN` at the VPS IP. Caddy needs ports **80 and 443** open (it serves the ACME challenge on 80). Confirm the VPS firewall allows them.

### 4. Branch protection (the "only green PRs" gate)

```bash
gh api -X PUT repos/mosesmwicigi24-pixel/pathway/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=validate' \
  -f 'enforce_admins=true' \
  -f 'required_pull_request_reviews[required_approving_review_count]=0' \
  -f 'restrictions=null'
```

This makes `validate` a required check and requires changes to go through a PR, so nothing un-green can land on `main` (and therefore nothing un-green can deploy).

### 5. First deploy

Merge any PR to `main` (or push), and the `build` + `deploy` jobs run. To do the very first deploy by hand on the VPS:

```bash
cd /opt/pathway
echo "$GHCR_PAT" | docker login ghcr.io -u mosesmwicigi24-pixel --password-stdin   # a PAT with read:packages
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml run --rm migrate    # migrations only
# Optional one-time reference data (5 levels, 4 funds) — NOT the dev/demo users:
#   docker compose -f docker-compose.prod.yml run --rm migrate sh -lc "pnpm seed"
docker compose -f docker-compose.prod.yml up -d
```

## Operations

```bash
# On the VPS, in DEPLOY_PATH:
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f caddy   # TLS / cert issues

# Roll back to a previous version (images are tagged by commit SHA):
BACKEND_IMAGE=ghcr.io/mosesmwicigi24-pixel/pathway-backend:sha-<older-sha> \
  docker compose -f docker-compose.prod.yml up -d api worker
```

## Notes / caveats

- **GHCR visibility:** the image package is private by default. The Action pulls it on the VPS using the run's `GITHUB_TOKEN`. If a pull ever fails with `denied`, either make the package public (Package settings → Change visibility) or `docker login ghcr.io` on the VPS with a PAT that has `read:packages`.
- **Database backups:** Postgres data lives in the `pgdata` Docker volume. Set up a periodic `pg_dump` (cron) — a single-VPS DB has no redundancy.
- **Secrets** live only in the VPS `.env` and GitHub Secrets; never commit them (§5.10).
- The `hostinger-vps` Docker *context* on your laptop (pointing at the VPS over SSH) is optional — handy for running `docker compose -f docker-compose.prod.yml ...` against the VPS from your machine once its IP is set.
