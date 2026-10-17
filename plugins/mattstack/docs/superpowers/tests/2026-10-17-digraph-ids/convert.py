#!/usr/bin/env python3
"""Give long dot nodes short ids and keep their sentence as the label.

Usage:
  convert.py --scheme <scheme> <in.md> [out.md]   rewrite every ```dot block
  convert.py --measure <file.md> [...]            word counts per scheme
  convert.py --breakdown <file.md> [...]          id words per node shape today
  convert.py --verify <file.md> [...]             every scheme keeps each graph

Schemes say which nodes get a short id; every other node keeps its sentence
as its quoted id:
  all          every node
  plaintext    plaintext nodes (one tool call or command)
  calls+boxes  plaintext and box nodes; decisions, STOPs, triggers and
               outcomes keep their sentence
  over:N       any node whose text is longer than N words

A converted node is declared once as `slug [label="<sentence>" ...]`; edges
name the slug. Words are counted like `wc -w` (whitespace-separated runs).
Only fences that open at column 1 are rewritten, the same blocks render.sh
and check-dot.py read.
"""
import re
import sys

FENCE_OPEN = re.compile(r"^```dot\s*$")
FENCE_CLOSE = re.compile(r"^`{3,}\s*$")
TOKEN = re.compile(
    r'(?P<ws>\s+)|(?P<comment>//[^\n]*|/\*.*?\*/|#[^\n]*)|(?P<str>"(?:\\.|[^"\\])*")'
    r"|(?P<arrow>->|--)|(?P<punct>[\[\]{};,=])|(?P<id>[^\s\[\]{};,=\"]+)",
    re.S,
)
KEYWORDS = {"node", "edge", "graph", "digraph", "subgraph", "strict"}
STOPWORDS = {"a", "an", "the", "is", "are", "was", "of", "to", "for", "on", "in", "and", "or",
             "it", "its", "this", "that", "with", "by", "at", "be", "do", "does", "any", "every"}
SCHEMES = ["all", "plaintext", "calls+boxes", "over:3", "over:5", "over:8"]
SHAPES = ["plaintext", "box", "diamond", "octagon", "ellipse", "doublecircle"]


def tokens(src):
    out, pos = [], 0
    while pos < len(src):
        m = TOKEN.match(src, pos)
        if not m:
            raise ValueError(f"cannot tokenize at {src[pos:pos + 30]!r}")
        out.append((m.lastgroup, m.group()))
        pos = m.end()
    return out


def significant(toks, i, step):
    i += step
    while 0 <= i < len(toks) and toks[i][0] in ("ws", "comment"):
        i += step
    return i


def unquote(s):
    return re.sub(r'\\(.)', r"\1", s[1:-1])


def attrs_after(toks, i):
    """The attribute list's tokens when the token after i opens one, else None."""
    j = significant(toks, i, 1)
    if j >= len(toks) or toks[j][1] != "[":
        return None, j
    k = j
    while k < len(toks) and toks[k][1] != "]":
        k += 1
    return toks[j:k + 1], j


def shape_of(attr_toks):
    vals = [t for t in attr_toks if t[0] in ("id", "str", "punct")]
    for a, b, c in zip(vals, vals[1:], vals[2:]):
        if a[1] == "shape" and b[1] == "=":
            return unquote(c[1]) if c[0] == "str" else c[1]
    return None


def node_positions(toks):
    """Indices of tokens that name a node, and whether each is a declaration."""
    found, depth = [], 0
    for i, (kind, text) in enumerate(toks):
        if text == "[":
            depth += 1
        elif text == "]":
            depth -= 1
        if depth or kind not in ("str", "id"):
            continue
        prev = significant(toks, i, -1)
        prev_t = toks[prev][1] if prev >= 0 else ""
        nxt = significant(toks, i, 1)
        nxt_t = toks[nxt][1] if nxt < len(toks) else ""
        if prev_t == "=" or nxt_t == "=" or prev_t.lower() in KEYWORDS or text.lower() in KEYWORDS:
            continue
        found.append((i, prev_t != "->" and nxt_t != "->"))
    return found


