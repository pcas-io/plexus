#!/usr/bin/env bash
# Bootstrap a .env from .env.example with fresh secrets.
#
# Replaces (not appends) the four placeholder lines so the resulting
# .env has each variable exactly once.
#
# Usage:
#   scripts/bootstrap_env.sh           # refuses to overwrite an existing .env
#   scripts/bootstrap_env.sh --force   # overwrites

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)

FORCE=0
case "${1:-}" in
  --force) FORCE=1 ;;
  "") ;;
  *) echo "Unknown argument: $1" >&2; exit 64 ;;
esac

TEMPLATE="$REPO_ROOT/.env.example"
ENV_FILE="$REPO_ROOT/.env"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "Missing $TEMPLATE — nothing to bootstrap from." >&2
  exit 1
fi

if [[ -f "$ENV_FILE" && $FORCE -eq 0 ]]; then
  echo "$ENV_FILE already exists. Re-run with --force to overwrite." >&2
  exit 1
fi

if ! command -v openssl &> /dev/null; then
  echo "openssl not found in PATH." >&2
  exit 1
fi

cp "$TEMPLATE" "$ENV_FILE"

# In-place replace via awk — portable across BSD (macOS) and GNU sed,
# no temp-file shenanigans for the caller.
replace() {
  local key=$1
  local value=$2
  local tmp
  tmp=$(mktemp)
  awk -v key="$key" -v value="$value" '
    BEGIN { re = "^" key "=" }
    $0 ~ re { print key "=" value; next }
    { print }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

replace PLEXUS_ADMIN_TOKEN   "$(openssl rand -hex 32)"
replace PLEXUS_OAUTH_SECRET  "$(openssl rand -hex 32)"
replace PLEXUS_COOKIE_SECRET "$(openssl rand -hex 32)"
replace PLEXUS_SURREAL_PASS  "$(openssl rand -hex 24)"

# Sanity: exactly one line per secret, no placeholders left.
count=$(grep -cE "^PLEXUS_(ADMIN_TOKEN|OAUTH_SECRET|COOKIE_SECRET|SURREAL_PASS)=" "$ENV_FILE" || true)
if [[ "$count" != "4" ]]; then
  echo "Expected 4 secret lines in $ENV_FILE, found $count. Aborting." >&2
  exit 1
fi
if grep -qE "replace-with|change-me" "$ENV_FILE"; then
  echo "Placeholders still present after substitution. Inspect $ENV_FILE." >&2
  exit 1
fi

chmod 600 "$ENV_FILE"
echo "Wrote $ENV_FILE with fresh secrets (chmod 600)."
