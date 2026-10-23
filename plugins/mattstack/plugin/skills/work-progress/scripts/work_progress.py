#!/usr/bin/env python3
"""Render a herd, a plan or several plans as one markdown view.

Usage: python3 work_progress.py --herd <id>
       python3 work_progress.py --plan <path> [--plan <path> ...] [--tree <root>] [--title <text>]

Plan mode takes each plan's counts from `rt progress list --tree <root>
--refresh --json`, one call for the tree, and falls back to parsing the live
SDD ledger itself when rt is too old for that verb.

Herd mode reads the herd from rt (the same data herd_status and herd_gates return), the
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
OVERALL_CELLS = 20
NOW_MAX = 64
QUIET_S = 1800
LIVE = {"spawning", "active", "at-gate", "at-milestone", "stuck-at-modal"}
LEDGER_METHODS = {"superpowers": ("spec", "plan"), "from-spec": ("plan",), "from-plan": ()}
INLINE_METHODS = {"trivial", "direct-tdd"}
STRATEGIES = sorted({*LEDGER_METHODS, *INLINE_METHODS}, key=len, reverse=True)


def rt_json(args, required=True):
    what = f"rt {' '.join(args)}"
    fail = sys.exit if required else (lambda _: {})
    try:
        out = subprocess.run(["rt", *args, "--json"], capture_output=True, text=True)  # mcp-lint: allow
    except FileNotFoundError:
        return fail(f"{what} failed: rt is not on PATH")
    if out.returncode != 0:
        return fail(f"{what} failed: {(out.stderr or out.stdout).strip()}")
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        return fail(f"{what} failed: output was not JSON")


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


def job_trees(job):
    """The job's worktree, plus the tree a worker made for itself when it was
    spawned into a shared checkout (tree is null there). A merged job's tree
    is disposed, so these may no longer exist."""
    base = job["worktree"]
    roots = [base]
    if not job.get("tree"):
        roots += [os.path.join(base, ".worktrees", job["name"]), os.path.join(base, ".claude", "worktrees", job["name"])]
    return [os.path.realpath(r) for r in roots]


def job_roots(job):
    return [r for r in job_trees(job) if os.path.isdir(r)]


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
    return done_tasks(text), total, ledger_now(text)


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
    items = set(re.findall(r"(?m)^\s*-?\s*([A-Z]\d+)(?:\s*\([^)\n]*\))?:", section.group(1))) if section else set()
    finished = set(re.findall(r"(?m)^\s*-\s*([A-Z]\d+)(?:\s*\([^)\n]*\))?:\s*(?:done|skipped)\b", draft)) & items
    return len(finished), len(items)


def tree_branch(root):
    dotgit = os.path.join(root, ".git")
    gitdir = dotgit
    if os.path.isfile(dotgit):
        m = re.match(r"gitdir:\s*(.+)", read(dotgit).strip())
        gitdir = m.group(1) if m else ""
        gitdir = gitdir if os.path.isabs(gitdir) else os.path.join(root, gitdir)
    m = re.match(r"ref:\s*refs/heads/(.+)", read(os.path.join(gitdir, "HEAD")).strip())
    return m.group(1) if m else ""


def run_for(job, runs, herd_id, roots):
    """Pipeline runs carry no job name, only the herd and branch. The job record's
    branch is null when a domain provisioned the tree, and pool trees are reused,
    so a finished job only owns runs that started inside its own lifetime."""
    branches = {job.get("branch")} if job.get("branch") else {tree_branch(r) for r in roots} - {""}
    start = job["createdAt"]
    end = float("inf") if job["status"] in LIVE else (job.get("updatedAt") or float("inf"))
    mine = [
        r for r in runs
        if r.get("spawned_by") == f"herd:{herd_id}" and r.get("branch") in branches
        and start <= (r.get("started_at") or 0) <= end
    ]
    return max(mine, key=lambda r: r.get("started_at") or 0) if mine else None


def stage_mark(run, match):
    hits = [s for s in run.get("stages") or [] if match(s.get("name") or "")]
    if not hits:
        return "" if run.get("status") == "running" else "·"
    return {"done": "✓", "running": "▸", "failed": "✗", "skipped": "·"}.get(hits[-1].get("status"), "")


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


RECORDS = {}


def list_records(tree, refresh):
    """(plans, error). plans is None when rt cannot answer; error is None only
    when rt is missing or lacks `progress list`, which exits non-zero with
    plain text instead of JSON."""
    args = ["rt", "progress", "list", "--tree", tree, *(["--refresh"] if refresh else []), "--json"]
    try:
        out = subprocess.run(args, capture_output=True, text=True)  # mcp-lint: allow
    except FileNotFoundError:
        return None, None
    text = out.stderr.strip() or out.stdout.strip()
    try:
        reply = json.loads(out.stdout)
    except json.JSONDecodeError:
        reply = None
    if isinstance(reply, dict) and reply.get("ok") and isinstance(reply.get("plans"), list):
        return reply["plans"], None
    if isinstance(reply, dict) and reply.get("ok") is False:
        return None, str(reply.get("error") or "no error message")
    crashed = "unexpected error" in (out.stderr + out.stdout)
    if reply is None and out.returncode != 0 and not crashed:
        return None, None
    return None, text or f"exit {out.returncode}"


def tree_records(tree, refresh=False):
    key = (tree, refresh)
    if key not in RECORDS:
        RECORDS[key] = list_records(tree, refresh)
    return RECORDS[key][0]


def tree_error(tree, refresh=False):
    tree_records(tree, refresh)
    return RECORDS[(tree, refresh)][1]


def kept_record(roots, created_ms):
    """A ledger-method job whose ledger is gone: the freshest record rt kept for
    its tree, but only one seen during the job's own lifetime, since pool trees
    are reused. rt stores a plan's finish only when it records, and the hook
    records at most once a minute, so this read asks rt to refresh first."""
    best = None
    for root in roots:
        for rec in tree_records(root, refresh=True) or []:
            seen = max(rec.get("lastSeen") or 0, rec.get("finishedAt") or 0)
            if rec.get("state") in {"done", "tree-gone"} and seen >= created_ms and (best is None or seen > best[0]):
                best = (seen, rec)
    return best[1] if best else None


def row(job, herd_id, gates, runs, now_s):
    since = job["createdAt"] / 1000
    roots = job_roots(job)
    live = job["status"] in LIVE
    reported = job["status"] in {"done", "closed"} and job.get("lastReport") is not None
    gate = gate_for(job, gates, herd_id) if live else None

    draft = fresh_draft(roots, since)
    brief = brief_text(herd_id, job["name"])
    meth = method(brief, draft)
    domain = meth not in STRATEGIES and meth != "delegate"
    run = run_for(job, runs, herd_id, roots) if domain else None
    found = None if run else newest_ledger(roots, since)
    done, total, now = ledger_progress(found[0], found[2]) if found else (0, 0, "")
    kept = None if run or found or meth not in LEDGER_METHODS else kept_record(job_trees(job), job["createdAt"])
    if kept:
        done, total, now = kept["done"], kept["total"], kept["latest"]
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
                written = re.search(rf"(?m)^\s*-?\s*{p}:", draft) or (p == "plan" and (found or kept))
                cols[p] = "✓" if reported or written else ""
        started = found or (meth in INLINE_METHODS and live)
        cols["exec"] = "✓" if reported or (known and total and done >= total) else ("▸" if started else "")
        cols["review"] = "✓" if reported else ("▸" if live and cols["exec"] == "✓" else "")
        if meth in INLINE_METHODS:
            cols["review"] = "·"
            now = "items in the report draft" if draft else "working inline, no ledger by design"
        elif meth == "delegate" and not found:
            now = "delegate: strategy not named yet"
        elif domain and not found and live:
            now = "no pipeline run yet"
    if live and not run and "▸" not in cols.values():
        for p in ("spec", "plan", "exec", "review"):
            if cols[p] == "":
                cols[p] = "▸"
                break

    pane_idle = live and job.get("paneStatus") in {"idle", "done"} and not gate
    run_going = bool(run) and run.get("status") == "running"
    idle = pane_idle and not run_going
    if pane_idle and run_going:
        now = f"{now}; pane idle"
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
        if found and now_s - found[1] > QUIET_S:
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


def done_tasks(text):
    """Task N is done on a `Task N: complete` line, or when every lettered part
    of N the ledger mentions has a `Task N<letter>: complete` line (rt's rule)."""
    explicit, mentioned, complete = set(), {}, {}
    for line in text.splitlines():
        m = re.match(r"Task\s+(\d+)([a-z]?):\s*(complete\b)?", line)
        if not m:
            continue
        n, letter, finished = m.groups()
        if not letter:
            if finished:
                explicit.add(n)
            continue
        mentioned.setdefault(n, set()).add(letter)
        if finished:
            complete.setdefault(n, set()).add(letter)
    return len(explicit | {n for n, parts in mentioned.items() if complete.get(n) == parts})


def ledger_now(text):
    """The ledger's last meaningful line, by rt's rule (latestLine). Ruling
    lines stay, since a ruling is often what the work is waiting on."""
    lines = [l.strip() for l in text.splitlines()[1:] if l.strip() and not re.match(r"(#|\||Spec:)", l.strip())]
    return re.sub(r"^Task\s+(\d+[a-z]?):\s*", r"T\1 ", lines[-1]) if lines else ""


def plan_stem(path):
    base = os.path.basename(path)
    return base[:-3] if base.endswith(".md") else base


def undated(stem):
    return re.sub(r"^\d{4}-\d{2}-\d{2}-", "", stem)


def spec_mark(tree, path, text):
    for line in text.splitlines()[:40]:
        ref = re.search(r"([\w./~-]+\.md)", line) if re.search(r"(?i)\bspec\b", line) else None
        if ref:
            ref = os.path.expanduser(ref.group(1))
            candidates = [ref] if os.path.isabs(ref) else [os.path.join(tree, ref), os.path.join(os.path.dirname(path), ref)]
            if any(os.path.isfile(c) for c in candidates):
                return "✓"
    return "·"


def git_toplevel(directory):
    try:
        out = subprocess.run(["git", "-C", directory, "rev-parse", "--show-toplevel"], capture_output=True, text=True)  # mcp-lint: allow
    except FileNotFoundError:
        return directory
    return out.stdout.strip() if out.returncode == 0 and out.stdout.strip() else directory


def plan_row(path, tree, records, error, now_s):
    """One plan's table line, plus its done and total task counts and whether
    its ledger has gone quiet."""
    stem = plan_stem(path)
    text = read(path)
    planned = len(set(re.findall(r"(?m)^#+\s*Task\s+(\d+)\b", text)))
    ledger = os.path.join(tree, ".superpowers", "sdd", stem, "progress.md")
    live = os.path.isfile(ledger)
    rec = next((r for r in records or [] if r.get("stem") == stem), None)
    exec_, review, quiet = "", "", False

    if rec and rec["state"] == "done":
        status, exec_, review, now = "done", "✓", "✓", "finished"
        done = total = rec["total"] or planned
    elif rec and rec["state"] == "tree-gone":
        status, exec_, review, now = "tree gone", "·", "·", rec["latest"]
        done, total = rec["done"], rec["total"]
    elif rec or live:
        done, total, now = (rec["done"], rec["total"], rec["latest"]) if rec else (done_tasks(read(ledger)), planned, "")
        if live:
            now = ledger_now(read(ledger)) or now
            quiet = now_s - mtime(ledger) > QUIET_S
        status = "*quiet*" if quiet else "running"
        if quiet:
            now = f"ledger quiet {age(now_s - mtime(ledger))}; {now}"
        exec_ = "▸"
        review = "▸" if total and done >= total else ""
    elif records is None:
        status, done, total = "unknown", 0, planned
        now = f"rt error: {error.splitlines()[0]}" if error else "not started or finished (rt has no record)"
    else:
        status, done, total, now = "not started", 0, planned, "not started"

    spec = spec_mark(tree, path, text)
    mark = "✓" if os.path.isfile(path) else "·"
    tasks = bar(done, total, status != "unknown")
    return f"| {undated(stem)} | {status} | {spec} | {mark} | {exec_} | {review} | {tasks} | {cell(now)} |", done, total, quiet


def plan_main(plans, tree, title):
    paths = [os.path.abspath(p) for p in plans]
    tree = os.path.realpath(tree) if tree else os.path.realpath(git_toplevel(os.path.dirname(paths[0])))
    records = tree_records(tree, refresh=True)
    error = tree_error(tree, refresh=True)
    now_s = time.time()
    results = [plan_row(p, tree, records, error, now_s) for p in paths]
    done = sum(r[1] for r in results)
    total = sum(r[2] for r in results)
    quiet = sum(1 for r in results if r[3])
    branch = tree_branch(tree) or next((r.get("branch") for r in records or [] if r.get("branch")), "") or "unknown"
    title = title or undated(plan_stem(paths[0]))
    filled = round(OVERALL_CELLS * done / total) if total else 0
    pct = round(100 * done / total) if total else 0
    stuck = f"{quiet} quiet" if quiet else "nothing stuck"
    print(f"**{title}** · branch {branch} · worktree {os.path.basename(tree)} · {done} of {total} tasks done · {stuck}")
    print()
    print(f"Overall `{'█' * filled}{'░' * (OVERALL_CELLS - filled)}` {pct}%")
    print()
    print("| plan | status | spec | plan | exec | review | tasks | now |")
    print("|---|---|:-:|:-:|:-:|:-:|---|---|")
    for line, *_ in results:
        print(line)


def parse_args(args):
    opts = {"--herd": None, "--tree": None, "--title": None, "--plan": []}
    for i in range(0, len(args), 2):
        flag = args[i]
        if flag not in opts or i + 1 >= len(args):
            sys.exit(f"work_progress: {'missing value for' if flag in opts else 'unknown argument'} {flag}")
        if flag == "--plan":
            opts[flag].append(args[i + 1])
        else:
            opts[flag] = args[i + 1]
    return opts


def herd_main(herd_arg):
    status = rt_json(["herd", "status", "--herd", herd_arg])
    herd_id = status["herd"]["id"]
    gates = rt_json(["herd", "gates", "--herd", herd_id]).get("gates", [])
    runs = rt_json(["runs"], required=False).get("runs", [])
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


def main():
    opts = parse_args(sys.argv[1:])
    if opts["--herd"] and opts["--plan"]:
        sys.exit("work_progress: name a herd or plans, not both")
    if opts["--herd"]:
        herd_main(opts["--herd"])
    elif opts["--plan"]:
        plan_main(opts["--plan"], opts["--tree"], opts["--title"])
    else:
        sys.exit("work_progress: name a herd (--herd <id>) or the plans to show (--plan <path> ...)")


if __name__ == "__main__":
    main()
