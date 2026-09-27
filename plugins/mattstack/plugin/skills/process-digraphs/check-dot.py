#!/usr/bin/env python3
"""Structure-check every ```dot block in a markdown file (or one .dot file).

Usage: python3 check-dot.py <SKILL.md | graph.dot> [...]
Exit 0 when every graph passes, 1 on any finding, 2 on a usage or parse error.

Graphviz parses the graph (dot -Tjson), so a block that renders is exactly the
block that is checked.
"""
import json
import re
import subprocess
import sys

FENCE_OPEN = re.compile(r"^```dot\s*$")
INDENTED_FENCE = re.compile(r"^\s+```dot\s*$")
FENCE_CLOSE = re.compile(r"^`{3,}\s*$")
TERMINALS = {"doublecircle", "octagon"}


def blocks(path):
    text = open(path, encoding="utf-8").read()
    if path.endswith(".dot"):
        return [(1, text)], []
    found, problems, lines = [], [], text.splitlines()
    i = 0
    while i < len(lines):
        if INDENTED_FENCE.match(lines[i]):
            problems.append(f"{path}:{i + 1}: dot fence is indented; fences must start at column 1 or render.sh and certify skip the block")
        if FENCE_OPEN.match(lines[i]):
            start, body, i = i + 1, [], i + 1
            while i < len(lines) and not FENCE_CLOSE.match(lines[i]):
                body.append(lines[i])
                i += 1
            if i == len(lines):
                problems.append(f"{path}:{start}: dot fence never closed")
            found.append((start, "\n".join(body)))
        i += 1
    return found, problems


def parse(src):
    run = subprocess.run(["dot", "-Tjson"], input=src, capture_output=True, text=True)
    if run.returncode != 0:
        return None, run.stderr.strip() or "dot failed"
    if run.stderr.strip():
        return None, "graphviz warning: " + run.stderr.strip()
    return json.loads(run.stdout), None


def check(graph):
    objects = [o for o in graph.get("objects", []) if "nodes" not in o]
    names = [o.get("name", "") for o in objects]
    shape = {i: o.get("shape", "ellipse") for i, o in enumerate(objects)}
    index = {o["_gvid"]: i for i, o in enumerate(objects)}
    out, into = {i: [] for i in index.values()}, {i: 0 for i in index.values()}
    into_labels = {i: [] for i in index.values()}
    for e in graph.get("edges", []):
        t, h = index.get(e["tail"]), index.get(e["head"])
        if t is None or h is None:
            continue
        out[t].append((h, e.get("label", "")))
        into[h] += 1
        into_labels[h].append(e.get("label", ""))

    problems = []
    for i, name in enumerate(names):
        label = objects[i].get("label", "\\N")
        if label not in ("\\N", name):
            problems.append(f'"{name}": opaque id with a separate label; make the sentence the node id')
        if shape[i] == "diamond":
            if not name.rstrip().endswith("?"):
                problems.append(f'"{name}": a decision (diamond) is phrased as a question ending in "?"')
            if len(out[i]) < 2:
                problems.append(f'"{name}": a decision needs an out-edge for every outcome (found {len(out[i])})')
            for h, lab in out[i]:
                if not lab.strip():
                    problems.append(f'"{name}" -> "{names[h]}": decision edge has no label')
        if shape[i] == "octagon" and not name.startswith("STOP"):
            problems.append(f'"{name}": an octagon is a STOP; start its text with "STOP:"')
        if shape[i] == "plaintext" and "\n" in name:
            problems.append(f'"{name[:40]}...": a plaintext node is one short command or tool call, not a code block')
        if not out[i] and shape[i] not in TERMINALS:
            problems.append(f'"{name}": dead end; only a doublecircle outcome or a STOP octagon may have no way out')
        if out[i] and shape[i] == "doublecircle":
            problems.append(f'"{name}": an outcome ends the path; it has {len(out[i])} outgoing edge(s)')
        if shape[i] == "octagon" and len(out[i]) > 1:
            problems.append(f'"{name}": a STOP has at most one way out (found {len(out[i])}); a choice after it is a gate step')
        if shape[i] == "octagon" and len(out[i]) == 1:
            h = out[i][0][0]
            guard = bool(into_labels[i]) and all(lab.strip().lower().startswith("tempted") for lab in into_labels[i])
            if not (guard or shape[h] == "doublecircle" or "off-script" in names[h].lower()):
                problems.append(f'"{name}" -> "{names[h]}": only a guard STOP (every edge in is labelled "tempted to ...") redirects to a step; any other STOP ends, or exits to an outcome or the off-script gate')

    success = [i for i, o in enumerate(objects) if shape[i] == "doublecircle" and o.get("style", "") == "filled"]
    if not success:
        problems.append("no success terminal: add one doublecircle with style=filled fillcolor=lightgreen")

    entries = [i for i in out if into[i] == 0]
    if not entries:
        problems.append("no entry: every node has an incoming edge, so the process has no start")
    seen, stack = set(entries), list(entries)
    while stack:
        n = stack.pop()
        for h, _ in out[n]:
            if h not in seen:
                seen.add(h)
                stack.append(h)
    for i, name in enumerate(names):
        if i not in seen:
            problems.append(f'"{name}": unreachable from any entry')

    for comp in cycles(out):
        exits = any(shape[n] == "diamond" and any(h not in comp for h, _ in out[n]) for n in comp)
        if not exits:
            loop = ", ".join(f'"{names[n]}"' for n in sorted(comp))
            problems.append(f"unbounded loop: no decision edge leaves it: {loop}")
    return problems


def cycles(out):
    """Strongly connected components that contain a cycle (Tarjan)."""
    index, low, on, stack, comps, counter = {}, {}, set(), [], [], [0]

    def visit(v):
        index[v] = low[v] = counter[0]
        counter[0] += 1
        stack.append(v)
        on.add(v)
        for w, _ in out[v]:
            if w not in index:
                visit(w)
                low[v] = min(low[v], low[w])
            elif w in on:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            comp = set()
            while True:
                w = stack.pop()
                on.discard(w)
                comp.add(w)
                if w == v:
                    break
            if len(comp) > 1 or any(h == v for h, _ in out[v]):
                comps.append(comp)

    sys.setrecursionlimit(10000)
    for v in out:
        if v not in index:
            visit(v)
    return comps


def main(paths):
    if not paths:
        print("usage: check-dot.py <SKILL.md | graph.dot> [...]", file=sys.stderr)
        return 2
    failed, total = False, 0
    for path in paths:
        found, problems = blocks(path)
        for p in problems:
            print(p)
            failed = True
        if not found and not path.endswith(".dot"):
            print(f"{path}: no ```dot block found")
            failed = True
        for line, src in found:
            total += 1
            graph, err = parse(src)
            if err:
                print(f"{path}:{line}: {err}")
                failed = True
                continue
            for p in check(graph):
                print(f"{path}:{line}: {p}")
                failed = True
    print(f"{total} graph(s) checked, {'FAIL' if failed else 'ok'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
