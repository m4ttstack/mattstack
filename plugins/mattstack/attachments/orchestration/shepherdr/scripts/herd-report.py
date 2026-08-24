#!/usr/bin/env python3
"""Worker-side: publish a report to the herd DB and ring the doorbell.

Same best-effort emit semantics as herd-ask.py. Prints the rid. After a
completion report, STOP; after a milestone report, STOP for review.
"""
import argparse
import json
import subprocess
import sys

import herd_db


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--run", required=True)
    ap.add_argument("--job", required=True)
    ap.add_argument("--body-file", required=True, help="path, or - for stdin")
    args = ap.parse_args()

    body = sys.stdin.read() if args.body_file == "-" else open(args.body_file).read()
    if not body.strip():
        sys.exit("herd-report: empty report body")

    conn = herd_db.connect(args.db)
    cur = conn.execute(
        "INSERT INTO reports(job, body, reported_at) VALUES(?,?,?)",
        (args.job, body, herd_db.now()),
    )
    conn.commit()
    rid = cur.lastrowid
    try:
        subprocess.run(
            ["rt", "events", "emit", f"shepherdr/{args.run}/{args.job}/report",
             "--json", json.dumps({"rid": rid})],
            capture_output=True, text=True, timeout=30,
        )
    except Exception as exc:
        print(f"herd-report: emit skipped ({exc})", file=sys.stderr)
    print(f"published report rid={rid}")


if __name__ == "__main__":
    main()
