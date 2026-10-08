#!/usr/bin/env python3
"""doc-standards machine gate: lint Markdown docs against controlled-language and
style rules. Zero dependencies. Defers style checks to Vale when available.

Usage: check_docs.py <file-or-dir> [--max-words N] [--no-vale]
Exit code 1 if any error-level finding, else 0.
"""
import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

MAX_WORDS_DEFAULT = 25
LONG_SENTENCE_ERROR = 40

# word/phrase -> (level, message)
BANNED = {
    r"\bclick here\b": ("error", "descriptive link text, never 'click here'"),
    r"\b(?:as (?:mentioned|shown|described|noted) )?(?:above|below)\b(?=[,.\s])":
        ("warning", "positional reference breaks under retrieval; link to the section"),
    r"\bsimply\b": ("warning", "banned word (insults the reader when the step fails)"),
    r"\beasy\b|\beasily\b": ("warning", "banned word (insults the reader when the step fails)"),
    r"\bobviously\b|\bof course\b": ("warning", "banned word"),
    r"\bplease\b": ("warning", "instructions are not requests"),
    r"\be\.g\.": ("warning", "write 'for example'"),
    r"\bi\.e\.": ("warning", "write 'that is'"),
    r"\betc\.": ("warning", "finish the list or write 'and more'"),
    r"\butilize[sd]?\b": ("warning", "write 'use'"),
    r"\bleverage[sd]?\b|\bleveraging\b": ("warning", "write 'use'"),
    r"\bfacilitate[sd]?\b": ("warning", "write 'help' or name the action"),
    r"\bperformant\b": ("warning", "write 'fast' or give the number"),
    r"\bin order to\b": ("warning", "write 'to'"),
    r"\bprior to\b": ("warning", "write 'before'"),
}

PRESENT_PERFECT = re.compile(r"\b(?:has|have|had)\s+been\s+\w+", re.I)
PASSIVE = re.compile(
    r"\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(\w+ed|built|done|given|held|"
    r"kept|known|made|put|run|sent|set|shown|taken|told|written|found|left|lost|read)\b", re.I)

# ≥2 members of a set each appearing ≥2 times = terminology drift
SYNONYM_SETS = [
    ["verify", "check", "confirm", "ensure", "make sure", "validate"],
    ["cancel", "abort", "terminate"],
    ["remove", "delete", "erase"],
    ["display", "show", "render"],
    ["directory", "folder"],
    ["parameter", "argument", "flag", "option"],
]

MD_LINK = re.compile(r"\[([^\]]+)\]\(([^)#\s]+)(?:#[^)\s]*)?\)")
HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
CODE_FENCE = re.compile(r"^(```|~~~)")
STEP_ITEM = re.compile(r"^\s*(?:\d+[.)]|[-*+])\s+")
# MDX syntax lines (imports, exports, block JSX, admonition fences) carry no prose
MDX_SYNTAX = re.compile(r"^\s*(?:import\s|export\s|</?(?:[A-Z]|div\b|details\b|summary\b)|\{/\*|:::)")
TABLE_ROW = re.compile(r"^\s*\|")
TABLE_RULE = re.compile(r"^\s*\|?[\s:|-]+\|?\s*$")


def strip_inline(text):
    # links/images first: a bare-URL pass before them would eat the closing paren
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"`[^`\n]+`", "CODE", text)
    text = re.sub(r"https?://[^\s)]+", "URL", text)
    text = re.sub(r"\{/\*.*?\*/\}", "", text)
    # inline JSX: drop the tags, keep their text (<kbd>⌘</kbd> reads as ⌘)
    text = re.sub(r"</?[A-Za-z][^>]*>", "", text)
    return text


def prose_chunks(raw):
    """A table row is one sentence per cell, not one sentence across the row."""
    if not TABLE_ROW.match(raw):
        return [raw]
    if TABLE_RULE.match(raw):
        return []
    return [c for c in raw.strip().strip("|").split("|") if c.strip()]


def sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z`\"'])", text) if s.strip()]


class Linter:
    def __init__(self, max_words, use_vale):
        self.findings = []  # (path, line, level, msg)
        self.max_words = max_words
        self.vale = use_vale and shutil.which("vale") is not None
        # style checks handled by Vale when it runs
        self.style = not self.vale

    def add(self, path, line, level, msg):
        self.findings.append((path, line, level, msg))

    def lint_file(self, path):
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        in_code = False
        levels_seen = []
        headings_text = []
        h1_count = 0
        in_frontmatter = bool(lines) and lines[0].strip() == "---"
        for i, raw in enumerate(lines, 1):
            if in_frontmatter:
                if i > 1 and raw.strip() == "---":
                    in_frontmatter = False
                continue
            if CODE_FENCE.match(raw.strip()):
                in_code = not in_code
                continue
            if in_code or MDX_SYNTAX.match(raw):
                continue
            m = HEADING.match(raw)
            if m:
                level, text = len(m.group(1)), m.group(2).strip()
                if level == 1:
                    h1_count += 1
                    if h1_count > 1:
                        self.add(path, i, "error", "multiple h1 headings on one page")
                if levels_seen and level > levels_seen[-1] + 1:
                    self.add(path, i, "error",
                             f"skipped heading level (h{levels_seen[-1]} -> h{level})")
                levels_seen.append(level)
                low = text.lower()
                if low in headings_text:
                    self.add(path, i, "warning", f"duplicate heading '{text}' (anchors collide)")
                headings_text.append(low)
                continue
            for target_m in MD_LINK.finditer(raw):
                label, target = target_m.group(1), target_m.group(2)
                if label.strip().lower() in ("here", "this", "link", "this page"):
                    self.add(path, i, "error", f"non-descriptive link text '{label}'")
                if not target.startswith(("http://", "https://", "mailto:", "/")):
                    base = path.parent / target
                    # Docusaurus resolves an extensionless link as a page route
                    candidates = [base, base.with_name(base.name + ".md"),
                                  base.with_name(base.name + ".mdx"),
                                  base / "index.md", base / "index.mdx"]
                    if not any(c.exists() for c in candidates):
                        self.add(path, i, "error", f"broken relative link '{target}'")
            is_step = bool(STEP_ITEM.match(raw))
            for chunk in prose_chunks(raw):
                self.lint_prose(path, i, strip_inline(chunk), is_step)
        self.lint_terminology(path, lines)

    def lint_prose(self, path, i, text, is_step):
        for sent in sentences(text):
            n = len(sent.split())
            limit = 20 if is_step else self.max_words
            if n > LONG_SENTENCE_ERROR:
                self.add(path, i, "error", f"sentence has {n} words (limit {limit})")
            elif n > limit:
                self.add(path, i, "warning", f"sentence has {n} words (limit {limit})")
        if self.style:
            low = text.lower()
            for pat, (level, msg) in BANNED.items():
                if re.search(pat, low):
                    self.add(path, i, level, msg)
            if PRESENT_PERFECT.search(text):
                self.add(path, i, "warning",
                         "present perfect; use simple past ('was removed in v2.1')")
            if PASSIVE.search(text) and not is_step:
                self.add(path, i, "warning", "passive voice; name the actor")

    def lint_terminology(self, path, lines):
        body = strip_inline("\n".join(l for l in lines if not HEADING.match(l))).lower()
        for syn_set in SYNONYM_SETS:
            used = [w for w in syn_set if len(re.findall(rf"\b{re.escape(w)}\b", body)) >= 2]
            if len(used) >= 2:
                self.add(path, 0, "warning",
                         f"terminology drift: {', '.join(used)} all used repeatedly — "
                         f"pick one term (one word, one meaning)")

    def run_vale(self, target):
        ini = None
        for parent in [target] + list(target.parents):
            if (parent / ".vale.ini").exists():
                ini = parent / ".vale.ini"
                break
        if ini is None:
            self.style = True  # no config: fall back to built-in style checks
            self.vale = False
            return
        r = subprocess.run(["vale", "--output=line", str(target)],
                           capture_output=True, text=True, cwd=ini.parent)
        for line in r.stdout.splitlines():
            print(line)
        if r.returncode != 0:
            self.findings.append((target, 0, "error", "vale reported errors (above)"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target")
    ap.add_argument("--max-words", type=int, default=MAX_WORDS_DEFAULT)
    ap.add_argument("--no-vale", action="store_true")
    args = ap.parse_args()
    target = Path(args.target).resolve()
    files = [target] if target.is_file() else sorted(p for ext in ("*.md", "*.mdx") for p in target.rglob(ext))
    if not files:
        print(f"no markdown files under {target}")
        return 0
    linter = Linter(args.max_words, use_vale=not args.no_vale)
    if linter.vale:
        linter.run_vale(target)
    for f in files:
        linter.lint_file(f)
    if target.is_dir() and not (target / "llms.txt").exists():
        print(f"info: no llms.txt at {target} — consider one (see references/ai-readability.md)")
    errors = warnings = 0
    for path, line, level, msg in linter.findings:
        loc = f"{path}:{line}" if line else f"{path}"
        print(f"{loc}: [{level}] {msg}")
        if level == "error":
            errors += 1
        else:
            warnings += 1
    print(f"\n{errors} error(s), {warnings} warning(s) in {len(files)} file(s)"
          + (" [style layer: vale]" if linter.vale else " [style layer: built-in]"))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
