#!/usr/bin/env bash
# Submit to Firefox AMO (works for first submission too) via web-ext.
# Usage: SECRETS=~/.config/echolike/store-secrets.env bin/publish-amo.sh [listed|unlisted]
set -euo pipefail
CHANNEL="${1:-listed}"
S="${SECRETS:-$HOME/.config/echolike/store-secrets.env}"
# shellcheck disable=SC1090
source "$S"
: "${AMO_JWT_ISSUER:?missing} ${AMO_JWT_SECRET:?missing}"
command -v web-ext >/dev/null || npm i -g web-ext
web-ext sign --source-dir build/firefox --channel "$CHANNEL" \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET" \
  --timeout 300000
