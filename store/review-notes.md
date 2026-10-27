# EchoLike 2.8.0 — review notes (answer the questionnaires with this)

## What the extension does (single purpose)
Captures the user's own X likes/bookmarks (+ optional notes) into local browser storage, with optional sync to the user's own inbox.

## Permissions and why
- storage / unlimitedStorage: local-first item store + offline queue.
- scripting, tabs (+ x.com / twitter.com / mobile hosts): detect the user's own likes/bookmarks on X pages.
- alarms: retry the offline queue (1/min) + periodic test ping (30 min, sync on only).
- clipboardWrite: copy pairing code / export file.
- host permissions to the inbox URLs (workers.dev + likes.echolike.app): Direct sync POSTs. Only used when the user enables Direct and enters a token.
- host permission to ntfy.sh: Legacy mode only. Untouched from 2.7.

## Data disclosure (both stores)
- Collected only when the user enables sync: X post URL, handle, text, timestamps, optional voice/note.
- Sent only to the inbox URL the user configures (Direct) or their paired relay (Legacy).
- No sale, no third-party sharing, no advertising use. No account creation.
- Source is plain readable JS, no obfuscation, no remote code.

## Build flavors (from bin/build-flavors.sh)
- chrome / firefox zips: no update_url, no key, version 2.8.0.
- selfhost zip keeps update_url + key for Edge/Quetta sideload via echolike.app.

## Screenshots to refresh before submit
shot-sync (shows old /par code UI) and any popup shot: retake with Direct inbox box visible. 1280x800 as before.
