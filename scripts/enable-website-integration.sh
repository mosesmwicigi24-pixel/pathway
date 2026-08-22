#!/usr/bin/env bash
#
# Switch on the two nuruplace.org integrations: enquiries (migration 201) and
# giving (migration 202).
#
# Both are authenticated by an HMAC over the raw request body, so each needs the
# SAME secret written into two files on two sides of the box:
#
#     /opt/pathway/.env     WEBSITE_CONTACT_WEBHOOK_SECRET  ─┐ must match
#     /srv/nuruplace/.env   CONTACT_WEBHOOK_SECRET          ─┘
#
#     /opt/pathway/.env     WEBSITE_GIVING_WEBHOOK_SECRET   ─┐ must match
#     /srv/nuruplace/.env   PATHWAY_GIVING_SECRET           ─┘
#
# Getting one pair out of step produces a 401 on every submission, which reads
# as "the website is broken" rather than "the secrets differ". So this generates
# each secret ONCE and writes both ends from the same variable.
#
#   ./enable-website-integration.sh            # do it
#   ./enable-website-integration.sh --check    # verify only, change nothing
#
# Re-runnable. An existing secret is REUSED, never rotated: rotating one side
# without the other is exactly the failure above, and a re-run is usually
# somebody checking rather than somebody wanting new keys. Use --rotate to
# deliberately replace both pairs.
#
# It never prints a secret. They are written to files that only root can read.
set -uo pipefail

API_DIR=${API_DIR:-/opt/pathway}
WEB_DIR=${WEB_DIR:-/srv/nuruplace}
WEB_OWNER=${WEB_OWNER:-nuruplace}
API_BASE=${API_BASE:-https://pathway.nuruplace.org/v1}
SITE_BASE=${SITE_BASE:-https://nuruplace.org}
COMPOSE_API=(docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml)

MODE=apply
case "${1:-}" in
  --check)  MODE=check ;;
  --rotate) MODE=rotate ;;
  "")       ;;
  *) echo "usage: $0 [--check|--rotate]" >&2; exit 2 ;;
esac

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
say()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
fail() { red "FAILED: $*"; exit 1; }

# ---------------------------------------------------------------------------
# .env editing
# ---------------------------------------------------------------------------

# Read a value without evaluating the file. Sourcing a .env runs whatever is in
# it, and these files hold passwords with characters a shell would happily
# interpret.
envval() {
  local file=$1 key=$2
  [ -f "$file" ] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -1
}

# Set (or replace) one key, leaving every other line byte for byte as it was.
#
# Deliberately NOT `sed -i "s/^KEY=.*/KEY=$val/"`. The values here include URLs
# full of slashes and a password containing `/`, `&` and `\`, every one of which
# means something to sed's replacement parser. The first version of this
# function used a control character as the delimiter and got it wrong — bash
# does not expand \x01 inside double quotes, so sed received a literal backslash
# as its delimiter, errored, and CHANGED NOTHING. envset reported success. With
# --rotate that would have written a new secret to the website and left the old
# one on the API: the exact drift this script exists to prevent.
#
# Rewriting the file has no delimiter to get wrong.
envset() {
  local file=$1 key=$2 val=$3 tmp
  touch "$file" || { red "cannot write $file"; return 1; }
  tmp=$(mktemp) || return 1
  # Keys are [A-Z_]+, so no regex metacharacter can appear in the pattern.
  # grep exits 1 when it filters everything out, which is not an error here.
  grep -v "^${key}=" "$file" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  # cat rather than mv: keeps the file's existing owner and mode, which matters
  # because box-deploy.sh reads /srv/nuruplace/.env as the nuruplace user.
  cat "$tmp" > "$file" || { rm -f "$tmp"; red "cannot write $file"; return 1; }
  rm -f "$tmp"
}

# ---------------------------------------------------------------------------
# Probes
# ---------------------------------------------------------------------------

