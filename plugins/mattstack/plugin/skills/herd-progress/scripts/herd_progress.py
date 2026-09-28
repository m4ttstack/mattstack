#!/usr/bin/env python3
"""Render a herd's progress as one markdown table.

Usage: python3 herd_progress.py [--herd <id>]

Reads the herd from rt (the same data herd_status and herd_gates return) and
each job's SDD ledger, plan headings and report draft from its worktree. It
only reads; nothing here writes to the herd, the room, a gate or a pane.
"""
import glob
import json
import os
import re
import subprocess
import sys
import time

BAR_CELLS = 10
NOW_MAX = 64
LIVE = {"spawning", "active", "at-gate", "at-milestone", "stuck-at-modal"}
PIPELINE_METHODS = {"superpowers": ("spec", "plan"), "resume": ("plan",)}


def rt_json(args):
    out = subprocess.run(["rt", *args, "--json"], capture_output=True, text=True)  # mcp-lint: allow
    if out.returncode != 0:
        sys.exit(f"rt {' '.join(args)} failed: {(out.stderr or out.stdout).strip()}")
    return json.loads(out.stdout)


def mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0.0


def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def age(seconds):
    m = int(seconds // 60)
    return f"{m // 60}h {m % 60}m" if m >= 60 else f"{m}m"


def cell(text):
    text = " ".join(text.replace("|", "/").split())
    return text if len(text) <= NOW_MAX else text[: NOW_MAX - 3].rstrip() + "..."


def job_roots(job):
    """The job's worktree, plus the tree a worker made for itself when it was
    spawned into a shared checkout (tree is null there)."""
    base = job["worktree"]
    roots = [base]
    if not job.get("tree"):
        roots += [os.path.join(base, ".worktrees", job["name"]), os.path.join(base, ".claude", "worktrees", job["name"])]
    return [r for r in roots if os.path.isdir(r)]


def newest_ledger(roots, since):
    best = None
    for root in roots:
        for ledger in glob.glob(os.path.join(root, ".superpowers", "sdd", "*", "progress.md")):
            t = mtime(ledger)
            if t >= since and (best is None or t > best[1]):
                best = (root, t, ledger)
    return best


def fresh_draft(roots, since):
    drafts = [(mtime(p), p) for p in (os.path.join(r, ".superpowers", "report-draft.md") for r in roots)]
    drafts = [d for d in drafts if d[0] >= since]
    return read(max(drafts)[1]) if drafts else ""


def plan_file(root, ledger):
    marker = read(os.path.join(os.path.dirname(ledger), "plan-path")).strip()
    if not marker:
        m = re.search(r"plan:\s*(\S+)", read(ledger).splitlines()[0] if read(ledger) else "")
        marker = m.group(1) if m else ""
    if not marker:
        return ""
    return marker if os.path.isabs(marker) else os.path.join(root, marker)


def ledger_progress(root, ledger):
    text = read(ledger)
    total = len(set(re.findall(r"(?m)^#+\s*Task\s+(\d+)\b", read(plan_file(root, ledger)))))
    done = len(set(re.findall(r"(?m)^Task\s+(\d+):\s*complete", text)))
    lines = [l.strip() for l in text.splitlines()[1:] if l.strip() and not re.match(r"(#|\||Ruling|Spec:)", l.strip())]
    now = re.sub(r"^Task\s+(\d+):\s*", r"T\1 ", lines[-1]) if lines else ""
    return done, total, now


def method(herd_id, job_name):
    brief = read(os.path.expanduser(os.path.join("~/.mattstack/rt/herds", herd_id, job_name, "job.md")))
    m = re.search(r"(?m)^Method:\s*([a-z-]+)", brief)
    return m.group(1) if m else ""


def bar(done, total):
    if not total:
        return "`" + "·" * BAR_CELLS + "`" + (f" {done}/?" if done else "")
    filled = min(BAR_CELLS, round(BAR_CELLS * done / total))
    return "`" + "█" * filled + "░" * (BAR_CELLS - filled) + f"` {done}/{total}"


def gate_for(job, gates, herd_id):
    subject = f"herd:{herd_id}/{job['name']}"
    for g in gates:
        if g.get("subject") == subject or (g.get("worktree") and g.get("worktree") == job["worktree"]):
            return g
    return None


def gate_text(g):
    q = (g.get("questions") or [{}])[0]
    label = q.get("label") or g.get("kind") or "open gate"
    kind = "milestone" if g.get("kind") == "milestone" else "question"
    return f"{kind}: {label}"


def row(job, herd_id, gates, now_s):
    since = job["createdAt"] / 1000
    roots = job_roots(job)
    live = job["status"] in LIVE
    reported = job["status"] in {"done", "closed"} and job.get("lastReport") is not None
    gate = gate_for(job, gates, herd_id) if live else None

    found = newest_ledger(roots, since)
    done, total, now = ledger_progress(found[0], found[2]) if found else (0, 0, "")
    draft = fresh_draft(roots, since)
    meth = method(herd_id, job["name"])
    phases = PIPELINE_METHODS.get(meth, ())

    cols = {}
    for p in ("spec", "plan"):
        if p not in phases:
            cols[p] = "·"
        else:
            cols[p] = "✓" if reported or re.search(rf"(?m)^\s*-?\s*{p}:", draft) else ""
    cols["exec"] = "✓" if reported or (total and done >= total) else ("" if not found else "▸")
    cols["review"] = "✓" if reported else ("▸" if live and cols["exec"] == "✓" else "")
    if live and "▸" not in cols.values():
        for p in ("spec", "plan", "exec", "review"):
            if cols[p] == "":
                cols[p] = "▸"
                break

    idle = live and job.get("paneStatus") == "idle" and not gate
    if gate or job["status"] in {"at-gate", "at-milestone"}:
        rank, status = 0, "**NEEDS YOU**"
        now = gate_text(gate) if gate else f"{job['status']}, gate not listed"
    elif job["status"] == "crashed" or job.get("sessionDead"):
        rank, status, now = 1, "**CRASHED**", "pane has no claude session"
    elif job["status"] == "stuck-at-modal":
        rank, status, now = 1, "**STUCK**", "parked at a dialog"
    elif idle:
        rank, status = 2, "*idle*"
        if cols["review"] == "▸":
            now = "all tasks done, no report yet"
    elif live:
        rank, status = 3, "spawning" if job["status"] == "spawning" else "running"
        if found and now_s - found[1] > 1800:
            now = f"ledger quiet {age(now_s - found[1])}; {now}"
    elif reported:
        rank, status, now = 4, "done", "reported"
    else:
        rank, status, now = 5, "*closed*", "closed without a report"

    if not now:
        now = "no ledger yet" if live else ""
    tasks = bar(done, total) if (found or total) else "·"
    line = f"| {job['name']} | {status} | {cols['spec']} | {cols['plan']} | {cols['exec']} | {cols['review']} | {tasks} | {cell(now)} |"
    return rank, job["createdAt"], line


def main():
    args = sys.argv[1:]
    herd_args = args[args.index("--herd"): args.index("--herd") + 2] if "--herd" in args else []
    status = rt_json(["herd", "status", *herd_args])
    herd_id = status["herd"]["id"]
    gates = rt_json(["herd", "gates", "--herd", herd_id]).get("gates", [])
    now_s = time.time()
    jobs = status["jobs"]

    rows = sorted(row(j, herd_id, gates, now_s) for j in jobs)
    counts = {"need": 0, "trouble": 0, "running": 0, "finished": 0}
    for rank, _, _ in rows:
        counts["need" if rank == 0 else "trouble" if rank in (1, 2) else "running" if rank == 3 else "finished"] += 1

    total = len(jobs)
    fin = counts["finished"]
    filled = round(20 * fin / total) if total else 0
    up = age(now_s - status["herd"]["createdAt"] / 1000)
    print(f"**Herd `{herd_id}`** · shepherd {status['herd'].get('shepherdName', '')} · up {up} · {len(gates)} gates open · {status.get('unread', 0)} unread")
    print()
    print(f"Overall `{'█' * filled}{'░' * (20 - filled)}` {fin}/{total} finished · {counts['need']} need you · {counts['trouble']} trouble · {counts['running']} running")
    print()
    print("| job | status | spec | plan | exec | review | tasks | now |")
    print("|---|---|:-:|:-:|:-:|:-:|---|---|")
    for _, _, line in rows:
        print(line)


if __name__ == "__main__":
    main()
