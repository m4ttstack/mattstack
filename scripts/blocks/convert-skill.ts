#!/usr/bin/env bun
/**
 * Converts one slot engine (a SKILL.md with {{slot:x}} placeholders and dot
 * graphs) into a block tree. The output is a starting point for a hand
 * review, so every judgment call it makes is printed as a note.
 *
 * Without --out or --write it is a dry run that lists the files and notes.
 * --out <dir> writes the tree there. --write writes it into the skill dir
 * and deletes the SKILL.md, which compile refuses beside an index.block.md.
 * The tree is loaded in a scratch dir first: one that does not load writes
 * nothing, deletes nothing and exits 1.
 * Every slot the frontmatter declares maps by default as the plan does
 * (domain -> rules:add, any other slot -> a prop of its own name, replace);
 * --slot overrides one. --target names a step by today's section heading,
 * and the slot's prop is added to that step's block too.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { BlockError, formatDiagnostic } from "../../lib/skills/blocks/diagnostics.ts";
import { loadBlockTree } from "../../lib/skills/blocks/tree.ts";
import { readJsoncObject } from "../../lib/skills/sources.ts";
import * as out from "../../lib/ui/out.ts";
import { usageFailure } from "../../lib/ui/usage.ts";
import { blockIdsByTitle, splitSkill, type SlotMap } from "./lib/split.ts";

const USAGE =
  'bun scripts/blocks/convert-skill.ts <skill dir> [--out <dir>] [--slot <slot>=<prop>:add|replace]... [--target "<slot>=<section heading>"]... [--write]';
const SKILLS_JSONC = join(import.meta.dir, "..", "..", "plugins", "mattstack", "pack", "skills.jsonc");

type Options = { dir: string; outDir: string | null; write: boolean; slots: Map<string, { prop: string; merge: "add" | "replace" }>; targets: [string, string][] };

function usage(title: string, why?: string): never {
  out.fail(usageFailure(title, USAGE, why));
  process.exit(2);
}

function failed(title: string, why: string): never {
  out.fail({ title, why });
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { dir: "", outDir: null, write: false, slots: new Map(), targets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = (): string => argv[++i] ?? usage(`${a} needs a value`);
    if (a === "--write") opts.write = true;
    else if (a === "--out") opts.outDir = resolve(value());
    else if (a === "--slot") {
      const m = /^([^=]+)=([a-z][a-z0-9-]*):(add|replace)$/.exec(value());
      if (!m) usage("Write each --slot as <slot>=<prop>:add or <slot>=<prop>:replace");
      opts.slots.set(m[1]!, { prop: m[2]!, merge: m[3] as "add" | "replace" });
    } else if (a === "--target") {
      const v = value();
      const eq = v.indexOf("=");
      if (eq < 1) usage("Write each --target as <slot>=<section heading>");
      opts.targets.push([v.slice(0, eq), v.slice(eq + 1).trim()]);
    } else if (a.startsWith("--")) usage(`Unknown option ${a}`);
    else if (opts.dir === "") opts.dir = resolve(a);
    else usage("Pass one skill dir");
  }
  if (opts.dir === "") usage("Name the skill dir to convert");
  if (opts.write && opts.outDir !== null) usage("Pass --out or --write, not both");
  return opts;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const skillMd = join(opts.dir, "SKILL.md");
  let raw: string;
  try {
    raw = readFileSync(skillMd, "utf8");
  } catch {
    failed(`There is no SKILL.md in ${opts.dir}`, "the converter reads a slot engine's SKILL.md");
  }
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  const parsed = (fm ? parseDocument(fm[1]!).toJS() : null) as Record<string, unknown> | null;
  const engine = typeof parsed?.name === "string" ? parsed.name : basename(opts.dir);
  const declared = Object.keys((parsed?.slots ?? {}) as Record<string, unknown>);

  const slots: SlotMap = {};
  for (const name of declared) slots[name] = name === "domain" ? { prop: "rules", merge: "add" } : { prop: name, merge: "replace" };
  for (const [name, map] of opts.slots) slots[name] = map;

  const ids = blockIdsByTitle(raw, { engine });
  for (const [slot, heading] of opts.targets) {
    const map = slots[slot] ?? usage(`--target names slot ${slot}, which the skill does not declare`);
    const hit = ids.get(heading);
    if (!hit) failed(`No section is headed "${heading}"`, `a --target names a step by today's section heading, as the SKILL.md writes it`);
    if (hit.length > 1) failed(`"${heading}" heads more than one block`, `it would target ${hit.join(", ")}`);
    map.targets = [...(map.targets ?? []), hit[0]!];
  }

  const bindings = (readJsoncObject(SKILLS_JSONC)?.bindings ?? {}) as Record<string, Record<string, string>>;
  let result;
  try {
    result = splitSkill(raw, { engine, slots, bindings: bindings[`mattstack:${engine}`] ?? {} });
  } catch (err) {
    failed(`Could not convert ${engine}`, (err as Error).message);
  }

  const dest = opts.write ? opts.dir : opts.outDir;
  const files = Object.keys(result.files).sort();
  out.print(
    out.section(`${engine}: ${files.length} blocks`, dest ?? "dry run", out.verbatim(files)),
    out.section("Notes", undefined, result.notes.length > 0 ? out.verbatim(result.notes) : out.paragraph("No judgment calls.")),
  );
  const writeTo = (dir: string) => {
    for (const rel of files) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), result.files[rel]!);
    }
  };
  const scratch = mkdtempSync(join(tmpdir(), "convert-skill-"));
  try {
    writeTo(scratch);
    loadBlockTree(scratch, { idPrefix: engine, relRoot: engine });
  } catch (err) {
    if (!(err instanceof BlockError)) throw err;
    out.fail(
      { title: `The ${engine} tree does not load, so nothing was written`, why: "fix the SKILL.md or the converter, then run again" },
      out.verbatim(err.diagnostics.map(formatDiagnostic), "loadBlockTree diagnostics"),
    );
    process.exit(1);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (dest === null) {
    out.print(out.line("off", "Nothing was written", "the tree loads; pass --out <dir> to see it, or --write to convert in place"));
    return;
  }
  writeTo(dest);
  if (opts.write) rmSync(skillMd);
  out.print(out.line("done", `Wrote ${files.length} block files to ${dest}`, "the tree loads with no diagnostics"));
}

main();
