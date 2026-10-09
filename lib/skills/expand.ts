import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import { skillMdDriftCauses } from "./drift.ts";
import {
  capabilityError, DEFAULT_HARNESS, foreignToolWarnings, keepsLegacyTokens, LEGACY_CLAUDE_TARGET, missingCapabilities, readRequires,
  isShippedScript, readTargetMarker, renderForTarget, scriptAdvisories, TARGET_MARKER, targetMarkerText, type SkillTarget,
} from "./harness-target.ts";
import { findPlaceholders, substituteIncludesOnly } from "./placeholders.ts";
import { maskProvenance } from "./provenance.ts";
import { listFilesUnder, loadInclude, stripFrontmatter, type PluginRoots } from "./sources.ts";
import type { AttachmentSource, PlaceholderContext } from "./types.ts";

export const EXPAND_HEADER =
  "<!-- expanded by rt skills expand from the sources below; edits here are drift (edit the source dir and re-run) -->";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const SKILL_DIR_TOKEN = "${CLAUDE_SKILL_DIR}";
const SKILL_DIR_PATH_RE = /\$\{CLAUDE_SKILL_DIR\}\/[^\s"'`)]+/g;

export type ExpandedFile = { path: string; copyFrom: string } | { path: string; content: string };

export type ExpandedSkill = {
  name: string;
  skillMd: string;
  files: ExpandedFile[];
  includes: string[];
  harness: string;
  /** What the target cannot carry as written, by file: foreign native tools and `${CLAUDE_*}` in scripts. Never fatal. */
  advisories: string[];
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

function includeOnlyContext(includes: Record<string, AttachmentSource>, target: SkillTarget): PlaceholderContext {
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
    target,
  };
}

function assertPathsInside(text: string, outDir: string, name: string, where: string): void {
  const home = resolve(outDir);
  for (const match of text.matchAll(SKILL_DIR_PATH_RE)) {
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

function expandOne(srcDir: string, outDir: string, name: string, roots: PluginRoots, target: SkillTarget): ExpandedSkill {
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
  const missing = missingCapabilities(readRequires(stripFrontmatter(raw).frontmatter), target)[0];
  if (missing !== undefined) throw new Error(capabilityError(where, missing, target));
  for (const p of findPlaceholders(body)) {
    if ((p.kind !== "include" && p.kind !== "harness") || !p.arg) {
      throw new Error(`${where}: ${p.raw} at line ${fileLine(p.line)} -- only {{include:<name>}} and {{harness:<fragment>}} are allowed here`);
    }
    if (bodyLines[p.line - 1]!.trim() !== p.raw) {
      throw new Error(`${where}: ${p.raw} must be alone on its line (line ${fileLine(p.line)})`);
    }
    if (p.kind === "harness") {
      if (!Object.hasOwn(target.fragments, p.arg)) {
        throw new Error(`${where}: ${p.raw} at line ${fileLine(p.line)} has no "${p.arg}" fragment in the ${target.harness} target`);
      }
      continue;
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

  const expanded = substituteIncludesOnly(body, includeOnlyContext(includes, target), where).body;
  assertPathsInside(fm[0], outDir, name, where);
  assertPathsInside(expanded, outDir, name, where);

  const stamp = names.length === 0 ? null : names.map((n) => `${includes[n]!.plugin}:${n}@${includes[n]!.version}`).join(" + ");
  const frontmatter = stampFrontmatter(fm[0].replace(/\r?\n$/, ""), stamp, where);
  const span = `path=${where} lines=${bodyStartLine}-${bodyStartLine + bodyLines.length - 1}`;
  const skillMd = `${frontmatter}\n\n${EXPAND_HEADER}\n\n<!-- part: step source=${where} ${span} -->\n${expanded}\n`;

  const files: ExpandedFile[] = listFilesUnder(dir, new Set(["SKILL.md"])).map((path) => ({ path, copyFrom: join(dir, path) }));
  for (const n of names) {
    for (const extra of includes[n]!.extraFiles) {
      files.push({ path: `parts/include-${n}/${extra}`, copyFrom: join(includes[n]!.dir, extra) });
    }
  }
  if (keepsLegacyTokens(target)) return { name, skillMd, files, includes: names, harness: target.harness, advisories: [] };
  const renderedMd = renderForTarget(skillMd, target, where);
  const rendered = files.map((f) => renderCompanion(f, target, `${name}/${f.path}`));
  const advisories = [
    ...foreignToolWarnings(renderedMd, target).map((w) => `${name}/SKILL.md: ${w}`),
    ...rendered.flatMap((f) => "content" in f
      ? foreignToolWarnings(f.content, target).map((w) => `${name}/${f.path}: ${w}`)
      : isShippedScript(f.path) ? scriptAdvisories(readFileSync(f.copyFrom, "utf8"), `${name}/${f.path}`, target) : []),
  ];
  return { name, skillMd: renderedMd, files: rendered, includes: names, harness: target.harness, advisories };
}

/** A companion Markdown file is read like SKILL.md, so it is rendered the same way; anything else ships byte for byte. */
function renderCompanion(file: ExpandedFile, target: SkillTarget, where: string): ExpandedFile {
  if ("content" in file || !file.path.endsWith(".md")) return file;
  return { path: file.path, content: renderForTarget(readFileSync(file.copyFrom, "utf8"), target, where) };
}

function expectedBytes(file: ExpandedFile): Buffer {
  return "content" in file ? Buffer.from(file.content) : readFileSync(file.copyFrom);
}

/** Unset `target` expands for Claude with no fragments, the output expand always wrote. */
export function expandSkills(opts: { srcDir: string; outDir: string; roots: PluginRoots; target?: SkillTarget }): ExpandedSkill[] {
  if (!existsSync(opts.srcDir) || !statSync(opts.srcDir).isDirectory()) throw new Error(`${opts.srcDir} does not exist`);
  if (overlaps(opts.srcDir, opts.outDir)) {
    throw new Error(`out dir ${opts.outDir} overlaps src dir ${opts.srcDir}; expand deletes inside the out dir, so they must be disjoint`);
  }
  const target = opts.target ?? LEGACY_CLAUDE_TARGET;
  return listSkillDirs(opts.srcDir).map((name) => expandOne(opts.srcDir, opts.outDir, name, opts.roots, target));
}

/** Authorship is the header, as compile decides it: a dir expand did not write is never deleted, whatever its name. */
function isExpandOutput(dir: string): boolean {
  const skillMdPath = join(dir, "SKILL.md");
  if (!existsSync(skillMdPath)) return false;
  return stripFrontmatter(readFileSync(skillMdPath, "utf8")).body.startsWith(EXPAND_HEADER);
}

function survey(outDir: string, skills: ExpandedSkill[]): { orphans: string[]; foreign: string[] } {
  if (!existsSync(outDir)) return { orphans: [], foreign: [] };
  const expected = new Set(skills.map((s) => s.name));
  const orphans: string[] = [];
  const foreign: string[] = [];
  for (const d of listSkillDirs(outDir)) {
    if (!isExpandOutput(join(outDir, d))) foreign.push(d);
    else if (!expected.has(d)) orphans.push(d);
  }
  return { orphans, foreign };
}

/**
 * The harness whose output `outDir` holds: its marker's, else Claude's when it
 * holds any expand output, since Claude's root predates markers and carries none.
 */
function heldTarget(outDir: string): string | null {
  const marker = readTargetMarker(outDir);
  if (!marker.ok) throw new Error(marker.error.message);
  if (marker.data !== null) return marker.data;
  if (!existsSync(outDir)) return null;
  return listSkillDirs(outDir).some((d) => isExpandOutput(join(outDir, d))) ? DEFAULT_HARNESS : null;
}

function harnessOf(skills: ExpandedSkill[]): string {
  return skills[0]?.harness ?? DEFAULT_HARNESS;
}

/** The orphan dirs a write would remove; throws, touching nothing, when --out holds a dir expand did not write or another harness's output. */
export function planRemoval(outDir: string, skills: ExpandedSkill[]): string[] {
  const harness = harnessOf(skills);
  const held = heldTarget(outDir);
  if (held !== null && held !== harness) {
    throw new Error(`${outDir} holds ${held} output; expand the ${harness} skills into their own --out, or, if that folder should hold ${harness} output, delete it and run expand again`);
  }
  const { orphans, foreign } = survey(outDir, skills);
  if (foreign.length > 0) {
    const named = foreign.map((d) => join(outDir, d)).join(", ");
    throw new Error(`${named} ${foreign.length === 1 ? "is" : "are"} not expand output; move ${foreign.length === 1 ? "it" : "them"} or choose another --out`);
  }
  return orphans;
}

export function writeExpanded(outDir: string, skills: ExpandedSkill[]): { written: string[]; removed: string[] } {
  const removed = planRemoval(outDir, skills);
  mkdirSync(outDir, { recursive: true });
  for (const d of removed) rmSync(join(outDir, d), { recursive: true, force: true });
  for (const s of skills) {
    const dir = join(outDir, s.name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), s.skillMd);
    for (const f of s.files) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true });
      if ("content" in f) writeFileSync(join(dir, f.path), f.content);
      else copyFileSync(f.copyFrom, join(dir, f.path));
    }
  }
  const harness = harnessOf(skills);
  if (harness !== DEFAULT_HARNESS) writeFileSync(join(outDir, TARGET_MARKER), targetMarkerText(harness));
  return { written: skills.map((s) => s.name), removed };
}

/** The first vendored path that is extra, missing or different, or null when the vendored files match. */
function firstVendoredDrift(dir: string, s: ExpandedSkill): string | null {
  const want = new Set(s.files.map((f) => f.path));
  const have = new Set(filesOnDisk(dir).filter((p) => p !== "SKILL.md"));
  const extra = [...have].filter((p) => !want.has(p)).sort()[0];
  if (extra) return extra;
  const missing = [...want].filter((p) => !have.has(p)).sort()[0];
  if (missing) return missing;
  return s.files.find((f) => !readFileSync(join(dir, f.path)).equals(expectedBytes(f)))?.path ?? null;
}

/** SKILL.md compares with provenance masked, so a plugin version bump alone is not drift; a write still stamps the real version. */
export function checkExpanded(outDir: string, skills: ExpandedSkill[]): ExpandDrift[] {
  const drift: ExpandDrift[] = [];
  const harness = harnessOf(skills);
  const marker = readTargetMarker(outDir);
  const held = marker.ok ? heldTarget(outDir) : null;
  if (!marker.ok) drift.push({ skill: TARGET_MARKER, causes: ["invalid"] });
  else if (held !== null && held !== harness) drift.push({ skill: TARGET_MARKER, causes: [`holds ${held} output`] });
  else if (harness !== DEFAULT_HARNESS && existsSync(outDir) && marker.data === null) drift.push({ skill: TARGET_MARKER, causes: ["missing"] });
  const { orphans, foreign } = survey(outDir, skills);
  const foreignSet = new Set(foreign);
  for (const s of skills) {
    const dir = join(outDir, s.name);
    if (!existsSync(dir)) {
      drift.push({ skill: s.name, causes: ["missing"] });
      continue;
    }
    if (foreignSet.has(s.name)) continue;
    const onDisk = maskProvenance(readFileSync(join(dir, "SKILL.md"), "utf8"));
    const causes: string[] = skillMdDriftCauses(onDisk, maskProvenance(s.skillMd));
    const vendored = firstVendoredDrift(dir, s);
    if (vendored !== null) causes.push(`vendored (${vendored})`);
    if (causes.length > 0) drift.push({ skill: s.name, causes });
  }
  for (const d of foreign) drift.push({ skill: d, causes: ["foreign"] });
  for (const d of orphans) drift.push({ skill: d, causes: ["orphan"] });
  return drift;
}
