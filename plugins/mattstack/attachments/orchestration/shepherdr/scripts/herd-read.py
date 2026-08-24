#!/usr/bin/env python3
"""Shepherd-side rendering of herd-DB rows. The shepherd never composes SQL.

  herd-read.py --db D question <qid>
  herd-read.py --db D report <rid>
  herd-read.py --db D open-questions
  herd-read.py --db D unhandled-reports
  herd-read.py --db D log
"""
import argparse
import json
import sys

import herd_db


def render_question(conn, qid):
    q = conn.execute("SELECT * FROM questions WHERE id=?", (qid,)).fetchone()
    if not q:
        sys.exit(f"herd-read: no question {qid}")
    print(f"# QUESTION qid {q['id']} from job {q['job']}")
    print(f"status: {q['status']}")
    print(f"needs: {q['needs']}")
    print(f"## Context\n{q['context'] or ''}")
    print(f"## Question\n{q['question']}")
    print("## Options")
    for i, opt in enumerate(json.loads(q["options"] or "[]"), 1):
        print(f"{i}. {opt}")
    if q["answer"]:
        print(f"## Answer\n{q['answer']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument(
        "verb",
        choices=["question", "report", "open-questions", "unhandled-reports", "log"],
    )
    ap.add_argument("id", nargs="?")
    args = ap.parse_args()
    conn = herd_db.connect(args.db)

    if args.verb == "question":
        render_question(conn, args.id)
    elif args.verb == "report":
        r = conn.execute("SELECT * FROM reports WHERE id=?", (args.id,)).fetchone()
        if not r:
            sys.exit(f"herd-read: no report {args.id}")
        handled = "handled" if r["handled_at"] else "unhandled"
        print(f"# REPORT rid {r['id']} from job {r['job']} ({handled})")
        print(r["body"])
    elif args.verb == "open-questions":
        for q in conn.execute(
            "SELECT id, job, needs, question FROM questions WHERE status='open' ORDER BY id"
        ):
            print(f"qid {q['id']} [{q['job']}] needs:{q['needs']} -- {q['question']}")
    elif args.verb == "unhandled-reports":
        for r in conn.execute(
            "SELECT id, job, reported_at FROM reports WHERE handled_at IS NULL ORDER BY id"
        ):
            print(f"rid {r['id']} [{r['job']}] reported_at:{r['reported_at']}")
    elif args.verb == "log":
        for j in conn.execute("SELECT * FROM jobs ORDER BY spawned_at"):
            reports = conn.execute(
                "SELECT count(*) c FROM reports WHERE job=?", (j["job"],)
            ).fetchone()["c"]
            open_qs = conn.execute(
                "SELECT count(*) c FROM questions WHERE job=? AND status='open'",
                (j["job"],),
            ).fetchone()["c"]
            print(
                f"| {j['job']} | {j['pane'] or '-'} | {j['account'] or '-'} |"
                f" {j['strategy'] or '-'} | {j['status']} |"
                f" reports:{reports} open-questions:{open_qs} |"
            )


if __name__ == "__main__":
    main()
