#!/usr/bin/env bash
# Upload + publish a new version to an EXISTING Chrome Web Store item.
# First listing must be manual (dashboard only) — API cannot create items.
# Usage: SECRETS=~/.config/echolike/store-secrets.env bin/publish-cws.sh build/echolike-2.8.0-chrome.zip
set -euo pipefail
ZIP="${1:?usage: publish-cws.sh ZIPFILE}"
S="${SECRETS:-$HOME/.config/echolike/store-secrets.env}"
# shellcheck disable=SC1090
source "$S"
: "${CWS_CLIENT_ID:?missing} ${CWS_CLIENT_SECRET:?missing} ${CWS_REFRESH_TOKEN:?missing} ${CWS_APP_ID:?missing: do the first dashboard upload, then fill CWS_APP_ID}"
ATOKEN="$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d client_id="$CWS_CLIENT_ID" -d client_secret="$CWS_CLIENT_SECRET" \
  -d refresh_token="$CWS_REFRESH_TOKEN" -d grant_type=refresh_token \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("access_token",""))')"
[ -n "$ATOKEN" ] || { echo "token refresh failed"; exit 1; }
echo "uploading $ZIP..."
curl -s -X PUT "https://www.googleapis.com/upload/chromewebstore/v1.1/items/$CWS_APP_ID?uploadType=media" \
  -H "Authorization: Bearer $ATOKEN" -H "x-goog-api-version: 2" \
  --data-binary "@$ZIP" | python3 -m json.tool | head -n 8
echo "publishing..."
curl -s -X POST "https://www.googleapis.com/chromewebstore/v1.1/items/$CWS_APP_ID/publish?publishTarget=default" \
  -H "Authorization: Bearer $ATOKEN" -H "x-goog-api-version: 2" -H "Content-Length: 0" \
  | python3 -m json.tool | head -n 8