# curl already prints 000 when it cannot connect, AND exits non-zero. An
# `|| echo 000` on the end therefore appends a SECOND 000, and the caller sees
# "000000" — which falls through to the unexpected-status branch and reports
# "expected 401 or 503" for what is really "nothing answered". Swallow the exit
# code instead of adding to the output.
status_of() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@" 2>/dev/null) || true
  printf '%s' "${code:-000}"
}

# Is a signed intake configured?
#
# An UNSIGNED POST tells us, without writing anything or sending a payment
# request to anyone:
#
#   503  the handler read its secret as unset — it is not reaching the container
#   401  the secret is set; the endpoint is refusing an unsigned body, as it must
#   000  nothing answered (nginx down, wrong host, container not up)
#
# This works because both handlers check the secret BEFORE verifying the
# signature. If that order ever changes, this probe silently becomes useless —
# which is why intake_verdict names the codes rather than testing "not 503".
intake_status() {
  status_of -X POST "$1" -H 'content-type: application/json' -d '{}'
}

intake_verdict() {
  case "$1" in
    401) grn "  configured (refuses an unsigned request, which is correct)"; return 0 ;;
    503) red "  NOT configured — the secret is not reaching the container"; return 1 ;;
    000) red "  no answer at all — is the API up and is nginx proxying it?";  return 1 ;;
    *)   red "  unexpected HTTP $1 — expected 401 (configured) or 503 (not)";  return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Check mode
# ---------------------------------------------------------------------------

run_checks() {
  local bad=0

  say "Secrets match across the two .env files"
  local a b
  for pair in "WEBSITE_CONTACT_WEBHOOK_SECRET:CONTACT_WEBHOOK_SECRET" \
              "WEBSITE_GIVING_WEBHOOK_SECRET:PATHWAY_GIVING_SECRET"; do
    a=$(envval "$API_DIR/.env" "${pair%%:*}")
    b=$(envval "$WEB_DIR/.env" "${pair##*:}")
    if [ -z "$a" ] || [ -z "$b" ]; then
      red "  ${pair%%:*} / ${pair##*:}: one or both are unset"; bad=1
    elif [ "$a" = "$b" ]; then
      grn "  ${pair%%:*} == ${pair##*:}"
    else
      # Never print either value; the fact they differ is the whole message.
      red "  ${pair%%:*} != ${pair##*:} — every submission will 401"; bad=1
    fi
  done

  say "Does the API actually have them? (unsigned probe — writes nothing)"
  echo "enquiries intake:"
  intake_verdict "$(intake_status "$API_BASE/webhooks/website-contact")" || bad=1
  echo "giving intake:"
  intake_verdict "$(intake_status "$API_BASE/webhooks/website-giving")"  || bad=1

  say "Can a visitor actually give? (public funds endpoint)"
  local funds
  funds=$(curl -s --max-time 15 "$API_BASE/giving/funds" 2>/dev/null || echo '')
  if [ -z "$funds" ]; then
    red "  /giving/funds did not answer"; bad=1
  elif printf '%s' "$funds" | grep -q '"key":"mpesa","label":"M-Pesa","enabled":true'; then
    grn "  M-Pesa is wired; $(printf '%s' "$funds" | grep -o '"code"' | wc -l) funds offered"
  else
    # Not a failure of THIS script — giving is switched on, but Daraja is not
    # configured, so /give will honestly say so rather than show a dead form.
    red "  M-Pesa reports enabled:false — set MPESA_CONSUMER_KEY / _SECRET /"
    red "  MPESA_PASSKEY / MPESA_SHORTCODE in $API_DIR/.env. Until then"
    red "  nuruplace.org/give shows its 'not switched on yet' panel."
    bad=1
  fi

  say "What the website is serving"
  local give_page
  give_page=$(curl -s --max-time 20 "$SITE_BASE/en/give" 2>/dev/null || echo '')
  if [ -z "$give_page" ]; then
    red "  /en/give did not answer"; bad=1
  elif printf '%s' "$give_page" | grep -q 'name="phone"'; then
    grn "  /en/give is serving the real form"
  else
    red "  /en/give is serving the fallback panel, not the form"; bad=1
  fi

  return $bad
}

