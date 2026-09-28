import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import { skillMdDriftCauses } from "./drift.ts";
import { findPlaceholders, substituteIncludesOnly } from "./placeholders.ts";
import { listFilesUnder, loadInclude, type PluginRoots } from "./sources.ts";
import type { AttachmentSource, PlaceholderContext } from "./types.ts";

export const EXPAND_HEADER =
  "<!-- expanded by rt skills expand from the sources below; edits here are drift (edit the source dir and re-run) -->";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const SKILL_DIR_TOKEN = "${CLAUDE_SKILL_DIR}";
const SKILL_DIR_PATH_RE = /\$\{CLAUDE_SKILL_DIR\}\/[^\s"'`)]+/g;

export type ExpandedSkill = {
  name: string;
  skillMd: string;
  files: { path: string; copyFrom: string }[];
  includes: string[];
};

export type ExpandDrift = { skill: string; causes: string[] };

function listSkillDirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

/**
 * The frontmatter is copied byte for byte rather than re-serialised, so a
 * folded description or a quoted key survives exactly as the author wrote
 * it; only the compiled stamp is spliced in, under an existing metadata
 * block or in a new one.
 */
function stampFrontmatter(raw: string, stamp: string | null, where: string): string {
  if (/^\s*compiled:/m.test(raw)) throw new Error(`${where}: metadata.compiled is set by expand; remove it from the source`);
  if (stamp === null) return raw;
  const line = `  compiled: ${JSON.stringify(stamp)}`;
  const lines = raw.split("\n");
  const close = lines.length - 1;
  const at = lines.findIndex((l) => /^metadata:\s*$/.test(l));
  if (at === -1) {
    lines.splice(close, 0, "metadata:", line);
    return lines.join("\n");
  }
  let end = at + 1;
  while (end < close && /^\s+\S/.test(lines[end]!)) end++;
  lines.splice(end, 0, line);
  return lines.join("\n");
}

function includeOnlyContext(includes: Record<string, AttachmentSource>): PlaceholderContext {
  return {
    fills: {},
    slotMode: {},
    partsPrefix: `${SKILL_DIR_TOKEN}/parts`,
    includes,
    pipelines: {},
    repoKey: "",
    mattstackSha: "",
    mattstackDirty: 0,
    packSha: "",
    stageDir: null,
    stageMeta: null,
    compiledFrom: "",
    verbSides: {},
    side: "skills",
    packRoot: null,
  };
}

function assertPathsInside(body: string, outDir: string, name: string, where: string): void {
  const home = resolve(outDir);
  for (const match of body.matchAll(SKILL_DIR_PATH_RE)) {
    const text = match[0];
    const target = resolve(home, name, text.slice(`${SKILL_DIR_TOKEN}/`.length));
    if (target !== home && !target.startsWith(home + sep)) {
      throw new Error(`${where}: "${text}" resolves outside ${outDir}`);
    }
  }
}

/** 1-based line of the first `{{` that no placeholder accounts for, or null. */
function strayBraceLine(text: string): number | null {
  const placed = new Map<number, number>();
  for (const p of findPlaceholders(text)) placed.set(p.line, (placed.get(p.line) ?? 0) + 1);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.split("{{").length - 1 > (placed.get(i + 1) ?? 0)) return i + 1;
  }
  return null;
}

function overlaps(a: string, b: string): boolean {
  const x = resolve(a);
  const y = resolve(b);
  return x === y || x.startsWith(y + sep) || y.startsWith(x + sep);
}

/** Unfiltered on purpose: a stray dotfile or README in the output still ships, so it is drift. */
function filesOnDisk(dir: string, sub = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, sub), { withFileTypes: true })) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesOnDisk(dir, rel));
    else out.push(rel);
  }
  return out;
}