def make_slug(text, shape, taken):
    if shape == "plaintext":
        head = re.match(r"[A-Za-z_][A-Za-z0-9_]*", text)
        words = [head.group()] if head else []
        tail = re.split(r"[}\]]\s*:\s*", text, maxsplit=1)
        if len(tail) == 2:
            words += [w for w in re.findall(r"[a-z0-9]+", tail[1].lower()) if w not in STOPWORDS][:2]
        elif not head or " " in text.split("{")[0].strip():
            words = re.findall(r"[a-z0-9]+", text.split("{")[0].lower())[:3]
    else:
        words = [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOPWORDS]
        words = (["stop"] if text.startswith("STOP") else []) + [w for w in words if w != "stop"][:3]
    base = "_".join(words) or "node"
    if not re.match(r"[A-Za-z_]", base):
        base = "n_" + base
    slug, n = base, 2
    while slug in taken or slug.lower() in KEYWORDS:
        slug, n = f"{base}_{n}", n + 1
    taken.add(slug)
    return slug


def chosen(scheme, text, shape):
    if scheme == "all":
        return True
    if scheme == "plaintext":
        return shape == "plaintext"
    if scheme == "calls+boxes":
        return shape in ("plaintext", "box")
    if scheme.startswith("over:"):
        return len(text.split()) > int(scheme[5:])
    raise ValueError(f"unknown scheme {scheme}")


def convert_block(src, scheme):
    toks = tokens(src)
    positions = node_positions(toks)
    shapes, declared = {}, {}
    for i, is_decl in positions:
        name = unquote(toks[i][1]) if toks[i][0] == "str" else toks[i][1]
        if is_decl:
            attr, _ = attrs_after(toks, i)
            if attr and shape_of(attr):
                shapes.setdefault(name, shape_of(attr))
            declared.setdefault(name, i)
    slugs, taken = {}, set()
    for i, _ in positions:
        name = unquote(toks[i][1]) if toks[i][0] == "str" else toks[i][1]
        if toks[i][0] != "str" or name in slugs or name not in declared:
            continue
        if chosen(scheme, name, shapes.get(name, "ellipse")):
            slugs[name] = make_slug(name, shapes.get(name, "ellipse"), taken)
    out = [t[1] for t in toks]
    for i, _ in positions:
        name = unquote(toks[i][1]) if toks[i][0] == "str" else toks[i][1]
        if name not in slugs:
            continue
        if declared[name] == i:
            attr, j = attrs_after(toks, i)
            if attr is None:
                out[i] = f"{slugs[name]} [label={toks[i][1]}]"
            else:
                out[i] = slugs[name]
                out[j] = f"[label={toks[i][1]} "
        else:
            out[i] = slugs[name]
    return "".join(out), slugs


def convert_markdown(text, scheme):
    lines, out, i, all_slugs = text.split("\n"), [], 0, []
    while i < len(lines):
        out.append(lines[i])
        if FENCE_OPEN.match(lines[i]):
            body = []
            i += 1
            while i < len(lines) and not FENCE_CLOSE.match(lines[i]):
                body.append(lines[i])
                i += 1
            new, slugs = convert_block("\n".join(body), scheme)
            all_slugs.append(slugs)
            out.extend(new.split("\n"))
            if i < len(lines):
                out.append(lines[i])
        i += 1
    return "\n".join(out), all_slugs


def graph_words(text):
    total, inside = 0, False
    for line in text.split("\n"):
        if not inside and FENCE_OPEN.match(line):
            inside = True
        elif inside and FENCE_CLOSE.match(line):
            inside = False
        elif inside:
            total += len(line.split())
    return total


def measure(paths):
    head = f"| file | scheme | words | graph words | saved | saved % |"
    print(head)
    print("|---|---|---|---|---|---|")
    for path in paths:
        text = open(path, encoding="utf-8").read()
        base, gbase = len(text.split()), graph_words(text)
        name = path.rsplit("/", 1)[-1]
        print(f"| {name} | full text (today) | {base:,} | {gbase:,} | 0 | 0.0 |")
        for scheme in SCHEMES:
            new, _ = convert_markdown(text, scheme)
            words = len(new.split())
            saved = base - words
            print(f"| {name} | {scheme} | {words:,} | {graph_words(new):,} | {saved:,} | {100 * saved / base:.1f} |")


