import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import { skillMdDriftCauses } from "./drift.ts";
import { findPlaceholders, substituteIncludesOnly } from "./placeholders.ts";
import { propPartsDir, renderInclude, type SourcedTree } from "./blocks/render.ts";
import { FENCE_RE, walk } from "./blocks/tree.ts";
import { blockPropValues, includedTree, includeNamesIn } from "./compile-blocks.ts";
import { UserActionableError } from "../errors.ts";
import { closeUnits, MAP_FILE, mapFileText, withOpeningLine } from "./unit-maps.ts";
import { ID_RE, keyBody, leftoverTokens, openingLine, skillsId, type Target, type UnitTable } from "./pointers.ts";
import { maskProvenance } from "./provenance.ts";
import { listFilesUnder, loadAttachment, loadInclude, stripFrontmatter, type PluginRoots } from "./sources.ts";
import type { AttachmentSource, CompiledFile, PlaceholderContext } from "./types.ts";

export const EXPAND_HEADER =
  "<!-- expanded by rt skills expand from the sources below; edits here are drift (edit the source dir and re-run) -->";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const SKILL_DIR_TOKEN = "${CLAUDE_SKILL_DIR}";
const SKILL_DIR_PATH_RE = /\$\{CLAUDE_SKILL_DIR\}\/[^\s"'`)]+/g;

export type ExpandedSkill = {
  name: string;
  skillMd: string;
  files: CompiledFile[];
  includes: string[];
};

/** A skill as expandOne leaves it, before its pointers are keyed: `skillName` is its frontmatter name. */
type Drafted = { skill: ExpandedSkill; skillName: string };

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
    pipeline: null,
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

const ATX_HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const TREE_MARK = (i: number) => `\u0000block-include-${i}\u0000`;

/** Heading level and text of the nearest ATX heading above `bodyLines[index]` outside fences, or level 0. */
function nearestHeadingAbove(bodyLines: string[], index: number): { level: number; title: string | null } {
  let fence: string | null = null;
  let found: { level: number; title: string | null } = { level: 0, title: null };
  for (let i = 0; i < index; i++) {
    const line = bodyLines[i]!;
    const f = FENCE_RE.exec(line);
    if (fence !== null) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && f[2] === "") fence = null;
      continue;
    }
    if (f) {
      fence = f[1]!;
      continue;
    }
    const h = ATX_HEADING_RE.exec(line);
    if (h) found = { level: h[1]!.length, title: h[2]! };
  }
  return found;
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