function expandOne(srcDir: string, outDir: string, name: string, roots: PluginRoots): ExpandedSkill {
  const dir = join(srcDir, name);
  const skillMdPath = join(dir, "SKILL.md");
  const where = `${name}/SKILL.md`;
  if (!existsSync(skillMdPath)) throw new Error(`${name}: no SKILL.md`);
  const raw = readFileSync(skillMdPath, "utf8");
  const fm = raw.match(FRONTMATTER_RE);
  if (!fm) throw new Error(`${where}: no frontmatter`);
  const rest = raw.slice(fm[0].length);
  const body = rest.trim();
  const countLines = (s: string) => (s.match(/\n/g) ?? []).length;
  const bodyStartLine = countLines(fm[0]) + countLines(rest.slice(0, rest.length - rest.trimStart().length)) + 1;

  const bodyLines = body.split("\n");
  const fileLine = (bodyLine: number) => bodyLine + bodyStartLine - 1;
  const includes: Record<string, AttachmentSource> = {};
  const names: string[] = [];
  for (const p of findPlaceholders(body)) {
    if (p.kind !== "include" || !p.arg) {
      throw new Error(`${where}: ${p.raw} at line ${fileLine(p.line)} -- only {{include:<name>}} is allowed here`);
    }
    if (bodyLines[p.line - 1]!.trim() !== p.raw) {
      throw new Error(`${where}: ${p.raw} must be alone on its line (line ${fileLine(p.line)})`);
    }
    if (!(p.arg in includes)) {
      includes[p.arg] = loadInclude(p.arg, roots);
      names.push(p.arg);
    }
  }

  const stray = strayBraceLine(body);
  if (stray !== null) throw new Error(`${where}: literal "{{" at line ${fileLine(stray)} is not a placeholder`);
  for (const n of names) {
    const inc = includes[n]!;
    const incStray = strayBraceLine(inc.body);
    if (incStray !== null) {
      throw new Error(`${where}: include "${n}" carries a literal "{{" at ${inc.srcPath} line ${incStray + inc.bodyStartLine - 1}`);
    }
  }

  const expanded = substituteIncludesOnly(body, includeOnlyContext(includes), where).body;
  assertPathsInside(expanded, outDir, name, where);

  const stamp = names.length === 0 ? null : names.map((n) => `${includes[n]!.plugin}:${n}@${includes[n]!.version}`).join(" + ");
  const frontmatter = stampFrontmatter(fm[0].replace(/\r?\n$/, ""), stamp, where);
  const span = `path=${where} lines=${bodyStartLine}-${bodyStartLine + bodyLines.length - 1}`;
  const skillMd = `${frontmatter}\n\n${EXPAND_HEADER}\n\n<!-- part: step source=${where} ${span} -->\n${expanded}\n`;

  const files = listFilesUnder(dir, new Set(["SKILL.md"])).map((path) => ({ path, copyFrom: join(dir, path) }));
  for (const n of names) {
    for (const extra of includes[n]!.extraFiles) {
      files.push({ path: `parts/include-${n}/${extra}`, copyFrom: join(includes[n]!.dir, extra) });
    }
  }
  return { name, skillMd, files, includes: names };
}

export function expandSkills(opts: { srcDir: string; outDir: string; roots: PluginRoots }): ExpandedSkill[] {
  if (!existsSync(opts.srcDir) || !statSync(opts.srcDir).isDirectory()) throw new Error(`${opts.srcDir} does not exist`);
  if (overlaps(opts.srcDir, opts.outDir)) {
    throw new Error(`out dir ${opts.outDir} overlaps src dir ${opts.srcDir}; expand deletes inside the out dir, so they must be disjoint`);
  }
  return listSkillDirs(opts.srcDir).map((name) => expandOne(opts.srcDir, opts.outDir, name, opts.roots));
}

export function writeExpanded(outDir: string, skills: ExpandedSkill[]): { written: string[]; removed: string[] } {
  mkdirSync(outDir, { recursive: true });
  const keep = new Set(skills.map((s) => s.name));
  const removed = listSkillDirs(outDir).filter((d) => !keep.has(d));
  for (const d of removed) rmSync(join(outDir, d), { recursive: true, force: true });
  for (const s of skills) {
    const dir = join(outDir, s.name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), s.skillMd);
    for (const f of s.files) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true });
      copyFileSync(f.copyFrom, join(dir, f.path));
    }
  }
  return { written: skills.map((s) => s.name), removed };
}

export function checkExpanded(outDir: string, skills: ExpandedSkill[]): ExpandDrift[] {
  const drift: ExpandDrift[] = [];
  const expected = new Set(skills.map((s) => s.name));
  for (const s of skills) {
    const dir = join(outDir, s.name);
    const skillMdPath = join(dir, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      drift.push({ skill: s.name, causes: ["missing"] });
      continue;
    }
    const causes: string[] = skillMdDriftCauses(readFileSync(skillMdPath, "utf8"), s.skillMd);
    const want = s.files.map((f) => f.path).sort();
    const have = filesOnDisk(dir).filter((p) => p !== "SKILL.md").sort();
    const vendoredMoved =
      want.join("\n") !== have.join("\n") || s.files.some((f) => !readFileSync(join(dir, f.path)).equals(readFileSync(f.copyFrom)));
    if (vendoredMoved) causes.push("vendored");
    if (causes.length > 0) drift.push({ skill: s.name, causes });
  }
  if (existsSync(outDir)) {
    for (const d of listSkillDirs(outDir)) {
      if (!expected.has(d)) drift.push({ skill: d, causes: ["orphan"] });
    }
  }
  return drift;
}
