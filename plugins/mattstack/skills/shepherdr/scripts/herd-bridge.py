#!/usr/bin/env python3
"""Bridge herdr pane lifecycle onto the rt event bus.

Watches jobs with status='active' in the herd DB, polls `pane list`
through the hrd shim (SHEPHERDR_HERD_SESSION keeps working), and emits
shepherdr/<run>/<job>/blocked on transitions into blocked and .../gone
once when a watched pane vanishes. A pane's FIRST sighting also emits
when it is already blocked or gone (so a pane that starts blocked, or one
whose gone-ness is discovered on the bridge's first cycle watching it,
isn't silently swallowed); a first sighting in any other status just
records, with no emit. When an emit fails (bus absent), it
prints the transition instead -- which is the old herd-monitor.py behavior,
so the same process serves bus and degraded modes.

Previous pane states persist in state.bridge_prev, so restarts and --once
cycles keep transition detection.

Usage:
    herd-bridge.py --db <herd.db> [--interval 30] [--once]
"""
import argparse
import json
import os
import subprocess
import time

import herd_db

HERE = os.path.dirname(os.path.abspath(__file__))
HRD = os.environ.get("SHEPHERDR_HRD", os.path.join(HERE, "hrd"))


def collect_panes(node, found):
    """Find {pane_id: agent_status} anywhere in the pane-list JSON."""
    if isinstance(node, dict):
        if "pane_id" in node:
            found[node["pane_id"]] = node.get("agent_status", "unknown")
        for v in node.values():
            collect_panes(v, found)
    elif isinstance(node, list):
        for v in node:
            collect_panes(v, found)


def snapshot():
    proc = subprocess.run([HRD, "pane", "list"], capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        return None
    found = {}
    try:
        collect_panes(json.loads(proc.stdout), found)
    except json.JSONDecodeError:
        return None
    return found


def emit_or_print(run, job, kind, pane, old):
    topic = f"shepherdr/{run}/{job}/{kind}"
    try:
        proc = subprocess.run(
            ["rt", "events", "emit", topic, "--json", "{}"],
            capture_output=True, text=True, timeout=30,
        )
        if proc.returncode == 0:
            return
    except Exception:
        pass
    print(f"{pane} {old} -> {kind} ({job})", flush=True)


def cycle(conn):
    run = herd_db.get_state(conn, "run_id")
    prev = json.loads(herd_db.get_state(conn, "bridge_prev") or "{}")
    watch = {
        r["pane"]: r["job"]
        for r in conn.execute("SELECT pane, job FROM jobs WHERE status='active' AND pane IS NOT NULL")
    }
    snap = snapshot()
    if snap is None:
        print("herd-bridge: `pane list` failed", flush=True)
        return
    cur = {}
    for pane, job in watch.items():
        status = snap.get(pane, "gone")
        cur[pane] = status
        old = prev.get(pane)
        if old is None:
            if status not in ("blocked", "gone"):
                continue
        elif old == status:
            continue
        if status == "blocked":
            emit_or_print(run, job, "blocked", pane, old)
        elif status == "gone":
            emit_or_print(run, job, "gone", pane, old)
    herd_db.set_state(conn, "bridge_prev", json.dumps(cur))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--interval", type=int, default=30)
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()
    conn = herd_db.connect(args.db)
    if args.once:
        cycle(conn)
        return
    while True:
        cycle(conn)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
