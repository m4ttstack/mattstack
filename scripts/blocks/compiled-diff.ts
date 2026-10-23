#!/usr/bin/env bun
/**
 * Proves a block conversion: normalizes two compiled SKILL.md bodies (seams,
 * header, heading levels, dot layout and the Slot/Prop reference noun do not
 * count) and prints what is left as a unified diff. Exit 0 when nothing is
 * left, 1 when something is.
 *
 * --allow-move "<heading>" (repeatable) lets text that sat under that heading
 * on one side appear verbatim, as a run of non-blank lines, under a
 * different heading on the other. Those runs are dropped from both sides
 * before the diff. The heading line itself, and text under it that did not
 * move, still compare.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as out from "../../lib/ui/out.ts";
import { usageFailure } from "../../lib/ui/usage.ts";
import { normalizeCompiled } from "./lib/normalize.ts";

const USAGE = 'bun scripts/blocks/compiled-diff.ts --verb <name> --before <compiled SKILL.md> --after <compiled SKILL.md> [--allow-move "<heading>"]...';
const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^# (.*)$/;

type Span = { start: number; end: number };

function sections(lines: string[]): string[] {
  const owner: string[] = [];
  let current = "";
  let fence: string | null = null;
  for (const line of lines) {
    const f = FENCE.exec(line);
    if (fence === null && f) fence = f[1]!;
    else if (fence !== null && f && f[1]!.startsWith(fence)) fence = null;
    else if (fence === null) {
      const h = HEADING.exec(line);
      if (h) current = h[1]!;
    }
    owner.push(current);
  }
  return owner;
}

function paragraphs(lines: string[], owner: string[], heading: string): Span[] {
  const spans: Span[] = [];
  let start = -1;
  for (let i = 0; i <= lines.length; i++) {
    const inside = i < lines.length && lines[i]!.trim() !== "" && owner[i] === heading && !HEADING.test(lines[i]!);
    if (inside && start < 0) start = i;
    if (!inside && start >= 0) {
      spans.push({ start, end: i });
      start = -1;
    }
  }
  return spans;
}

function findElsewhere(lines: string[], owner: string[], dropped: Set<number>, needle: string[], heading: string): Span | null {
  for (let i = 0; i + needle.length <= lines.length; i++) {
    let hit = true;
    for (let k = 0; k < needle.length && hit; k++) {
      hit = lines[i + k] === needle[k] && owner[i + k] !== heading && !dropped.has(i + k) && !HEADING.test(lines[i + k]!);
    }
    if (hit) return { start: i, end: i + needle.length };
  }
  return null;
}

function dropMoved(a: string[], b: string[], headings: string[]): [string[], string[]] {
  const ownerA = sections(a);
  const ownerB = sections(b);
  const droppedA = new Set<number>();
  const droppedB = new Set<number>();
  const mark = (set: Set<number>, s: Span) => {
    for (let i = s.start; i < s.end; i++) set.add(i);
  };
  for (const heading of headings) {
    for (const p of paragraphs(a, ownerA, heading)) {
      if (droppedA.has(p.start)) continue;
      const found = findElsewhere(b, ownerB, droppedB, a.slice(p.start, p.end), heading);
      if (found) {
        mark(droppedA, p);
        mark(droppedB, found);
      }
    }
    for (const p of paragraphs(b, ownerB, heading)) {
      if (droppedB.has(p.start)) continue;
      const found = findElsewhere(a, ownerA, droppedA, b.slice(p.start, p.end), heading);
      if (found) {
        mark(droppedB, p);
        mark(droppedA, found);
      }
    }
  }
  return [a.filter((_, i) => !droppedA.has(i)), b.filter((_, i) => !droppedB.has(i))];
}

function tidy(lines: string[]): string[] {
  const kept: string[] = [];
  for (const l of lines) {
    if (l === "" && (kept.length === 0 || kept[kept.length - 1] === "")) continue;
    kept.push(l);
  }
  while (kept[kept.length - 1] === "") kept.pop();
  return kept;
}

function unifiedDiff(a: string[], b: string[]): string {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: { tag: " " | "-" | "+"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ tag: " ", text: a[i]! });
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) ops.push({ tag: "-", text: a[i++]! });
    else ops.push({ tag: "+", text: b[j++]! });
  }
  const CONTEXT = 3;
  const near = ops.map((_, k) => ops.slice(Math.max(0, k - CONTEXT), k + CONTEXT + 1).some((o) => o.tag !== " "));
  if (!near.includes(true)) return "";
  const lines = ["--- before", "+++ after"];
  let gap = false;
  ops.forEach((op, k) => {
    if (!near[k]) {
      gap = true;
      return;
    }
    if (gap) lines.push("@@");
    gap = false;
    lines.push(`${op.tag}${op.text}`);
  });
  return `${lines.join("\n")}\n`;
}

export function residualDiff(before: string, after: string, opts: { allowMovedBlocks: string[] }): string {
  const a = normalizeCompiled(before).split("\n");
  const b = normalizeCompiled(after).split("\n");
  const [ma, mb] = opts.allowMovedBlocks.length > 0 ? dropMoved(a, b, opts.allowMovedBlocks) : [a, b];
  return unifiedDiff(tidy(ma), tidy(mb));
}

function usage(title: string, why?: string): never {
  out.fail(usageFailure(title, USAGE, why));
  process.exit(2);
}

function main(): void {
  const argv = process.argv.slice(2);
  let verb = "";
  let beforePath = "";
  let afterPath = "";
  const allowMove: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = (): string => argv[++i] ?? usage(`${a} needs a value`);
    if (a === "--verb") verb = value();
    else if (a === "--before") beforePath = resolve(value());
    else if (a === "--after") afterPath = resolve(value());
    else if (a === "--allow-move") allowMove.push(value());
    else usage(`Unknown option ${a}`);
  }
  if (verb === "") usage("Name the verb with --verb");
  if (beforePath === "" || afterPath === "") usage("Pass both --before and --after");
  const read = (p: string): string => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      out.fail({ title: `Cannot read ${p}`, why: "--before and --after name compiled SKILL.md files" });
      process.exit(2);
    }
  };
  const diff = residualDiff(read(beforePath), read(afterPath), { allowMovedBlocks: allowMove });
  if (diff === "") {
    out.print(out.line("done", `${verb}: compiled output matches`, "seams, heading levels and dot layout ignored"));
    return;
  }
  out.fail({ title: `${verb}: compiled output differs`, why: "these lines survive normalization" }, out.verbatim(diff.trimEnd().split("\n")));
  process.exit(1);
}

if (import.meta.main) main();
