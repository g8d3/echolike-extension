# Inbox network — design notes

Goal: a user installs the extension, picks nothing, copies nothing, and their
likes land somewhere they own. Many people can run inbox servers; some free,
some paid. The extension talks to one of them.

## The two things that make today's setup hard

1. **The token is a secret a human has to carry between two machines.** It is
   the single most common failure: a truncated paste looks exactly like a
   network problem, and nothing in the UI can tell them apart.
2. **The direct path sends plaintext.** The old ntfy path encrypted the payload;
   the direct POST to an inbox sends readable JSON. Tolerable when the inbox is
   your own PC on your own LAN. Not tolerable when the inbox belongs to a
   stranger who is being paid to store it.

Both have the same fix direction: move identity into keys, and make the server
unable to read what it stores.

## 1. No token to copy

Three options, in order of how little the user does:

### A. Claim on first contact (what to ship first)
The extension knows only the URL. It calls `POST /api/claim` once; the server
mints a device token, stores its hash, returns it a single time; the extension
stores it in `storage.local`. The user pasted one field and never saw the token.

Who may claim is the whole security question:
* private networks only by default (`10/8`, `172.16/12`, `192.168/16`,
  `100.64/10` Tailscale, loopback) — a server on your PC or tailnet needs no
  token because the network already is the credential;
* a public server must run with `--open-claim` (knowingly) or hand out tokens
  out of band (that is the paid case, see §3);
* always: per-IP rate limit, a hard cap of devices, and a claim log.

### B. Keys instead of tokens (the real end state)
On first run the extension generates an Ed25519 key pair. The server stores the
public key on first contact (trust-on-first-use) and every later request is a
signature over `method + path + sha256(body) + timestamp + nonce`. There is no
bearer secret in flight and nothing to copy, ever. Replay is bounded by the
timestamp window and the nonce cache. Recovery is a recovery phrase shown once,
which is the only thing a user can write down.

### C. Directory-issued identity
The user signs in once with the wallet they already have (EchoLike's private app
already does SIWE / Solana signMessage). One identity, and every inbox server in
the network accepts requests signed by that identity. Best for a paid network,
because the same identity carries the payment.

## 2. The directory

A JSON file at a stable URL (`https://echolike.app/inbox-servers.json`), versioned
like a protocol, cacheable, and cheap enough to serve as static content:

```json
{
  "v": 1,
  "updated": "2026-10-30T00:00:00Z",
  "servers": [
    {
      "id": "novaisabuilder-pc",
      "name": "EchoLike (Nova's mini PC)",
      "url": "https://inbox.echolike.app",
      "api": 2,
      "price": {"model": "free", "quota_days": 3650},
      "region": "bogota",
      "claim": "private",
      "health": "/api/health",
      "operator": "novaisabuilder",
      "notes": "tailnet only"
    },
    {
      "id": "inbox-eu-1",
      "name": "Inbox EU (paid)",
      "url": "https://inbox-eu-1.example",
      "api": 2,
      "price": {"model": "paid", "usd_month": 2, "pay": "lightning"},
      "region": "eu-west",
      "claim": "open",
      "pubkey": "ed25519:..."
    }
  ]
}
```

Rules that keep it honest:
* the extension never trusts a server because it is listed; listing is
  discovery, not endorsement;
* every entry is probed before use (`GET /api/health`, 2 s timeout) and the
  measured latency is what ranks it, not what the file claims;
* a server that stops answering is dropped and re-ranked, not silently kept;
* `api` is a protocol version so old clients skip servers they cannot use.

## 3. Choosing without asking

Ranking, then take the first that passes:

1. the server the user already chose (sticky — never silently move their data);
2. reachable and healthy;
3. free tier not exhausted (the server reports quota in `/api/health`);
4. lowest measured round trip;
5. same region as the phone's timezone.

If the best server later fails: keep writing locally (the extension is
local-first already), retry, and if it stays down for N hours, migrate to the
next candidate and re-post the unsent queue. Migration is cheap precisely
because the phone holds the queue — nothing is lost while it is offline.

## 4. Trust, since the server is a stranger

* **Encryption is what makes the marketplace safe.** The payload is encrypted in
  the browser with a key derived from the user's identity; the server stores
  opaque blobs. Then a paid inbox is only buying storage and uptime, and reading
  someone's likes is not a thing its operator can do.
* **A server can withhold, never forge.** It has no key, so it cannot invent a
  like. It can drop or reorder one: every event carries a client sequence
  number, and the reader reports a gap instead of pretending it is complete.
* **Nothing secret travels.** With keys (§1B) the server sees no credential at
  all, so a breach of the directory is not a breach of the users.
* **Paid, honestly:** price and payment rail live in the directory; the server
  issues the credential only after payment confirms; the extension shows what it
  will cost before it writes anything.

## 5. What this costs

* The encrypted path needs a **second device or a key** to read the data back —
  that is inherent to end-to-end encryption. The escape hatch is the export
  button that already exists.
* A directory is a **central point of discovery**, not of trust: it can be
  mirrored and self-hosted (`LIKES_DIRECTORY_URL` in the extension), and a
  client that cannot reach it keeps using the server it already has.
* Key recovery is a **user-facing concept we do not have today**; shipping §1B
  without a recovery phrase would create data loss for anyone who reinstalls.

## 6. Order of work

1. `POST /api/claim` + private-network default + device cap. (removes the token
   for the common case: my own PC or tailnet) — **shipped in this change**.
2. Extension options: one field, one button; everything else behind "Advanced".
   — **shipped in this change**.
3. Encrypt the direct path with the key the legacy path already uses. (privacy
   before the network exists; without this, §3 is unsafe)
4. Directory file + probe/rank + sticky choice.
5. Keys instead of tokens (§1B) and the recovery phrase.
