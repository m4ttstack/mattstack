#!/usr/bin/env python3
"""Worker-side: publish a question to the herd DB and ring the doorbell.

The insert is the contract; the emit is best-effort (a dead rt daemon is
invisible to workers -- the shepherd's degraded-mode polling finds the row).
Prints the qid. After running this, STOP and wait for the answer.

Requires at least 2 --option values (the first is your recommendation);
fewer than 2 leaves no real choice to present, so it exits nonzero before
inserting anything.
"""
import argparse
import json
import subprocess
import sys

import herd_db


def best_effort_emit(topic, payload):
    try:
        subprocess.run(
            ["rt", "events", "emit", topic, "--json", json.dumps(payload)],
            capture_output=True, text=True, timeout=30,
        )
    except Exception as exc:
        print(f"herd-ask: emit skipped ({exc})", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--run", required=True)
    ap.add_argument("--job", required=True)
    ap.add_argument("--context", required=True)
    ap.add_argument("--question", required=True)
    ap.add_argument("--option", action="append", default=[],
                    help="repeatable; the FIRST option is your recommendation")
    ap.add_argument("--needs", choices=["answer", "pane"], default="answer")
    args = ap.parse_args()
    if len(args.option) < 2:
        sys.exit("herd-ask: at least 2 --option values required (first is your recommendation)")

    conn = herd_db.connect(args.db)
    cur = conn.execute(
        "INSERT INTO questions(job, needs, context, question, options, asked_at)"
        " VALUES(?,?,?,?,?,?)",
        (args.job, args.needs, args.context, args.question,
         json.dumps(args.option), herd_db.now()),
    )
    conn.commit()
    qid = cur.lastrowid
    best_effort_emit(f"shepherdr/{args.run}/{args.job}/question", {"qid": qid})
    print(f"published question qid={qid}")


if __name__ == "__main__":
    main()
