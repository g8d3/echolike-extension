#!/usr/bin/env python3
"""Validate an inbox directory file: schema + live probe of every entry.

Discovery, never trust: listing is not endorsement. Every entry is probed
(GET <url>/api/health, 2 s timeout); api incompatibility or a dead server
fails that entry. The extension ranks survivors by measured latency.

  python3 validate_directory.py                        # validates inbox-servers.json beside it
  python3 validate_directory.py --dir path/to/dir.json # another file
  python3 validate_directory.py --no-probe             # schema only (offline)

Exit 0 when every listed server passes, 1 otherwise. Stdlib only.
"""
import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REQUIRED = ("id", "url", "api", "price", "claim", "health")


def load(path):
    with open(path) as f:
        return json.load(f)


def check_schema(d):
    errors = []
    if not isinstance(d.get("v"), int):
        errors.append("v must be an int protocol version")
    try:
        datetime.fromisoformat(str(d.get("updated", "")).replace("Z", "+00:00"))
    except ValueError:
        errors.append("updated must be ISO-8601")
    servers = d.get("servers")
    if not isinstance(servers, list) or not servers:
        errors.append("servers must be a non-empty list")
        return errors
    seen = set()
    for i, s in enumerate(servers):
        if not isinstance(s, dict):
            errors.append(f"servers[{i}] must be an object")
            continue
        for k in REQUIRED:
            if k not in s:
                errors.append(f"servers[{i}] missing {k!r}")
        if s.get("id") in seen:
            errors.append(f"duplicate id {s.get('id')!r}")
        seen.add(s.get("id"))
        price = s.get("price") or {}
        if price.get("model") not in ("free", "paid"):
            errors.append(f"servers[{i}] price.model must be free|paid")
    return errors


def probe(url, timeout=2.0):
    target = url.rstrip("/") + "/api/health"
    try:
        with urllib.request.urlopen(target, timeout=timeout) as r:
            body = json.loads(r.read().decode())
    except Exception as e:
        return None, f"unreachable: {str(e)[:100]}"
    if not body.get("ok"):
        return None, "health not ok"
    return body, None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(HERE, "inbox-servers.json"))
    ap.add_argument("--no-probe", action="store_true")
    a = ap.parse_args(argv)
    d = load(a.dir)
    errors = check_schema(d)
    ranked = []
    if not errors and not a.no_probe:
        for s in d["servers"]:
            body, err = probe(s["url"])
            if err:
                errors.append(f"{s['id']}: {err}")
                continue
            if (body.get("api") or 1) < 2:
                errors.append(f"{s['id']}: api {body.get('api')} too old (need >= 2)")
                continue
            ranked.append((s["id"], s["url"]))
    for sid, url in ranked:
        print(f"OK {sid} {url}")
    for e in errors:
        print(f"FAIL {e}", file=sys.stderr)
    print(f"directory v{d.get('v')} updated {d.get('updated')}: {len(ranked)} reachable, {len(errors)} problems")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