function expandOne(srcDir: string, outDir: string, name: string, roots: PluginRoots): Drafted {
  const dir = join(srcDir, name);
  const skillMdPath = join(dir, "SKILL.md");
  const where = `${name}/SKILL.md`;
  if (!existsSync(skillMdPath)) throw new Error(`${name}: no SKILL.md`);
  const raw = readFileSync(skillMdPath, "utf8");
  const fm = raw.match(FRONTMATTER_RE);
  if (!fm) throw new Error(`${where}: no frontmatter`);
  const skillName = stripFrontmatter(raw).frontmatter.name;
  if (typeof skillName !== "string" || !ID_RE.test(skillsId(skillName))) {
    throw new Error(`${where}: the frontmatter name must be lowercase letters, digits, dashes and colons, since it is the skill's id`);
  }
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

  for (let i = 0; i < names.length; i++) {
    const inc = includes[names[i]!]!;
    if (!inc.tree) continue;
    for (const n of includeNamesIn(inc.tree)) {
      if (n in includes) continue;
      includes[n] = loadInclude(n, roots);
      names.push(n);
    }
  }
  const treeIncludes = names.flatMap((n) => {
    const inc = includes[n]!;
    return inc.tree ? [{ tree: inc.tree, plugin: inc.plugin, version: inc.version }] : [];
  });
  const values =
    treeIncludes.length === 0
      ? new Map()
      : blockPropValues(treeIncludes, { layered: {}, manifest: null }, (binding, prop) => loadAttachment(binding, prop, roots), new Set<string>());

  const stray = strayBraceLine(body);
  if (stray !== null) throw new Error(`${where}: literal "{{" at line ${fileLine(stray)} is not a placeholder`);
  for (const n of names) {
    const inc = includes[n]!;
    const incStray = strayBraceLine(inc.body);
    if (incStray !== null) {
      throw new Error(`${where}: include "${n}" carries a literal "{{" at ${inc.srcPath} line ${incStray + inc.bodyStartLine - 1}`);
    }
  }

  const ctx = includeOnlyContext(includes);
  const drawn = new Map<string, SourcedTree>();
  for (const n of names) {
    const inc = includes[n]!;
    if (inc.tree) drawn.set(n, includedTree(n, { ...inc, tree: inc.tree }, ctx));
  }
  const resolver = (n: string) => drawn.get(n) ?? null;
  const rendered: string[] = [];
  const marked = bodyLines.map((line, i) => {
    const m = /^\{\{include:([^}\s]+)\}\}$/.exec(line.trim());
    const src = m ? drawn.get(m[1]!) : undefined;
    if (!src) return line;
    const at = nearestHeadingAbove(bodyLines, i);
    const out = renderInclude(src, { depth: at.level, includingTitle: at.title }, { values, includes: resolver, ctx });
    rendered.push(out.body);
    return TREE_MARK(rendered.length - 1);
  });
  let expanded = substituteIncludesOnly(marked.join("\n"), ctx, where).body;
  rendered.forEach((text, i) => {
    expanded = expanded.replace(TREE_MARK(i), () => text);
  });
  assertPathsInside(fm[0], outDir, name, where);
  assertPathsInside(expanded, outDir, name, where);

  const stamp = names.length === 0 ? null : names.map((n) => `${includes[n]!.plugin}:${n}@${includes[n]!.version}`).join(" + ");
  const frontmatter = stampFrontmatter(fm[0].replace(/\r?\n$/, ""), stamp, where);
  const span = `path=${where} lines=${bodyStartLine}-${bodyStartLine + bodyLines.length - 1}`;
  const skillMd = `${frontmatter}\n\n${EXPAND_HEADER}\n\n<!-- part: step source=${where} ${span} -->\n${expanded}\n`;

  const files: CompiledFile[] = listFilesUnder(dir, new Set(["SKILL.md"])).map((path) => ({ path, copyFrom: join(dir, path) }));
  for (const n of names) {
    for (const extra of includes[n]!.extraFiles) {
      files.push({ path: `parts/include-${n}/${extra}`, copyFrom: join(includes[n]!.dir, extra) });
    }
  }
  for (const { tree } of treeIncludes) {
    for (const block of walk(tree)) {
      for (const [prop, value] of values.get(block.id) ?? []) {
        for (const { fill } of value.sources) {
          for (const extra of fill.extraFiles) {
            files.push({ path: `parts/${propPartsDir(block, prop, tree, null)}/${extra}`, copyFrom: join(fill.dir, extra) });
          }
        }
      }
    }
  }
  return { skill: { name, skillMd, files, includes: names }, skillName };
}

export const textOf = (f: CompiledFile): string => ("content" in f ? f.content : readFileSync(f.copyFrom, "utf8"));

/** The SKILL.md line sits under the expand header, which has to open the body for the output to count as expand's. */
function withExpandOpeningLine(skillMd: string, id: string): string {
  const header = `\n${EXPAND_HEADER}\n`;
  const at = skillMd.indexOf(header) + header.length;
  return `${skillMd.slice(0, at)}${openingLine(id)}\n${skillMd.slice(at)}`;
}

/** The command that re-runs expand belongs to the caller, which knows the flags this run took. */
function pointerRefusal(code: string, message: string, why: string): UserActionableError {
  return new UserActionableError(code, message, {}, { why });
}

/**
 * Keys every `.md` against a unit table of the board skills' folders, so a
 * pointer into a sibling's folder is a key too. resolve joins a string target
 * inside the reader's own link, so a sibling's target is named by the
 * sibling's frontmatter name, the name its link carries.
 */
