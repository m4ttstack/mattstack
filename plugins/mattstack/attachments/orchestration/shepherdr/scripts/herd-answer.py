#!/usr/bin/env python3
"""Shepherd-side: deliver an answer, then record it.

Relay FIRST (relay-answer.sh, overridable via SHEPHERDR_RELAY for tests);
only successful delivery marks the row answered. A failed relay leaves the
question open -- it is still live -- and exits 1 so the shepherd reports it.
--pane-handled records a needs:pane question the user resolved in the pane.
"""
import argparse
import os
import subprocess
import sys

import herd_db

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--qid", required=True, type=int)
    ap.add_argument("--target")
    ap.add_argument("--pane-handled", action="store_true")
    ap.add_argument("answer", nargs="?")
    args = ap.parse_args()

    conn = herd_db.connect(args.db)
    q = conn.execute("SELECT * FROM questions WHERE id=?", (args.qid,)).fetchone()
    if not q:
        sys.exit(f"herd-answer: no question {args.qid}")
    if q["status"] != "open":
        sys.exit(f"herd-answer: question {args.qid} is {q['status']}, not open")

    if args.pane_handled:
        answer = "(handled in pane)"
    else:
        if not args.target or args.answer is None:
            sys.exit("herd-answer: --target and an answer are required unless --pane-handled")
        relay = os.environ.get("SHEPHERDR_RELAY", os.path.join(HERE, "relay-answer.sh"))
        proc = subprocess.run([relay, args.target, args.answer])
        if proc.returncode != 0:
            sys.exit(f"herd-answer: relay failed (exit {proc.returncode}); question stays open")
        answer = args.answer

    conn.execute(
        "UPDATE questions SET status='answered', answer=?, answered_at=? WHERE id=?",
        (answer, herd_db.now(), args.qid),
    )
    conn.commit()


if __name__ == "__main__":
    main()
