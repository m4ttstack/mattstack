#!/usr/bin/env python3
"""Mint or resume a shepherdr herd run.

  herd-init.py --repo <name>        mint run id, create run dir + DB,
                                    snapshot cursor, detect bus
  herd-init.py --resume <run-dir>   reopen an existing run (relaunched
                                    shepherd); reads state, never re-snapshots

Prints {"run", "db", "mode", "cursor"} JSON on stdout.

Cursor snapshot: `rt events list 'shepherdr/<run>/**' --limit 1`. For a
virgin run id nothing matches and the empty response carries the journal
head. NOTE: --limit 1 returns the OLDEST match when matches exist, so this
snapshot is only valid for a virgin run id -- resume reads state instead.
"""
import argparse
import datetime
import json
import os
import subprocess
import sys

import herd_db


def detect_bus(run_id):
    """Return (mode, cursor). Any failure to reach the bus means degraded."""
    try:
        proc = subprocess.run(
            ["rt", "events", "list", f"shepherdr/{run_id}/**", "--limit", "1"],
            capture_output=True, text=True, timeout=30,
        )
        if proc.returncode != 0:
            return "degraded", 0
        resp = json.loads(proc.stdout)
        if not resp.get("ok"):
            return "degraded", 0
        return "bus", int(resp["cursor"])
    except Exception as exc:  # rt absent, timeout, bad JSON
        print(f"herd-init: bus probe failed: {exc}", file=sys.stderr)
        return "degraded", 0


def main():
    ap = argparse.ArgumentParser()
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--repo")
    group.add_argument("--resume", metavar="RUN_DIR")
    args = ap.parse_args()

    if args.resume:
        db_path = os.path.join(args.resume, "herd.db")
        if not os.path.isfile(db_path):
            sys.exit(f"herd-init: no herd.db in {args.resume}")
        conn = herd_db.connect(db_path)
        out = {
            "run": herd_db.get_state(conn, "run_id"),
            "db": db_path,
            "mode": herd_db.get_state(conn, "mode"),
            "cursor": int(herd_db.get_state(conn, "cursor") or 0),
        }
        print(json.dumps(out, indent=1))
        return

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    run_id = f"{args.repo}-{stamp}"
    run_dir = os.path.expanduser(os.path.join("~", ".mattstack", "shepherdr", "runs", run_id))
    os.makedirs(run_dir, exist_ok=False)  # loud on the freak same-second collision
    db_path = os.path.join(run_dir, "herd.db")
    conn = herd_db.init_db(db_path)
    mode, cursor = detect_bus(run_id)
    herd_db.set_state(conn, "run_id", run_id)
    herd_db.set_state(conn, "repo", args.repo)
    herd_db.set_state(conn, "mode", mode)
    herd_db.set_state(conn, "cursor", cursor)
    print(json.dumps({"run": run_id, "db": db_path, "mode": mode, "cursor": cursor}, indent=1))


if __name__ == "__main__":
    main()
