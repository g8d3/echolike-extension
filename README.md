# EchoLike browser extension

Free and open source (MIT). Like or bookmark a post on x.com and it arrives in EchoLike (Telegram bot). No account, no store, no tracking. Español: [LEEME.md](LEEME.md).

**Download:** [latest release zip](https://github.com/g8d3/echolike-extension/releases/latest/download/echolike-extension.zip) · Website: https://echolike.app

## About the browser warning (honest version)
EchoLike is not in the Chrome Web Store on purpose (the store requires identity verification). Installing outside the store means Chrome needs **Developer mode** on, and Chrome may show a banner like *"Disable developer mode extensions"*. That banner appears for every extension installed this way; it is not a virus alert. Click the X / *Cancel* to keep it. You can read every line of code in this repo before installing — there is no build step and no minified code.

## Install (Chrome / Edge / Brave)

1. Download `echolike-extension.zip` (link above) and unzip it into a folder you won't delete.
2. Open `chrome://extensions` (in Edge: `edge://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the folder.
5. Open the extension popup (click its icon), click your code to copy it, and send it to the bot with `/par EL2|…` (https://t.me/nova_radar_99_bot). After your first like the popup will say "✓ Connected".
6. Open x.com (reload the tab if it was already open). Like or bookmark any post: it reaches the bot in seconds.
7. Voice note: a 🎙 appears next to the heart. Click to record (the first time, allow the microphone for x.com), click again to stop (max 60 s).
8. Written note (2.2+): **hold the heart ~half a second** → it likes and opens a small box under the post. Enter saves, Shift+Enter adds a new line, Esc cancels. Also: after any like press **N** (within 5 s), or the **✎** that appears next to the heart on hover. The box has a 🎤 to switch to voice.
9. B shortcut (2.6.2+): with a post focused, press **B** to bookmark it (X has no shortcut for that: its B blocked; now B saves, use the menu to block).

**Firefox (desktop, 121+):** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → pick `manifest.json` (removed when Firefox closes; to keep it permanently it must be signed on addons.mozilla.org).
**Android (Quetta, the only up-to-date one with extensions after Kiwi died):** download `echolike.crx` (https://echolike.app/extension_echolike.crx) and open it with Quetta to install. As a packaged build with `update_url`, the **Update** button on its extensions page checks https://echolike.app/extension_update.json and installs the new version without touching folders. If you prefer the zip, Quetta installs that too, but then Update only re-reads local files. If the browser says `Package is invalid: CRX_REQUIRED_PROOF_MISSING`, it no longer accepts packages from outside the Chrome Web Store: install via zip (steps 1-4) and update by repeating those steps with the new zip. Others: **Edge Canary**, **Lemur** or **Firefox Nightly** (custom collection). Works the same on the mobile version of x.com in the browser, not in the X app.

Privacy: every event goes AES-GCM encrypted to a secret ntfy.sh topic (free). ntfy only sees unreadable text; without the code nobody can read or forge it.


## Updating from an older version
1. Replace the folder files with the ones from the new zip.
2. In `chrome://extensions`, press ↻ (reload) on EchoLike. It should show the latest published version.
3. The connection is kept (it lives in the browser, not in the zip). On a fresh install, repeat step 5 (code + /par to the bot).
4. Reload your x.com tabs. Each like shows "EchoLike ✓ sent" below and then "✓ received". If it shows red, the message explains why.

## License
MIT — see [LICENSE](LICENSE).
