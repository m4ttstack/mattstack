#!/usr/bin/env python3
"""Structure-check every ```dot block in a markdown file (or one .dot file).

Usage: python3 check-dot.py [--warn-only] [--short-ids] <SKILL.md | graph.dot> [...]
Exit 0 when every graph passes, 1 on any finding, 2 on a usage or parse error.

Graphviz parses the graph (dot -Tjson), so a block that renders is exactly the
block that is checked.
Warnings print as "warn:" lines and fail the run like any finding;
--warn-only prints them without failing. --strict is accepted and does nothing.
--short-ids also fails a graph whose nodes are all sentence ids.
"""
import json
import re
import subprocess
import sys

FENCE_OPEN = re.compile(r"^```dot\s*$")
INDENTED_FENCE = re.compile(r"^\s+```dot\s*$")
FENCE_CLOSE = re.compile(r"^`{3,}\s*$")
ANY_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
TERMINALS = {"doublecircle", "octagon"}
TEMPTED = re.compile(r"^\s*tempted", re.IGNORECASE)


def two_calls(name):
    quote_openers = {}
    stack, opens, closes = [], set(), set()
    for i, ch in enumerate(name):
        if ch in "\"`":
            if ch in quote_openers:
                opens.add(quote_openers.pop(ch))
                closes.add(i)
            else:
                quote_openers[ch] = i
        elif quote_openers:
            continue
        elif ch in "{<(":
            stack.append(i)
        elif ch in "}>)":
            if stack:
                opens.add(stack.pop())
                closes.add(i)
    depth, flat = 0, []
    for i, ch in enumerate(name):
        if i in opens:
            depth += 1
            ch = " "
        elif i in closes:
            depth = max(depth - 1, 0)
            ch = " "
        flat.append(ch if depth == 0 else " ")
    return ", or " in "".join(flat)


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
    seen, fence = {}, None
    for n, line in enumerate(lines, 1):
        m = ANY_FENCE.match(line)
        if m and (fence is None or (m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not line.strip()[len(m.group(1)):].strip())):
            fence = None if fence else m.group(1)
            continue
        if fence is None and line.startswith("### "):
            head = line[4:].strip()
            if head in seen:
                problems.append(f"{path}:{n}: duplicate section \"### {head}\" (first at line {seen[head]}); give each node distinct text")
            else:
                seen[head] = n
    return found, problems


def parse(src):
    run = subprocess.run(["dot", "-Tjson"], input=src, capture_output=True, text=True)
    if run.returncode != 0:
        return None, run.stderr.strip() or "dot failed"
    if run.stderr.strip():
        return None, "graphviz warning: " + run.stderr.strip()
    return json.loads(run.stdout), None


def node_text(obj):
    label = obj.get("label", "\\N")
    return obj.get("name", "") if label == "\\N" else label


def call_prefix(text):
    text = re.sub(r"^([A-Za-z_][A-Za-z0-9_]*=(?:<[^>]*>|\"[^\"]*\"|'[^']*'|[^\s<\"'])*\s+)+", "", text)
    word = re.match(r"[A-Za-z0-9_-]+", text)
    word = word.group(0) if word else ""
    word = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", word).replace("-", "_").lower()
    return re.sub(r"_+", "_", re.sub(r"[0-9]", "", word)).strip("_")


def double_declared(src):
    seen = {}
    blanked = re.sub(r'"(?:\\.|[^"\\])*"', lambda s: '"' + " " * (len(s.group(0)) - 2) + '"', src, flags=re.S)
    for m in re.finditer(r"(?m)(?:^|[{;])\s*([a-z][a-z_]*)\s*\[", blanked):
        if blanked[: m.start(1)].rstrip().endswith(("->", "--")):
            continue
        seen[m.group(1)] = seen.get(m.group(1), 0) + 1
    return [n for n, c in seen.items() if c > 1 and n not in ("node", "edge", "graph")]


