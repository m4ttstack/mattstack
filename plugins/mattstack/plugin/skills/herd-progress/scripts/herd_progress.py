#!/usr/bin/env python3
"""Render a herd's progress as one markdown table.

Usage: python3 herd_progress.py [--herd <id>]

Reads the herd from rt (the same data herd_status and herd_gates return), the
pipeline runs the herd spawned, and from each job's worktree its SDD ledger,
plan headings and report draft. Where progress lives depends on the job's
method: an SDD ledger (superpowers, from-spec, from-plan), the brief's item
list plus the report draft (trivial, direct-tdd), a pipeline run (a domain
Method such as a team's work skill), or whichever of those a delegate job
picked. It only reads; nothing here writes to the herd, the room, a gate or
a pane.
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
LEDGER_METHODS = {"superpowers": ("spec", "plan"), "from-spec": ("plan",), "from-plan": ()}
INLINE_METHODS = {"trivial", "direct-tdd"}
STRATEGIES = sorted({*LEDGER_METHODS, *INLINE_METHODS}, key=len, reverse=True)


def rt_json(args):
    what = f"rt {' '.join(args)}"
    try:
        out = subprocess.run(["rt", *args, "--json"], capture_output=True, text=True)  # mcp-lint: allow
    except FileNotFoundError:
        sys.exit(f"{what} failed: rt is not on PATH")
    if out.returncode != 0:
        sys.exit(f"{what} failed: {(out.stderr or out.stdout).strip()}")
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        sys.exit(f"{what} failed: output was not JSON")


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
    done = len(set(re.findall(r"\bTask\s+(\d+):\s*complete\b", text)))
    lines = [l.strip() for l in text.splitlines()[1:] if l.strip() and not re.match(r"(#|\||Ruling|Spec:)", l.strip())]
    now = re.sub(r"^Task\s+(\d+):\s*", r"T\1 ", lines[-1]) if lines else ""
    return done, total, now


def brief_text(herd_id, job_name):
    return read(os.path.expanduser(os.path.join("~/.mattstack/rt/herds", herd_id, job_name, "job.md")))


def method(brief, draft):
    """A delegate job names the strategy it picked on its report's first line."""
    m = re.search(r"(?m)^Method:\s*([a-z-]+)", brief)
    meth = m.group(1) if m else ""
    if meth == "delegate":
        first = draft.strip().splitlines()[0] if draft.strip() else ""
        picked = re.search(r"\b(" + "|".join(STRATEGIES) + r")\b", first)
        return picked.group(1) if picked else meth
    return meth


def inline_progress(brief, draft):
    section = re.search(r"(?ms)^Tasks \(item-coded\):\n(.*?)^Verification", brief)
    items = set(re.findall(r"(?m)^\s*-?\s*([A-Z]\d+)\b", section.group(1))) if section else set()
    finished = set(re.findall(r"(?m)^\s*-\s*([A-Z]\d+):\s*(?:done|skipped)\b", draft)) & items
    return len(finished), len(items)


def tree_branch(root):
    """The job record's branch is null when a domain provisioned the tree."""
    dotgit = os.path.join(root, ".git")
    gitdir = dotgit
    if os.path.isfile(dotgit):
        m = re.match(r"gitdir:\s*(.+)", read(dotgit).strip())
        gitdir = m.group(1) if m else ""
        gitdir = gitdir if os.path.isabs(gitdir) else os.path.join(root, gitdir)
    m = re.match(r"ref:\s*refs/heads/(.+)", read(os.path.join(gitdir, "HEAD")).strip())
    return m.group(1) if m else ""


def run_for(job, runs, herd_id, roots):
    """Pipeline runs carry no job name; the herd spawned them on the job's branch."""
    branches = {job.get("branch")} if job.get("branch") else {tree_branch(r) for r in roots} - {""}
    mine = [r for r in runs if r.get("spawned_by") == f"herd:{herd_id}" and r.get("branch") in branches]
    return max(mine, key=lambda r: r.get("started_at") or 0) if mine else None


def stage_mark(run, match):
    hits = [s for s in run.get("stages") or [] if match(s["name"])]
    if not hits:
        return "" if run.get("status") == "running" else "·"
    return {"done": "✓", "running": "▸", "failed": "✗"}.get(hits[-1].get("status"), "")


def run_now(run):
    attention = run.get("attention") or {}
    if attention.get("needs"):
        return f"run needs attention: {attention.get('reason') or 'no reason recorded'}"
    stages = run.get("stages") or []
    last = stages[-1] if stages else {}
    stage = last.get("name") or run.get("current_stage") or "?"
    if run.get("status") == "running":
        return f"stage {stage}" + (" failed" if last.get("status") == "failed" else "")
    return f"run {run.get('status')} at {stage}"


def bar(done, total, known=True):
    if not total:
        return "`" + "·" * BAR_CELLS + "`" + (f" {done}/?" if done else "")
    if not known:
        return "`" + "·" * BAR_CELLS + f"` ?/{total}"
    filled = min(BAR_CELLS, round(BAR_CELLS * done / total))
    return "`" + "█" * filled + "░" * (BAR_CELLS - filled) + f"` {done}/{total}"