if [ "$MODE" = check ]; then
  run_checks && { say "All checks pass."; exit 0; }
  say "Some checks failed — see above."
  exit 1
fi

# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------

[ "$(id -u)" -eq 0 ] || fail "run as root: the .env files and compose are root-owned"
[ -d "$API_DIR" ]    || fail "$API_DIR not found (set API_DIR=)"
[ -d "$WEB_DIR" ]    || fail "$WEB_DIR not found (set WEB_DIR=)"

say "Secrets"
for pair in "WEBSITE_CONTACT_WEBHOOK_SECRET:CONTACT_WEBHOOK_SECRET" \
            "WEBSITE_GIVING_WEBHOOK_SECRET:PATHWAY_GIVING_SECRET"; do
  api_key=${pair%%:*}; web_key=${pair##*:}
  existing=$(envval "$API_DIR/.env" "$api_key")
  if [ -n "$existing" ] && [ "$MODE" != rotate ]; then
    secret=$existing
    echo "  $api_key: keeping the existing value (use --rotate to replace)"
  else
    secret=$(openssl rand -hex 32) || fail "openssl rand failed"
    echo "  $api_key: generated"
  fi
  # Both ends from ONE variable — the only way they cannot drift.
  envset "$API_DIR/.env" "$api_key" "$secret"
  envset "$WEB_DIR/.env" "$web_key" "$secret"
  unset secret existing
done

# The website also needs to know WHERE to post. Without it the form is
# unconfigured no matter how good the secret is.
envset "$WEB_DIR/.env" CONTACT_WEBHOOK_URL "$API_BASE/webhooks/website-contact"
envset "$WEB_DIR/.env" PATHWAY_API_URL     "$API_BASE"
echo "  website endpoints pointed at $API_BASE"

# box-deploy.sh runs git as $WEB_OWNER; a root-written .env it cannot read would
# leave the deploy reading an empty port and health URL.
chown "$WEB_OWNER":"$WEB_OWNER" "$WEB_DIR/.env" 2>/dev/null || true
chmod 600 "$API_DIR/.env" "$WEB_DIR/.env"

say "API: migrate, then restart"
cd "$API_DIR" || fail "cannot cd $API_DIR"
"${COMPOSE_API[@]}" pull --quiet api worker || fail "pull failed"
# Migrations BEFORE the new code starts. 201 and 202 add the tables and columns
# the new handlers query; an api that boots first would 500 on every request to
# them until this ran.
"${COMPOSE_API[@]}" run --rm migrate      || fail "migrations failed — NOT restarting the api"
# --no-deps: postgres, redis and pgbouncer are healthy and shared; recreating
# them would take the whole platform down to add two environment variables.
"${COMPOSE_API[@]}" up -d --force-recreate --no-deps api worker || fail "api restart failed"

say "Website: let the deploy timer pick up the new .env"
# box-deploy.sh recreates on a changed git ref or image digest — NOT on a
# changed .env, which it only reads. So nudge it directly rather than waiting
# for a tick that would legitimately decide nothing had changed.
cd "$WEB_DIR" || fail "cannot cd $WEB_DIR"
if [ -x scripts/box-deploy.sh ]; then
  ./scripts/box-deploy.sh || echo "  (box-deploy reported non-zero; checks below will say whether it matters)"
fi
web_files=$(sed -n 's/^COMPOSE_FILES=//p' "$WEB_DIR/.env" | tail -1)
# shellcheck disable=SC2206  # deliberate word splitting: it is a file list
web_arr=(${web_files:-docker-compose.yml docker-compose.vps.yml})
web_compose=(docker compose)
for f in "${web_arr[@]}"; do web_compose+=(-f "$f"); done
"${web_compose[@]}" up -d --no-deps web || fail "website restart failed"

say "Verifying"
sleep 5
if run_checks; then
  say "Both integrations are on."
  echo "The website now delivers enquiries into Website ▸ Enquiries in the portal,"
  echo "and /give sends M-Pesa payment requests through Pathway's ledger."
  exit 0
fi
say "Applied, but something is not right — see the failures above."
exit 1
