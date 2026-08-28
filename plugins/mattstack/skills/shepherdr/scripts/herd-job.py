#!/usr/bin/env python3
"""Shepherd-side jobs.status / reports.handled_at transitions.

  herd-job.py --db D <job> --status done|crashed|closed|active
  herd-job.py --db D <job> --handled <rid>       (marks the report handled)

Both flags may be combined (typical completion: --status done --handled N).
`--status` requires an existing jobs row for <job> (created by spawn-agent.sh's
upsert); it never creates a phantom row -- if none exists, it exits nonzero
naming the job.
"""
import argparse
import sys

import herd_db


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("job")
    ap.add_argument("--status", choices=["active", "done", "crashed", "closed"])
    ap.add_argument("--handled", type=int, metavar="RID")
    args = ap.parse_args()
    if not args.status and args.handled is None:
        sys.exit("herd-job: nothing to do")

    conn = herd_db.connect(args.db)
    if args.status:
        row = conn.execute("SELECT 1 FROM jobs WHERE job=?", (args.job,)).fetchone()
        if not row:
            sys.exit(f"herd-job: no such job '{args.job}'")
        conn.execute("UPDATE jobs SET status=? WHERE job=?", (args.status, args.job))
    if args.handled is not None:
        conn.execute(
            "UPDATE reports SET handled_at=? WHERE id=?", (herd_db.now(), args.handled)
        )
    conn.commit()


if __name__ == "__main__":
    main()
