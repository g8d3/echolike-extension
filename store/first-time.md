# First-time store setup (one time, ~10 minutes, in YOUR browsers — I can't do these clicks)

## A. Firefox AMO (2 min, then I automate everything)
1. Log in at addons.mozilla.org → Developer Hub → Manage API Keys → create key.
2. Save the two values as `AMO_JWT_ISSUER` + `AMO_JWT_SECRET` in the secrets file (below).
3. Done — `bin/publish-amo.sh` handles first submission and every update after.

## B. Chrome Web Store (first upload is manual — Google's API cannot create listings)
1. Pay/verify the $5 developer account (already paid).
2. Developer Dashboard → New Item → upload `build/echolike-<ver>-chrome.zip`.
3. Paste listing from `store/listing-en.md`, upload screenshots (retake `shot-sync` first), answer the privacy questionnaire with `store/review-notes.md`.
4. Submit for review. When it's live, copy the 32-letter item ID from the dashboard URL → `CWS_APP_ID` in the secrets file.
5. From then on, every release is one command here: `bin/publish-cws.sh <zip>`.

## Secrets file (the "secure input")
```bash
mkdir -p ~/.config/echolike
cp store/secrets-template.env ~/.config/echolike/store-secrets.env
chmod 600 ~/.config/echolike/store-secrets.env
# edit the values in, then just tell me "tokens are in" — never paste them in chat.
```
Rules: API tokens only (scoped, revocable) — never your Google/Mozilla password.
Anything pasted in chat lands in session logs; the file stays on this machine, `chmod 600`, never committed.
