#!/usr/bin/env python3
"""One-shot cutover: oradiscuss.com → new Workers Builds project.

Moves the oradiscuss.com custom domain off the old Cloudflare Pages project
(oradiscuss-prod-7k2m, direct-upload) and attaches it to the new git-connected
Worker (oradiscuss-site). Idempotent — safe to re-run. Prints a rollback path
on exit.

Usage:
    export CF_API_TOKEN='...'
    python3 scripts/cutover.py

Required token scopes (create at https://dash.cloudflare.com/profile/api-tokens):
    Account · Workers Scripts · Edit
    Account · Cloudflare Pages · Edit
    Zone    · Workers Routes · Edit      (resource: oradiscuss.com)
    Zone    · Zone · Read                (resource: oradiscuss.com)
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

ACCOUNT_ID = "4e386b5b1955731b273fa0f50e222b00"
ZONE_NAME = "oradiscuss.com"
OLD_PAGES_PROJECT = "oradiscuss-prod-7k2m"
NEW_WORKER_SERVICE = "oradiscuss-site"
NEW_WORKER_ENV = "production"
API = "https://api.cloudflare.com/client/v4"


class CFError(RuntimeError):
    pass


def cf(method: str, path: str, token: str, body: dict | None = None) -> dict:
    url = f"{API}{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            raise CFError(f"HTTP {e.code} on {method} {path}: {e.reason}") from e


def require_success(label: str, resp: dict) -> dict:
    if not resp.get("success"):
        errors = resp.get("errors") or [{"message": "(no error detail)"}]
        raise CFError(f"{label} failed: {json.dumps(errors)}")
    return resp


def main() -> int:
    token = os.environ.get("CF_API_TOKEN")
    if not token:
        print("ERROR: CF_API_TOKEN env var is not set.", file=sys.stderr)
        print("Run:  export CF_API_TOKEN='<your-token>'  then re-run.", file=sys.stderr)
        return 1

    # 0. Verify token
    print("==> Verifying API token...")
    verify = cf("GET", "/user/tokens/verify", token)
    require_success("token verify", verify)
    print("    token ok")

    # 1. Resolve zone
    print(f"==> Looking up zone id for {ZONE_NAME}...")
    zones = cf("GET", f"/zones?name={ZONE_NAME}", token)
    require_success("zone lookup", zones)
    results = zones.get("result") or []
    if not results:
        raise CFError(f"no zone found for {ZONE_NAME}")
    zone_id = results[0]["id"]
    print(f"    zone_id={zone_id}")

    # 2. Detach from old Pages project (apex + www, if present)
    print(f"==> Checking Pages project '{OLD_PAGES_PROJECT}' for attached domains...")
    pages_domains = cf(
        "GET",
        f"/accounts/{ACCOUNT_ID}/pages/projects/{OLD_PAGES_PROJECT}/domains",
        token,
    )
    # Some deployments give a 404 here if the project doesn't exist.
    # That's fine — no detach needed.
    if pages_domains.get("success"):
        attached = {(d.get("name") or "").lower() for d in (pages_domains.get("result") or [])}
        for candidate in (ZONE_NAME, f"www.{ZONE_NAME}"):
            if candidate in attached:
                print(f"    detaching {candidate} from {OLD_PAGES_PROJECT}...")
                detach = cf(
                    "DELETE",
                    f"/accounts/{ACCOUNT_ID}/pages/projects/{OLD_PAGES_PROJECT}/domains/{candidate}",
                    token,
                )
                if detach.get("success"):
                    print(f"    {candidate} detached")
                else:
                    print(f"    WARNING: could not detach {candidate}: {json.dumps(detach.get('errors', []))}")
            else:
                print(f"    {candidate} not attached to {OLD_PAGES_PROJECT} (skipping)")
    else:
        print(f"    could not list pages domains (project missing or no scope): {pages_domains.get('errors')}")
        print("    continuing — the attach below will fail if the domain is still bound elsewhere.")

    # 3. Attach to new Worker as Custom Domain
    print(f"==> Attaching {ZONE_NAME} to Worker '{NEW_WORKER_SERVICE}'...")
    attach = cf(
        "PUT",
        f"/accounts/{ACCOUNT_ID}/workers/domains",
        token,
        body={
            "zone_id": zone_id,
            "hostname": ZONE_NAME,
            "service": NEW_WORKER_SERVICE,
            "environment": NEW_WORKER_ENV,
        },
    )
    if attach.get("success"):
        dom_id = (attach.get("result") or {}).get("id", "?")
        print(f"    attached (domain id: {dom_id})")
    else:
        errs = attach.get("errors") or []
        # Common case: already attached. That's fine; treat as success.
        msgs = " ".join(e.get("message", "") for e in errs).lower()
        if "already" in msgs or "exists" in msgs:
            print("    domain was already attached — treating as success")
        else:
            raise CFError(f"attach failed: {json.dumps(errs)}")

    # 4. Verify
    print("==> Waiting ~6s for edge propagation...")
    time.sleep(6)

    for path in ("/", "/admin/"):
        url = f"https://{ZONE_NAME}{path}"
        print(f"==> Probing {url} ...")
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                body = r.read(8192).decode("utf-8", errors="replace")
                title = ""
                lower = body.lower()
                idx = lower.find("<title>")
                if idx >= 0:
                    end = lower.find("</title>", idx)
                    if end > idx:
                        title = body[idx + 7:end].strip()
                print(f"    HTTP {r.status}" + (f" — title: {title}" if title else ""))
        except urllib.error.HTTPError as e:
            print(f"    HTTP {e.code}")
        except Exception as e:
            print(f"    ERROR: {e}")

    print()
    print("Cutover complete. If the homepage title is")
    print("  'OraDiscuss — Oracle Mastery, Distilled'")
    print("and /admin/ returns 200, the new stack is live on oradiscuss.com.")
    print()
    print("Rollback path (if anything looks wrong):")
    print(f"  1. CF dashboard → Workers → {NEW_WORKER_SERVICE} → Settings → Domains & Routes → remove {ZONE_NAME}")
    print(f"  2. CF dashboard → Workers & Pages → {OLD_PAGES_PROJECT} → Custom domains → add {ZONE_NAME}")
    print()
    print("Housekeeping reminders:")
    print(f"  * Delete the temporary API token you created for this cutover.")
    print(f"  * Keep {OLD_PAGES_PROJECT} for at least a week as a warm spare, then delete.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except CFError as e:
        print(f"FATAL: {e}", file=sys.stderr)
        sys.exit(2)