def check(graph, short_ids=False):
    objects = [o for o in graph.get("objects", []) if "nodes" not in o]
    ids = [o.get("name", "") for o in objects]
    names = [node_text(o) for o in objects]
    labelled = [o.get("label", "\\N") != "\\N" for o in objects]
    shown = [f'"{t}"' + (f" [{n}]" if n != t else "") for t, n in zip(names, ids)]
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
    warnings = []
    if any(labelled) and not all(labelled):
        bare = ", ".join(f'"{n}"' for n, l in zip(ids, labelled) if not l)
        problems.append(f"graph labels some nodes and not others ({bare}); label every node or none")
    if short_ids and not any(labelled):
        problems.append("graph uses sentence ids; give every node a short id with its sentence as label")
    for text in sorted({t for t in names if names.count(t) > 1}):
        problems.append(f'"{text}": two nodes share the text; give each step distinct text')
    for i, name in enumerate(names):
        if labelled[i]:
            if not re.fullmatch(r"[a-z]+(_[a-z]+)*", ids[i]):
                problems.append(f"{shown[i]}: a short id is lowercase words joined by underscores, no digits")
            if shape[i] == "plaintext":
                prefix = call_prefix(name)
                if not prefix:
                    problems.append(f'"{name}" [{ids[i]}]: a plaintext label starts with its call word')
                elif ids[i] != prefix and not ids[i].startswith(prefix + "_"):
                    problems.append(f"{shown[i]}: a plaintext short id starts with its call ({prefix})")
            if shape[i] == "octagon" and not ids[i].startswith("stop_"):
                problems.append(f"{shown[i]}: a STOP's short id starts with stop_")
        if shape[i] == "diamond":
            if not name.rstrip().endswith("?"):
                problems.append(f'{shown[i]}: a decision (diamond) is phrased as a question ending in "?"')
            if len(out[i]) < 2:
                problems.append(f'{shown[i]}: a decision needs an out-edge for every outcome (found {len(out[i])})')
            for h, lab in out[i]:
                if not lab.strip():
                    problems.append(f'{shown[i]} -> {shown[h]}: decision edge has no label')
        if shape[i] == "octagon" and not name.startswith("STOP"):
            problems.append(f'{shown[i]}: an octagon is a STOP; start its text with "STOP:"')
        if shape[i] == "plaintext" and "\n" in name:
            problems.append(f'"{name[:40]}..."{shown[i][len(name) + 2:]}: a plaintext node is one short command or tool call, not a code block')
        if shape[i] == "plaintext" and two_calls(name):
            warnings.append(f'{shown[i]}: two calls in one plaintext node; give each call its own node behind a decision (for example "Forge?")')
        for h, lab in out[i]:
            if not TEMPTED.match(lab):
                continue
            if shape[h] != "octagon":
                problems.append(f'{shown[i]} -> {shown[h]}: a tempted edge leads into a STOP, never a step; the sanctioned move takes its own edge')
            if shape[i] != "diamond":
                warnings.append(f'{shown[i]} -> {shown[h]}: a tempted edge leaves a step, not a decision; draw the decision the temptation branches from')
        if not out[i] and shape[i] not in TERMINALS:
            problems.append(f'{shown[i]}: dead end; only a doublecircle outcome or a STOP octagon may have no way out')
        if out[i] and shape[i] == "doublecircle":
            problems.append(f'{shown[i]}: an outcome ends the path; it has {len(out[i])} outgoing edge(s)')
        unlabelled = [h for h, lab in out[i] if not lab.strip()]
        if shape[i] not in ("diamond", "octagon") and len(unlabelled) > 1:
            problems.append(f'{shown[i]}: {len(unlabelled)} unlabelled out-edges; two steps share this text and dot merged them, or a decision is hidden in a step')
        if shape[i] == "octagon" and len(out[i]) > 1:
            problems.append(f'{shown[i]}: a STOP has at most one way out (found {len(out[i])}); a choice after it is a gate step')
        if shape[i] == "octagon" and len(out[i]) == 1:
            h = out[i][0][0]
            guard = bool(into_labels[i]) and all(lab.strip().lower().startswith("tempted") for lab in into_labels[i])
            if not (guard or shape[h] == "doublecircle" or "off-script" in names[h].lower()):
                problems.append(f'{shown[i]} -> {shown[h]}: only a guard STOP (every edge in is labelled "tempted to ...") redirects to a step; any other STOP ends, or exits to an outcome or the off-script gate')

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
    for i in range(len(names)):
        if i not in seen:
            problems.append(f'{shown[i]}: unreachable from any entry')

    for comp in cycles(out):
        exits = any(shape[n] == "diamond" and any(h not in comp for h, _ in out[n]) for n in comp)
        if not exits:
            loop = ", ".join(shown[n] for n in sorted(comp))
            problems.append(f"unbounded loop: no decision edge leaves it: {loop}")
    return problems, warnings


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


def main(argv):
    warn_only = "--warn-only" in argv
    short_ids = "--short-ids" in argv
    paths = [a for a in argv if a not in ("--strict", "--warn-only", "--short-ids")]
    if not paths:
        print("usage: check-dot.py [--warn-only] [--short-ids] <SKILL.md | graph.dot> [...]", file=sys.stderr)
        return 2
    failed, total, warned = False, 0, []
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
            problems, warnings = check(graph, short_ids)
            problems += [f'"{n}": declared twice; declare each node once (dot merges the statements into one step)' for n in double_declared(src)]
            for p in problems:
                print(f"{path}:{line}: {p}")
                failed = True
            warned += [f"{path}:{line}: warn: {w}" for w in warnings]
    # certify shows only the first lines of a failure, so failures print before warnings.
    for w in warned:
        print(w)
    failed = failed or (not warn_only and bool(warned))
    print(f"{total} graph(s) checked, {'FAIL' if failed else 'ok'}, {len(warned)} warning(s)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
