#!/usr/bin/env python3
"""Pick the account for the next shepherdr worker pane.

Scores each in-pool account by its binding constraint: the worst of the
5-hour pct, 7-day pct, and the per-model scoped pct matching --model.
Accounts at or over the threshold (cswap autoswitch.threshold unless
--threshold) are excluded. Accounts already assigned panes this run
(--assigned, repeat the number once per pane) get +5 per pane so rapid
spawns spread before cswap's usage data catches up. Lowest effective
score wins; ties break on lower 7-day pct.

Python, not bash: macOS ships bash 3.2 (same reason as herd-monitor.py).

With --headroom, picks nothing: prints one display line per pool account
(email, per-model scoped pcts with EXHAUSTED callouts, 5h/7d, binding for
the given model mix) for the shepherd's account question. --model then
accepts a comma-separated model list; binding is the worst across them.
Scoped pools are why this exists: an account can be exhausted for one
model (Fable) while showing plenty of overall headroom.

Usage:
    pick-account.py --pool 2,3 [--model claude-fable-5]
                    [--assigned 3,3] [--json-file dump.json]
                    [--threshold 90]
    pick-account.py --headroom --pool 1,2,3 [--model fable,sonnet]
                    [--json-file dump.json] [--threshold 90]

Exit 0: stdout is the account number (pick mode) or the display lines
(headroom mode); stderr one rationale line (pick mode only).
Exit 1: pick mode with no qualifying account; stderr lists each pool
account's binding.
"""
import argparse
import json
import subprocess
import sys

SPREAD_PENALTY = 5.0


def load_accounts(json_file):
    if json_file:
        with open(json_file) as f:
            return json.load(f)
    proc = subprocess.run(
        ["cswap", "list", "--json"], capture_output=True, text=True, timeout=30
    )
    if proc.returncode != 0:
        sys.exit(f"pick-account: cswap list failed: {proc.stderr.strip()}")
    return json.loads(proc.stdout)


def load_threshold(cli_value):
    if cli_value is not None:
        return cli_value
    proc = subprocess.run(
        ["cswap", "config"], capture_output=True, text=True, timeout=30
    )
    for line in proc.stdout.splitlines():
        parts = line.split()
        if parts and parts[0] == "autoswitch.threshold":
            try:
                return float(parts[1])
            except (IndexError, ValueError):
                break
    return 90.0


def binding_pct(account, model):
    usage = account.get("usage") or {}
    pcts = [
        (usage.get("fiveHour") or {}).get("pct") or 0.0,
        (usage.get("sevenDay") or {}).get("pct") or 0.0,
    ]
    if model:
        wanted = model.lower()
        for scoped in usage.get("scoped") or []:
            name = (scoped.get("name") or "").lower()
            if name and (name in wanted or wanted in name):
                pcts.append(scoped.get("pct") or 0.0)
    return max(pcts)


def headroom_lines(pool, models, by_number, threshold):
    """Display lines for the account question, one per pool account."""
    lines = []
    for number in pool:
        account = by_number.get(number)
        if account is None:
            lines.append(f"{number}: not in cswap list")
            continue
        usage = account.get("usage") or {}
        parts = []
        for model in models:
            wanted = model.lower()
            for scoped in usage.get("scoped") or []:
                name = (scoped.get("name") or "").lower()
                if name and (name in wanted or wanted in name):
                    pct = scoped.get("pct") or 0.0
                    label = scoped.get("name")
                    if pct >= threshold:
                        parts.append(f"{label} EXHAUSTED ({pct:.0f}%)")
                    else:
                        parts.append(f"{label} {pct:.0f}%")
        five = (usage.get("fiveHour") or {}).get("pct") or 0.0
        seven = (usage.get("sevenDay") or {}).get("pct") or 0.0
        parts.append(f"5h {five:.0f}%")
        parts.append(f"7d {seven:.0f}%")
        binding = max((binding_pct(account, m) for m in models), default=0.0) \
            if models else binding_pct(account, "")
        parts.append(f"binding {binding:.0f}%")
        email = account.get("alias") or account.get("email") or "?"
        lines.append(f"{number} {email}: " + ", ".join(parts))
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", required=True)
    ap.add_argument("--model", default="")
    ap.add_argument("--assigned", default="")
    ap.add_argument("--json-file")
    ap.add_argument("--threshold", type=float)
    ap.add_argument("--headroom", action="store_true")
    args = ap.parse_args()

    try:
        pool = [int(n) for n in args.pool.split(",") if n]
        assigned = [int(n) for n in args.assigned.split(",") if n]
    except ValueError as e:
        sys.exit(f"pick-account: invalid --pool/--assigned value: {e}")
    threshold = load_threshold(args.threshold)
    data = load_accounts(args.json_file)
    by_number = {a["number"]: a for a in data.get("accounts", [])}

    if args.headroom:
        models = [m for m in args.model.split(",") if m]
        for line in headroom_lines(pool, models, by_number, threshold):
            print(line)
        return

    candidates = []
    excluded = []
    for number in pool:
        account = by_number.get(number)
        if account is None:
            print(f"pick-account: account {number} not in cswap list",
                  file=sys.stderr)
            continue
        pct = binding_pct(account, args.model)
        if pct >= threshold:
            excluded.append((number, pct))
            continue
        effective = pct + SPREAD_PENALTY * assigned.count(number)
        seven_day = ((account.get("usage") or {})
                     .get("sevenDay") or {}).get("pct") or 0.0
        candidates.append((effective, seven_day, number, pct))

    if not candidates:
        detail = ", ".join(f"{n}={p:.0f}%" for n, p in excluded)
        sys.exit("pick-account: no pool account under threshold "
                 f"{threshold:.0f}% ({detail or 'none found'})")

    effective, seven_day, number, pct = min(candidates)
    print(f"pick-account: chose {number} "
          f"(binding {pct:.0f}%, effective {effective:.0f}%, "
          f"7d {seven_day:.0f}%, threshold {threshold:.0f}%)",
          file=sys.stderr)
    print(number)


if __name__ == "__main__":
    main()