def bare_pane(ref):
    return (ref or "").split(":", 1)[-1] if (ref or "").startswith("bg:") else (ref or "")


def gate_for(job, gates, herd_id):
    """Herd gates key on the job's subject; run gates opened inside the job's
    tree carry no job name, only the worker's session or pane."""
    subject = f"herd:{herd_id}/{job['name']}"
    for g in gates:
        session = (g.get("nudge") or {}).get("session")
        if (
            g.get("id") == job.get("openGate")
            or g.get("subject") == subject
            or (session and session == job.get("agentSession"))
            or (g.get("pane") and job.get("pane") and bare_pane(g["pane"]) == bare_pane(job["pane"]))
        ):
            return g
    return None


def gate_text(g):
    q = (g.get("questions") or [{}])[0]
    label = q.get("label") or g.get("kind") or "open gate"
    kind = "milestone" if g.get("kind") == "milestone" else "question"
    return f"{kind}: {label}"


def row(job, herd_id, gates, runs, now_s):
    since = job["createdAt"] / 1000
    roots = job_roots(job)
    live = job["status"] in LIVE
    reported = job["status"] in {"done", "closed"} and job.get("lastReport") is not None
    gate = gate_for(job, gates, herd_id) if live else None

    draft = fresh_draft(roots, since)
    brief = brief_text(herd_id, job["name"])
    meth = method(brief, draft)
    run = run_for(job, runs, herd_id, roots)
    found = None if run else newest_ledger(roots, since)
    done, total, now = ledger_progress(found[0], found[2]) if found else (0, 0, "")
    known = True
    if meth in INLINE_METHODS and not run:
        done, total = inline_progress(brief, draft)
        known = bool(draft)
        if reported and not known:
            done, total = 0, 0
    phases = LEDGER_METHODS.get(meth, ())

    cols = {}
    if run:
        cols["spec"] = "·"
        cols["plan"] = stage_mark(run, lambda n: n == "plan")
        cols["exec"] = stage_mark(run, lambda n: n == "implement")
        cols["review"] = stage_mark(run, lambda n: "review" in n)
        now = run_now(run)
    else:
        for p in ("spec", "plan"):
            if p not in phases:
                cols[p] = "·"
            else:
                written = re.search(rf"(?m)^\s*-?\s*{p}:", draft) or (p == "plan" and found)
                cols[p] = "✓" if reported or written else ""
        started = found or (meth in INLINE_METHODS and live)
        cols["exec"] = "✓" if reported or (known and total and done >= total) else ("▸" if started else "")
        cols["review"] = "✓" if reported else ("▸" if live and cols["exec"] == "✓" else "")
        if meth in INLINE_METHODS:
            cols["review"] = "·"
            now = "items in the report draft" if draft else "working inline, no ledger by design"
        elif meth == "delegate" and not found:
            now = "delegate: strategy not named yet"
    if live and not run and "▸" not in cols.values():
        for p in ("spec", "plan", "exec", "review"):
            if cols[p] == "":
                cols[p] = "▸"
                break

    idle = live and job.get("paneStatus") in {"idle", "done"} and not gate
    if gate or job["status"] in {"at-gate", "at-milestone"}:
        rank, status = 0, "**NEEDS YOU**"
        now = gate_text(gate) if gate else f"{job['status']}, gate not listed"
    elif job["status"] == "crashed" or job.get("sessionDead"):
        rank, status, now = 1, "**CRASHED**", "pane has no claude session"
    elif job["status"] == "stuck-at-modal":
        rank, status, now = 1, "**STUCK**", "parked at a dialog"
    elif live and job.get("paneStatus") == "blocked":
        rank, status, now = 1, "**STUCK**", "blocked at a prompt with no gate"
    elif idle:
        rank, status = 2, "*idle*"
        if cols["review"] == "▸":
            now = "all tasks done, no report yet"
    elif live:
        spawning = job["status"] == "spawning" and not (run or found)
        rank, status = 3, "spawning" if spawning else "running"
        if found and now_s - found[1] > 1800:
            now = f"ledger quiet {age(now_s - found[1])}; {now}"
    elif reported:
        rank, status, now = 4, "done", "reported"
    else:
        rank, status, now = 5, "*closed*", "closed without a report"

    if not now:
        now = "no ledger yet" if live else ""
    tasks = bar(done, total, known) if (found or total) else "·"
    line = f"| {job['name']} | {status} | {cols['spec']} | {cols['plan']} | {cols['exec']} | {cols['review']} | {tasks} | {cell(now)} |"
    return rank, job["createdAt"], line


def main():
    args = sys.argv[1:]
    herd_args = args[args.index("--herd"): args.index("--herd") + 2] if "--herd" in args else []
    status = rt_json(["herd", "status", *herd_args])
    herd_id = status["herd"]["id"]
    gates = rt_json(["herd", "gates", "--herd", herd_id]).get("gates", [])
    runs = rt_json(["runs"]).get("runs", [])
    now_s = time.time()
    jobs = status["jobs"]

    rows = sorted(row(j, herd_id, gates, runs, now_s) for j in jobs)
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
