#!/usr/bin/env python3
"""Give long dot nodes short ids and keep their sentence as the label.

Usage:
  convert.py --scheme <scheme> <in.md> [out.md]   rewrite every ```dot block
  convert.py --measure <file.md> [...]            word counts per scheme
  convert.py --breakdown <file.md> [...]          id words per node shape today
  convert.py --verify <file.md> [...] [--slugs <map.json>]
                                                  every scheme keeps each graph
  convert.py --emit-slugs <in.md>                 JSON {"<node text>": "<slug>"}
                                                  for every node scheme all converts
  convert.py --scheme all --slugs <map.json> <in.md> [out.md]
                                                  use the map's slug for each text
                                                  it lists, the auto slug otherwise;
                                                  an entry matching no node exits 1

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
import importlib.util
import json
import os
import re
import subprocess
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


def load_call_prefix():
    sys.dont_write_bytecode = True
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "../../../../plugin/skills/process-digraphs/check-dot.py")
    spec = importlib.util.spec_from_file_location("check_dot", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.call_prefix


call_prefix = load_call_prefix()
LABELLED_ID = re.compile(r"^[a-z]+(_[a-z]+)*$")
FILLERS = ["alt", "other", "more", "else"]


def words_of(text):
    return [w for w in re.findall(r"[a-z]+", text.lower()) if w not in STOPWORDS]


def make_slug(text, shape, taken):
    extra = []
    if shape == "plaintext":
        prefix = call_prefix(text)
        if LABELLED_ID.match(prefix):
            head = [prefix]
            tail = re.split(r"[}\]]\s*:\s*", text, maxsplit=1)
            if len(tail) == 2:
                extra = words_of(tail[1])[:2]
        else:
            print(f"note: no call prefix can start an id for {text!r}; using a word slug", file=sys.stderr)
            head, extra = [], words_of(text.split("{")[0])[:3]
    else:
        head = ["stop"] if shape == "octagon" else []
        extra = [w for w in words_of(text) if w != "stop"][:3]
    base = "_".join(head + extra) or "node"
    if shape == "octagon" and not extra:
        base = "stop_here"
    spare = [w for w in words_of(text) if w not in base.split("_")] + FILLERS
    slug, grown = base, base
    for word in [None] + spare:
        slug = base if word is None else f"{base}_{word}"
        if slug not in taken and slug not in KEYWORDS:
            break
    else:
        while grown in taken or grown in KEYWORDS:
            grown += "_" + FILLERS[grown.count("_") % len(FILLERS)]
        slug = grown
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


def convert_block(src, scheme, slugmap=None):
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
    picked = []
    for i, _ in positions:
        name = unquote(toks[i][1]) if toks[i][0] == "str" else toks[i][1]
        if toks[i][0] == "str" and name not in picked and name in declared \
                and chosen(scheme, name, shapes.get(name, "ellipse")):
            picked.append(name)
    slugs, taken = {}, set()
    for name in picked:
        if name in (slugmap or {}):
            slug = slugmap[name]
            if slug in taken:
                raise ValueError(f"slug {slug!r} is used twice in one graph")
            slugs[name] = slug
            taken.add(slug)
    for name in picked:
        if name not in slugs:
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


def convert_markdown(text, scheme, slugmap=None):
    lines, out, i, all_slugs = text.split("\n"), [], 0, []
    while i < len(lines):
        out.append(lines[i])
        if FENCE_OPEN.match(lines[i]):
            body = []
            i += 1
            while i < len(lines) and not FENCE_CLOSE.match(lines[i]):
                body.append(lines[i])
                i += 1
            new, slugs = convert_block("\n".join(body), scheme, slugmap)
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


def verify(paths, slugmap=None):
    """Fail unless each scheme's graphs match today's: same node texts, shapes and edges."""
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
        runs = [(scheme, None) for scheme in SCHEMES]
        if slugmap is not None:
            runs.append(("all+slugs", slugmap))
        for scheme, mapping in runs:
            got = graphs(convert_markdown(text, scheme.split("+slugs")[0], mapping)[0])
            ok = got == want
            bad += not ok
            print(f"{'ok  ' if ok else 'FAIL'} {path.rsplit('/', 1)[-1]} {scheme}: {len(want)} graph(s)")
    return 1 if bad else 0


def merged(all_slugs):
    out = {}
    for block in all_slugs:
        for text, slug in block.items():
            out.setdefault(text, slug)
    return out


def main(argv):
    slugmap = None
    if "--slugs" in argv:
        k = argv.index("--slugs")
        if k + 1 >= len(argv):
            print((__doc__ or "").strip(), file=sys.stderr)
            return 64
        slugmap = json.load(open(argv[k + 1], encoding="utf-8"))
        argv = argv[:k] + argv[k + 2:]
    if argv[:1] == ["--measure"] and len(argv) > 1:
        measure(argv[1:])
        return 0
    if argv[:1] == ["--breakdown"] and len(argv) > 1:
        breakdown(argv[1:])
        return 0
    if argv[:1] == ["--verify"] and len(argv) > 1:
        return verify(argv[1:], slugmap)
    if argv[:1] == ["--emit-slugs"] and len(argv) == 2:
        text = open(argv[1], encoding="utf-8").read()
        print(json.dumps(merged(convert_markdown(text, "all")[1]), indent=2))
        return 0
    if len(argv) >= 3 and argv[0] == "--scheme":
        text = open(argv[2], encoding="utf-8").read()
        new, used = convert_markdown(text, argv[1], slugmap)
        absent = sorted(set(slugmap or {}) - set(merged(used)))
        if absent:
            for name in absent:
                print(f"slug map entry matches no converted node: {name!r}", file=sys.stderr)
            return 1
        if len(argv) > 3:
            open(argv[3], "w", encoding="utf-8").write(new)
        else:
            sys.stdout.write(new)
        return 0
    print((__doc__ or "").strip(), file=sys.stderr)
    return 64


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