def breakdown(paths):
    """Words each shape's ids cost today, and what a short id for that shape saves.

    A short id adds one word where the node is declared (the slug beside its
    label) and saves all but one word at every edge mention.
    """
    print("| file | shape | nodes | words in ids (decl + edges) | words saved by a short id |")
    print("|---|---|---|---|---|")
    for path in paths:
        text = open(path, encoding="utf-8").read()
        cost = {s: [0, 0, 0] for s in SHAPES}
        lines, i = text.split("\n"), 0
        while i < len(lines):
            if FENCE_OPEN.match(lines[i]):
                body = []
                i += 1
                while i < len(lines) and not FENCE_CLOSE.match(lines[i]):
                    body.append(lines[i])
                    i += 1
                toks = tokens("\n".join(body))
                shapes, seen = {}, set()
                positions = node_positions(toks)
                for j, is_decl in positions:
                    attr, _ = attrs_after(toks, j) if is_decl else (None, 0)
                    if attr and shape_of(attr):
                        shapes.setdefault(toks[j][1], shape_of(attr))
                for j, _ in positions:
                    if toks[j][0] != "str":
                        continue
                    row = cost.setdefault(shapes.get(toks[j][1], "ellipse"), [0, 0, 0])
                    words = len(unquote(toks[j][1]).split())
                    if toks[j][1] not in seen:
                        seen.add(toks[j][1])
                        row[0] += 1
                        row[2] -= 1
                    else:
                        row[2] += words - 1
                    row[1] += words
            i += 1
        name = path.rsplit("/", 1)[-1]
        for shape, (n, words, saved) in cost.items():
            if n:
                print(f"| {name} | {shape} | {n} | {words:,} | {saved:,} |")


def verify(paths):
    """Fail unless each scheme's graphs match today's: same node texts, shapes and edges."""
    import json
    import subprocess

    def shape_of_graph(src):
        run = subprocess.run(["dot", "-Tjson"], input=src, capture_output=True, text=True, check=True)
        g = json.loads(run.stdout)
        objs = [o for o in g.get("objects", []) if "nodes" not in o]
        text = {o["_gvid"]: (o["name"] if o.get("label", "\\N") == "\\N" else o["label"]) for o in objs}
        nodes = sorted((text[o["_gvid"]], o.get("shape", ""), o.get("style", ""), o.get("fillcolor", "")) for o in objs)
        edges = sorted((text[e["tail"]], text[e["head"]], e.get("label", ""), e.get("style", "")) for e in g.get("edges", []))
        return nodes, edges

    def graphs(text):
        found, lines, i = [], text.split("\n"), 0
        while i < len(lines):
            if FENCE_OPEN.match(lines[i]):
                body = []
                i += 1
                while i < len(lines) and not FENCE_CLOSE.match(lines[i]):
                    body.append(lines[i])
                    i += 1
                found.append(shape_of_graph("\n".join(body)))
            i += 1
        return found

    bad = 0
    for path in paths:
        text = open(path, encoding="utf-8").read()
        want = graphs(text)
        for scheme in SCHEMES:
            got = graphs(convert_markdown(text, scheme)[0])
            ok = got == want
            bad += not ok
            print(f"{'ok  ' if ok else 'FAIL'} {path.rsplit('/', 1)[-1]} {scheme}: {len(want)} graph(s)")
    return 1 if bad else 0


def main(argv):
    if argv[:1] == ["--measure"] and len(argv) > 1:
        measure(argv[1:])
        return 0
    if argv[:1] == ["--breakdown"] and len(argv) > 1:
        breakdown(argv[1:])
        return 0
    if argv[:1] == ["--verify"] and len(argv) > 1:
        return verify(argv[1:])
    if len(argv) >= 3 and argv[0] == "--scheme":
        text = open(argv[2], encoding="utf-8").read()
        new, _ = convert_markdown(text, argv[1])
        if len(argv) > 3:
            open(argv[3], "w", encoding="utf-8").write(new)
        else:
            sys.stdout.write(new)
        return 0
    print((__doc__ or "").strip(), file=sys.stderr)
    return 64


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
