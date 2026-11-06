# Releasing EchoLike extension (echolike.app / Cloudflare) — MANDATORY

**Pushing code to git is NOT enough.** Every extension update **MUST** also
update the website on **Cloudflare** (`https://echolike.app`) so installed
browsers auto-update via `update_url` (`https://echolike.app/extension_update.json`).

- The self-hosted feed serves: `extension_update.json` + `extension_echolike.crx`
  (+ zip + page) on `echolike.app` (Cloudflare Pages, project `echolike`).
- **If you changed extension code and did not publish to echolike.app, the
  release is incomplete** — users will not receive the update.

## Canonical publish (the release line that feeds echolike.app)

The live echolike.app feed is built/published from the **e092-echolike** repo
release line (`extension_echolike/`, currently 2.20.x+), NOT directly from this
standalone repo. This repo (`g8d3/echolike-extension`) holds extension code,
but **pushing here does not update echolike.app**.

### Ship a fix to users (easy, next session)

```bash
# 1) Port the fix into the release line and bump version (> live floor)
cd /home/vuos/code/p4/e092-echolike
#   edit extension_echolike/* (e.g. content.js, background.js)
#   bump "version" in extension_echolike/manifest.json

# 2) Dry run — build + gates + diff, NO push/deploy
./publicar_extension.sh --dry-run

# 3) Publish to Cloudflare/echolike.app (deploys + waits until LIVE)
./publicar_extension.sh "short release note"

# 4) Commit & push the source in e092-echolike (the script does NOT commit it)
git add extension_echolike/<changed files> extension_echolike/manifest.json
git commit -m "extension X.Y.Z: <what changed>"
git push origin HEAD

# 5) If the fix originated in this standalone repo, keep it in sync too
cd /home/vuos/code/p4/echolike-extension
git add <changed files> && git commit -m "..." && git push
```

### Prerequisites
`gh` auth, `wrangler`, `node`/`npm`, `python3`, `openssl`, `zip`/`unzip`/`curl`,
CRX signing key `e092-echolike/.secrets/echolike_crx.pem`, and a Cloudflare Pages
token in env (`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_PAGES_API_KEY` / legacy
`CLOUDFLARE_FOCALIS_API_KEY`, Pages:Write). **Never commit tokens or the CRX key.**
Without a Cloudflare token the script falls back to GitHub Pages.

### Notes
- `publicar_extension.sh` refuses to publish below the live `extension_update.json` version.
- "install walk skipped: no browser here" is not a verdict; real gate failures abort before deploy.
- `server.py` is NOT shipped by this script unless `INBOX_SERVER_SRC` is set (see script header).
- Verify live: `curl -s 'https://echolike.app/extension_update.json?b=1'` shows the new version.
