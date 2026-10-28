#!/usr/bin/env bash
# Build 3 distribution flavors from this source tree.
#   selfhost : update_url + key (Edge/Quetta sideload via echolike.app)
#   chrome   : no update_url/key (Chrome Web Store upload)
#   firefox  : no update_url/key, keeps gecko id (addons.mozilla.org upload)
# Usage: bin/build-flavors.sh 2.8.0
set -euo pipefail
VER="${1:?usage: build-flavors.sh VERSION}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
INBOX_HOSTS="https://echolike-inbox.pastasjuan.workers.dev/*"
SRC=(manifest.json background.js content.js content.css popup.html popup.js options.html options.js icons _locales)

rm -rf "$DIR/build"; mkdir -p "$DIR/build"
for flavor in selfhost chrome firefox; do
  B="$DIR/build/$flavor"; mkdir -p "$B"
  cp -r "${SRC[@]/#/$DIR/}" "$B/"
  python3 - "$B/manifest.json" "$flavor" "$VER" "$INBOX_HOSTS" <<'EOF'
import json, sys
p, flavor, ver, hosts = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split()
m = json.load(open(p))
m["version"] = ver
hp = m.get("host_permissions", [])
for h in hosts:
    if h not in hp: hp.append(h)
m["host_permissions"] = hp
if flavor in ("chrome", "firefox"):
    m.pop("update_url", None)
    m.pop("key", None)
json.dump(m, open(p, "w"), indent=2)
print(flavor, "->", m["version"], "| hosts:", len(hp), "| update_url:", "update_url" in m, "| key:", "key" in m)
EOF
  (cd "$B" && zip -qr "$DIR/build/echolike-$VER-$flavor.zip" .)
done
ls -la "$DIR/build"/*.zip