function pointSkills(drafts: Drafted[]): ExpandedSkill[] {
  const units: UnitTable = Object.fromEntries(drafts.map((d) => [d.skill.name, `skills/${d.skill.name}`]));
  const nameOf = new Map(drafts.map((d) => [d.skill.name, d.skillName]));
  const idOf = (folder: string) => skillsId(nameOf.get(folder)!);
  const written = new Set(drafts.flatMap((d) => ["SKILL.md", ...d.skill.files.map((f) => f.path)].map((p) => `${units[d.skill.name]}/${p}`)));
  const folderOf = (target: string) => target.split("/")[1]!;

  const keyed = drafts.map(({ skill }) => {
    if (skill.files.some((f) => f.path === MAP_FILE)) {
      throw pointerRefusal("skills-expand-map-in-source", `${skill.name}/${MAP_FILE}: expand writes this file; remove it from the source`, "Each expanded skill's pointer map is generated from its text, so a copy in the source would overwrite it.");
    }
    const dir = units[skill.name]!;
    const id = idOf(skill.name);
    const keys: Record<string, Target> = {};
    const key = (text: string, fileRel: string): { text: string; keyed: boolean } => {
      const where = `${skill.name}/${fileRel}`;
      const out = keyBody(text, { dir, fileRel, units });
      const left = leftoverTokens(out.text)[0];
      if (left) {
        throw pointerRefusal("skills-expand-stray-token", `${where}: ${SKILL_DIR_TOKEN} at line ${left.line} does not point into a board skill`, "Expand writes each skill-dir path as an @key, and only a path into a board skill's folder has one.");
      }
      for (const [k, target] of Object.entries(out.targets)) {
        if (typeof target !== "string" || written.has(target)) continue;
        const folder = folderOf(target);
        throw pointerRefusal(
          "skills-expand-missing-target",
          `${where}: @${k} points at ${target.slice(units[folder]!.length + 1)} in ${nameOf.get(folder)}, which expand does not write`,
          "resolve refuses a skill whose map names a missing file, so the skill would stop on its first run.",
        );
      }
      Object.assign(keys, out.targets);
      return { text: out.text, keyed: Object.keys(out.targets).length > 0 };
    };
    const skillMd = key(skill.skillMd, "SKILL.md").text;
    const files = skill.files.map((f): CompiledFile => {
      if (!f.path.endsWith(".md")) return f;
      const out = key(textOf(f), f.path);
      return { path: f.path, content: out.keyed ? withOpeningLine(out.text, id) : out.text };
    });
    const reads = [...new Set(Object.values(keys).flatMap((t) => (typeof t === "string" && !t.startsWith(`${dir}/`) ? [folderOf(t)] : [])))];
    return { skill: { ...skill, skillMd, files }, pointers: { leaf: skill.name, dir, keys, reads } };
  });

  // A SKILL.md opens with its line once its closed map holds a key, one it reaches through a sibling included.
  const closed = closeUnits(keyed.map((k) => k.pointers), idOf, () => null);
  return keyed.map(({ skill: drafted, pointers }) => {
    const map = closed.get(drafted.name)!;
    const skill = Object.keys(map.keys).length > 0 ? { ...drafted, skillMd: withExpandOpeningLine(drafted.skillMd, map.id) } : drafted;
    const keys = Object.fromEntries(
      Object.entries(map.keys).map(([k, t]): [string, Target] => {
        if (typeof t !== "string" || t.startsWith(`${pointers.dir}/`)) return [k, t];
        const folder = folderOf(t);
        return [k, { skill: nameOf.get(folder)!, path: t.slice(units[folder]!.length + 1) }];
      }),
    );
    return { ...skill, files: [...skill.files, { path: MAP_FILE, content: mapFileText({ ...map, keys }) }] };
  });
}

export function expandSkills(opts: { srcDir: string; outDir: string; roots: PluginRoots }): ExpandedSkill[] {
  if (!existsSync(opts.srcDir) || !statSync(opts.srcDir).isDirectory()) throw new Error(`${opts.srcDir} does not exist`);
  if (overlaps(opts.srcDir, opts.outDir)) {
    throw new Error(`out dir ${opts.outDir} overlaps src dir ${opts.srcDir}; expand deletes inside the out dir, so they must be disjoint`);
  }
  return pointSkills(listSkillDirs(opts.srcDir).map((name) => expandOne(opts.srcDir, opts.outDir, name, opts.roots)));
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

/** The orphan dirs a write would remove; throws, touching nothing, when --out holds a dir expand did not write. */
export function planRemoval(outDir: string, skills: ExpandedSkill[]): string[] {
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
  return { written: skills.map((s) => s.name), removed };
}

/** The first vendored path that is extra, missing or different, or null when the vendored files match. */
function firstVendoredDrift(dir: string, s: ExpandedSkill): string | null {
  const wanted = new Set(s.files.map((f) => f.path));
  const have = new Set(filesOnDisk(dir).filter((p) => p !== "SKILL.md"));
  const extra = [...have].filter((p) => !wanted.has(p)).sort()[0];
  if (extra) return extra;
  const missing = [...wanted].filter((p) => !have.has(p)).sort()[0];
  if (missing) return missing;
  const want = (f: CompiledFile) => ("content" in f ? Buffer.from(f.content) : readFileSync(f.copyFrom));
  return s.files.find((f) => !readFileSync(join(dir, f.path)).equals(want(f)))?.path ?? null;
}

/** SKILL.md compares with provenance masked, so a plugin version bump alone is not drift; a write still stamps the real version. */
export function checkExpanded(outDir: string, skills: ExpandedSkill[]): ExpandDrift[] {
  const drift: ExpandDrift[] = [];
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
