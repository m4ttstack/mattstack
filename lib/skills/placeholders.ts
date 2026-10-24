import { existsSync, readFileSync, statSync } from "fs";
import { join, posix } from "path";
import { defaultPipeline } from "./pipelines.ts";
import { firstTeamMarker, resolveTeamMarkers, type TeamContext } from "./team-params.ts";
import type { AttachmentSource, PlaceholderContext, PlannedAttachments, Side, StageEntry } from "./types.ts";

export type Placeholder = { kind: string; arg: string | null; line: number; raw: string };

export const PLACEHOLDER_RE = /\{\{([a-z][a-z0-9.-]*)(?::([^}\s]+))?\}\}/g;

export function findPlaceholders(body: string): Placeholder[] {
  const out: Placeholder[] = [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i]!.matchAll(PLACEHOLDER_RE)) {
      out.push({ kind: m[1]!, arg: m[2] ?? null, line: i + 1, raw: m[0] });
    }
  }
  return out;
}

export function assertNoPlaceholders(body: string, where: string): void {
  const first = findPlaceholders(body)[0];
  if (first) throw new Error(`${where}: unfilled placeholder ${first.raw} at line ${first.line}`);
}

/** Every seam kind's span, so their formats cannot drift apart. */
export function spanOf(src: { srcPath: string; bodyStartLine: number; body: string }, droppedLines = 0): string {
  const lines = src.body.split("\n").length - droppedLines;
  return `path=${src.srcPath} lines=${src.bodyStartLine}-${src.bodyStartLine + lines - 1}`;
}

function fenced(value: unknown): string {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

const SKILL_DIR_TOKEN = "${CLAUDE_SKILL_DIR}";

/**
 * A parts dir is only emitted for a source that vendors files, so a source
 * without any keeps the host skill's own directory -- rewriting to a parts dir
 * that will never exist leaves every runtime use of the token dangling.
 * Exported because a fill's `allowed-tools` rules must land on the same
 * directory its body does, or the frontmatter grants a path the body never names.
 */
export function skillDirFor(source: AttachmentSource, ctx: PlaceholderContext, partsName: string): string {
  if (source.extraFiles.length > 0) return `${ctx.partsPrefix}/${partsName}`;
  return ctx.stageDir ?? SKILL_DIR_TOKEN;
}

/** Points a text's `${CLAUDE_SKILL_DIR}` at `dir`, the folder its own files land in. */
export function atSkillDir(text: string, dir: string): string {
  return text.split(SKILL_DIR_TOKEN).join(dir);
}

/** A unit's folder inside a built skill's references/, as the reading skill reaches it. */
export function referencesDir(ctx: Pick<PlaceholderContext, "stageDir">, unit: string): string {
  return `${ctx.stageDir ?? SKILL_DIR_TOKEN}/references/${unit}`;
}

/**
 * Only an org base's text may carry team markers. A base fill's markers
 * resolve before any other substitution, so a value is never read as an
 * include; a value cannot itself contain `{{`. Reports file lines, counting
 * from where the fill's body starts in its source file. `span` is the prop
 * seam's: source lines less those an absent optional section drops, since
 * the seam walkers consume one rendered line per counted source line.
 * `sourceLine` maps a 1-based line of the resolved body to the fill body line it came from.
 */
export function resolveFillTeamMarkers(
  fill: AttachmentSource,
  team: TeamContext | null | undefined,
): { body: string; span: string; sourceLine: (resolvedLine: number) => number } {
  assertNoTeamMarkerInFrontmatter(fill);
  assertNoTeamMarkerInAllowedTools(fill);
  const hit = firstTeamMarker(fill.body);
  if (!hit) return { body: fill.body, span: spanOf(fill), sourceLine: (n) => n };
  if (team && team.basePlugins.has(fill.plugin)) {
    const dropped = { lines: 0 };
    const lineMap: number[] = [];
    const body = resolveTeamMarkers(fill.body, team, { where: fill.binding, sectionSeams: true, startLine: fill.bodyStartLine, dropped, lineMap });
    return { body, span: spanOf(fill, dropped.lines), sourceLine: (n) => (lineMap[n - 1] ?? n - 1) + 1 };
  }
  const line = fill.bodyStartLine + hit.lineIndex;
  if (!team) throw new Error(`${fill.binding}: ${hit.raw} -- the pack has no .claude-plugin/plugin.json name to give team markers (line ${line})`);
  throw new Error(`${fill.binding}: ${hit.raw} -- team markers only resolve in base pack text (line ${line})`);
}

/**
 * An inlined fill's frontmatter is dropped, so a marker there would vanish
 * unresolved. A reference-bound fill keeps its own frontmatter as an installed
 * skill, so only its allowed-tools (which compile copies) is checked.
 */
function assertNoTeamMarkerInFrontmatter(fill: AttachmentSource): void {
  const marker = fill.frontmatterTeamMarker;
  if (marker) throw new Error(`${fill.binding}: ${marker.raw} -- team markers only resolve in a body, not frontmatter (line ${marker.line})`);
}

/** allowed-tools lands in compiled frontmatter unresolved, whether the fill is inlined or bound by reference. */
export function assertNoTeamMarkerInAllowedTools(fill: AttachmentSource): void {
  for (const tool of fill.allowedTools) {
    const hit = firstTeamMarker(tool);
    if (hit) throw new Error(`${fill.binding}: ${hit.raw} -- team markers only resolve in a body, not frontmatter`);
  }
}

export function fillReference(name: string, fill: AttachmentSource): string {
  return `Prop ${name} is bound to \`${fill.binding}\` (${fill.binding}@${fill.version}) -- invoke that skill when this flow needs it.`;
}

/** `key` is the seam's part key (`prop:<block>.<name>`); `partsName` is the parts dir the fill's files vendor under. */
export function inlineFillText(
  key: string,
  partsName: string,
  fill: AttachmentSource,
  ctx: PlaceholderContext,
  used: Pick<Used, "packPaths" | "references">,
  treeInclude?: TreeIncludeText,
): string {
  const resolved = resolveFillTeamMarkers(fill, ctx.team);
  const rewritten = atSkillDir(resolved.body, skillDirFor(fill, ctx, partsName));
  const toSource: TreeIncludeText | undefined = treeInclude
    && ((name, at) => treeInclude(name, { line: resolved.sourceLine(at.line), textAfter: at.textAfter === null ? null : resolved.sourceLine(at.textAfter) }));
  const inlined = substituteIncludesOnly(rewritten, ctx, fill.binding, toSource);
  used.packPaths.push(...inlined.packPaths);
  used.references.push(...inlined.references);
  return `<!-- part: ${key} binding=${fill.binding} version=${fill.version} ${resolved.span} -->\n${inlined.body}`;
}

export function includeText(name: string, inc: AttachmentSource, ctx: PlaceholderContext): string {
  const body = atSkillDir(inc.body, skillDirFor(inc, ctx, `include-${name}`));
  return `<!-- part: include:${name} source=${inc.plugin}:${name} version=${inc.version} ${spanOf(inc)} -->\n${body}`;
}

/**
 * The rendered text of a block-tree include, or null when `name` is no tree include. `line` is the
 * include's line and `textAfter` the first non-blank line after it (null when none follows), both counting from 1 in the fill body.
 */
export type TreeIncludeText = (name: string, at: { line: number; textAfter: number | null }) => string | null;

/**
 * loadInclude enforces that a flat include target is placeholder-free, so a
 * fill body carrying {{include}} lines cannot recurse --
 * `where` is the fill's own binding, matching how a step body names itself.
 */
export function substituteIncludesOnly(
  body: string,
  ctx: PlaceholderContext,
  where: string,
  treeInclude?: TreeIncludeText,
): { body: string; packPaths: string[]; references: PackTarget[] } {
  const packPaths: string[] = [];
  const references: PackTarget[] = [];
  const lines = body.split("\n");
  const textAfter = (i: number): number | null => {
    const next = lines.findIndex((l, j) => j > i && l.trim() !== "");
    return next < 0 ? null : next + 1;
  };
  const out = lines.map((line, i) =>
    line.replace(PLACEHOLDER_RE, (raw, kind: string, arg?: string) => {
      switch (kind) {
        case "include": {
          if (line.trim() !== raw) throw new Error(`${where}: ${raw} must be alone on its line (line ${i + 1})`);
          const inc = arg ? ctx.includes[arg] : undefined;
          if (arg && inc) return includeText(arg, inc, ctx);
          const tree = arg ? treeInclude?.(arg, { line: i + 1, textAfter: textAfter(i) }) ?? null : null;
          if (tree === null) throw new Error(`${where}: include "${arg}" is not a loaded attachment`);
          return tree;
        }
        case "verb.path": return verbPath(ctx, arg, raw, where);
        case "pack.path": {
          const target = resolvePackPath(ctx, arg, raw, where);
          const rendered = referencePath(ctx, target);
          packPaths.push(rendered);
          references.push(target);
          return rendered;
        }
        default:
          throw new Error(`${where}: ${raw} -- a fill may carry {{include}}, {{verb.path}} or {{pack.path}} only (line ${i + 1})`);
      }
    }),
  );
  return { body: out.join("\n"), packPaths, references };
}

export type AttachmentRenderOpts = {
  packName: string;
  fileRel: string;
  verbSides: Record<string, Side>;
  packRoot: string;
  plannedAttachments?: PlannedAttachments;
  where: string;
  team: TeamContext | null;
  /** Set for a file copied into a built skill's references/, which resolves includes and points pack.path at its own copies. */
  copy?: CopyHooks;
};

/** `line` counts from 1 in the text after team markers resolve; `alone` says whether the placeholder is its line's only text. */
export type CopyHooks = {
  /** The copy's own folder as the reading skill reaches it; its `${CLAUDE_SKILL_DIR}` points there, as a fill's points at its parts dir. */
  skillDir: string;
  packPath: (target: PackTarget) => string;
  include: (arg: string | undefined, raw: string, at: { line: number; alone: boolean }) => string;
};

/** Each of these renders from the skill that reads it, which a file shared by path cannot know. */
const READER_PLACEHOLDERS = new Set(["stage.dir", "stage.fields", "pipeline.stages", "pipeline.table", "run-list.pipelines", "work-type", "run-start.flags", "compiled-from"]);

function lineAt(text: string, offset: number, raw: string): { line: number; alone: boolean } {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const end = text.indexOf("\n", offset);
  return { line: lineCount(text.slice(0, offset)) + 1, alone: text.slice(start, end < 0 ? text.length : end).trim() === raw };
}

const FRONTMATTER_BLOCK_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

function lineCount(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

const BINARY_SNIFF_BYTES = 8192;

export function readTextUnlessBinary(abs: string): string | null {
  const buf = readFileSync(abs);
  return buf.subarray(0, BINARY_SNIFF_BYTES).includes(0) ? null : buf.toString("utf8");
}

/** A copied file is not rewritten, so a marker in it would ship as written. */
export function assertNoTeamMarkerInRawFile(text: string, where: string, why = "team markers only resolve in .md files"): void {
  const hit = firstTeamMarker(text);
  if (hit) throw new Error(`${where}: ${hit.raw} -- ${why} (line ${hit.lineIndex + 1})`);
}

/** Resolves a copied .md file's body, counting error lines from the top of the file; with no team, any marker is refused. */
export function resolveAttachmentTeamMarkers(text: string, where: string, team: TeamContext | null): string {
  const hit = firstTeamMarker(text);
  if (!hit) return text;
  const head = text.match(FRONTMATTER_BLOCK_RE)?.[0] ?? "";
  const headHit = firstTeamMarker(head);
  if (headHit) {
    throw new Error(`${where}: ${headHit.raw} -- team markers only resolve in a body, not frontmatter (line ${headHit.lineIndex + 1})`);
  }
  if (!team) {
    throw new Error(`${where}: ${hit.raw} -- team markers only resolve in base pack text (line ${hit.lineIndex + 1})`);
  }
  return head + resolveTeamMarkers(text.slice(head.length), team, { where, sectionSeams: false, startLine: lineCount(head) + 1 });
}

/**
 * An emitted base attachment, and a file copied into a built skill's
 * references/, is read as a plain file, so it gets only what makes sense
 * outside a compiled verb; every other brace passes through so template
 * examples in the text survive.
 */
export function substituteAttachmentPlaceholders(body: string, opts: AttachmentRenderOpts): string {
  const { where, copy } = opts;
  const resolved = resolveAttachmentTeamMarkers(body, where, opts.team);
  const text = copy ? atSkillDir(resolved, copy.skillDir) : resolved;
  return text.replace(PLACEHOLDER_RE, (raw: string, kind: string, arg: string | undefined, offset: number) => {
    switch (kind) {
      case "pack.name":
        if (arg !== undefined) throw new Error(`${where}: ${raw} -- pack.name takes no argument`);
        if (!opts.packName) throw new Error(`${where}: ${raw} -- the pack has no .claude-plugin/plugin.json name to give it`);
        return opts.packName;
      case "verb.path":
        return fileVerbPath(opts.verbSides, arg, raw, where, opts.fileRel);
      case "pack.path": {
        const target = resolvePackPath(opts, arg, raw, where);
        return copy ? copy.packPath(target) : sourcePackPath(target);
      }
      case "include":
        return copy ? copy.include(arg, raw, lineAt(text, offset, raw)) : raw;
      default:
        if (copy && READER_PLACEHOLDERS.has(kind)) {
          throw new Error(`${where}: ${raw} -- its value depends on the skill reading it, so a file copied into a built skill's references/ cannot carry it (line ${lineAt(text, offset, raw).line})`);
        }
        return raw;
    }
  });
}

/** `{{verb.path}}` in a file read as a plain file: relative to `fileRel`, that file's pack-relative path. */
export function fileVerbPath(verbSides: Record<string, Side>, arg: string | undefined, raw: string, where: string, fileRel: string): string {
  if (arg === undefined || !VERB_NAME_RE.test(arg)) throw new Error(`${where}: ${raw} -- verb name must match [a-z][a-z0-9-]*`);
  const side = verbSides[arg];
  if (!side) throw new Error(`${where}: ${raw} -- ${arg} is not a compiled verb of this pack`);
  return posix.relative(posix.dirname(fileRel), `${side}/${arg}/SKILL.md`);
}

/** `engine` stays out so a pack with no stage copies compiles the same bytes it always has. */
function stageTableJson(pipelines: Record<string, StageEntry[]>): Record<string, Omit<StageEntry, "engine">[]> {
  return Object.fromEntries(Object.entries(pipelines).map(([type, list]) => [type, list.map(({ engine: _engine, ...entry }) => entry)]));
}

function workTypeText(pipelines: Record<string, StageEntry[]>, where: string): string {
  const types = Object.keys(pipelines);
  if (types.length === 0) throw new Error(`${where}: {{work-type}} cannot be filled -- the manifest declares no pipelines`);
  if (types.length === 1) return `The work type is \`${types[0]}\`. Continue.`;
  const menu = types.map((t) => `- \`${t}\``).join("\n");
  return `This pack declares several work types:\n\n${menu}\n\nAsk one structured question to pick one, then use that key in the stage list and run-start flags below.`;
}

const VERB_NAME_RE = /^[a-z][a-z0-9-]*$/;

function runStartFlags(ctx: PlaceholderContext, arg: string | undefined, raw: string, where: string): string {
  // run-start's flag parser takes the token after a flag as its value, so an empty
  // sha must drop the flag entirely rather than leave `--mattstack-dirty` as the value.
  const sha = ctx.mattstackSha ? ` --mattstack-sha ${ctx.mattstackSha}` : "";
  const pack = ctx.packSha ? ` --pack-sha ${ctx.packSha}` : "";
  const tail = `${sha} --mattstack-dirty ${ctx.mattstackDirty}${pack}`;
  if (arg !== undefined) {
    if (!VERB_NAME_RE.test(arg)) throw new Error(`${where}: ${raw} -- verb must match [a-z][a-z0-9-]*`);
    return fenced({ [arg]: `--repo ${ctx.repoKey} --work-type ${arg} --pipeline ${ctx.pipeline ?? arg}${tail}` });
  }
  const out: Record<string, string> = {};
  for (const t of Object.keys(ctx.pipelines)) {
    out[t] = `--repo ${ctx.repoKey} --work-type ${t} --pipeline ${t}${tail}`;
  }
  return fenced(out);
}

const TABLE_HEADER = ["| Stage | Read | Consumes | Produces |", "|---|---|---|---|"];

function tableEntries(ctx: PlaceholderContext, where: string): StageEntry[] {
  if (ctx.pipeline === null) throw new Error(`${where}: {{pipeline.table}} used by a verb with no pipeline`);
  const list = Object.hasOwn(ctx.pipelines, ctx.pipeline) ? ctx.pipelines[ctx.pipeline] : undefined;
  if (!list) throw new Error(`${where}: {{pipeline.table}} runs pipeline "${ctx.pipeline}", which the manifest does not declare`);
  return list;
}

function pipelineTable(ctx: PlaceholderContext, where: string): string {
  const names = (xs: string[]) => (xs.length > 0 ? xs.map((x) => `\`${x}\``).join(" ") : "nothing");
  const rows = tableEntries(ctx, where).map((e) => {
    const read = `${SKILL_DIR_TOKEN}/${verbPath(ctx, e.name, `{{verb.path:${e.name}}}`, where)}`;
    return `| \`${e.stage}\` | \`${read}\` | ${names(e.consumes)} | ${names(e.produces)} |`;
  });
  return [...TABLE_HEADER, ...rows].join("\n");
}

/** Runs recorded before work verbs named a pipeline stored `work`, and those belong to the default pipeline. */
function runListPipelines(ctx: PlaceholderContext, where: string): string {
  if (ctx.pipeline === null) throw new Error(`${where}: {{run-list.pipelines}} used by a verb with no pipeline`);
  const names = new Set([ctx.pipeline]);
  if (ctx.pipeline === defaultPipeline(ctx.pipelines)) names.add("work");
  return [...names].map((n) => `\`${n}\``).join(", ");
}

/** A reading path from the current output file to a sibling target's SKILL.md: relative to this file, never a shell path. */
function verbPath(ctx: PlaceholderContext, arg: string | undefined, raw: string, where: string): string {
  if (arg === undefined || !VERB_NAME_RE.test(arg)) throw new Error(`${where}: ${raw} -- verb name must match [a-z][a-z0-9-]*`);
  const side = ctx.verbSides[arg];
  if (!side) throw new Error(`${where}: ${raw} -- ${arg} is not a compiled verb of this pack`);
  return side === ctx.side ? `../${arg}/SKILL.md` : `../../${side}/${arg}/SKILL.md`;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

type PackPathView = Pick<PlaceholderContext, "verbSides" | "packRoot" | "plannedAttachments">;

/**
 * An emitted unit one group deep is planned as <group>/<name>, so its files
 * are named past one more segment of <file>. A flat unit planned for removal
 * (an empty set) yields to a grouped unit at the same group, which is what a
 * base that turned the flat folder into a group leaves behind.
 */
function plannedUnit(plan: PlannedAttachments | undefined, attachment: string, file: string): { unit: string; unitFile: string; planned: ReadonlySet<string> | undefined } {
  const flat = plan?.get(attachment);
  if (flat && flat.size > 0) return { unit: attachment, unitFile: file, planned: flat };
  const slash = file.indexOf("/");
  const grouped = slash > 0 ? plan?.get(`${attachment}/${file.slice(0, slash)}`) : undefined;
  if (grouped) return { unit: `${attachment}/${file.slice(0, slash)}`, unitFile: file.slice(slash + 1), planned: grouped };
  return { unit: attachment, unitFile: file, planned: flat };
}

/**
 * What `{{pack.path:<attachment>/<file>}}` names: `unit` is the folder that
 * holds the file under `side` (one group deep for a planned grouped unit),
 * and `planned` marks a unit compile emits from the org base.
 */
export type PackTarget = { side: Side; attachment: string; file: string; unit: string; planned: boolean };

/**
 * A compiled target's output is written only after every target compiles, so
 * naming one would pass the existence check on a recompile and fail on a
 * clean one. Pack-authored source is addressable, and so are the base
 * attachments compile emits: they are planned before any target compiles,
 * and for those names the plan, not the disk, says what will exist.
 */
export function resolvePackPath(view: PackPathView, arg: string | undefined, raw: string, where: string): PackTarget {
  const slash = arg?.indexOf("/") ?? -1;
  if (!arg || slash <= 0 || slash === arg.length - 1) throw new Error(`${where}: ${raw} -- pack.path takes <attachment>/<file>`);
  const attachment = arg.slice(0, slash);
  const file = arg.slice(slash + 1);
  if (!VERB_NAME_RE.test(attachment)) throw new Error(`${where}: ${raw} -- <attachment> must match [a-z][a-z0-9-]*`);
  if (file.split("/").some((s) => s === "" || s === "." || s === "..")) {
    throw new Error(`${where}: ${raw} -- <file> may not contain "..", "." or empty segments`);
  }
  if (attachment in view.verbSides) throw new Error(`${where}: ${raw} -- ${attachment} is a compiled verb; pack.path names source files only`);
  const packRoot = view.packRoot;
  if (!packRoot) throw new Error(`${where}: ${raw} -- pack.path needs a pack root`);
  const { unit, unitFile, planned } = plannedUnit(view.plannedAttachments, attachment, file);
  const onAttachments = planned ? planned.size > 0 : isDirectory(join(packRoot, "attachments", unit));
  const onSkills = isDirectory(join(packRoot, "skills", unit));
  if (onAttachments && onSkills) throw new Error(`${where}: ${raw} -- ${unit} exists under both attachments/ and skills/`);
  const side = onAttachments ? "attachments" : onSkills ? "skills" : null;
  if (!side) throw new Error(`${where}: ${raw} -- ${unit} is not a directory under attachments/ or skills/`);
  const rel = `${side}/${attachment}/${file}`;
  const isPlanned = side === "attachments" && planned !== undefined;
  const exists = isPlanned ? planned.has(unitFile) : existsSync(join(packRoot, rel));
  if (!exists) throw new Error(`${where}: ${raw} -- ${rel} does not exist`);
  return { side, attachment, file, unit, planned: isPlanned };
}

/**
 * For a base attachment compile copies into the pack as a plain file.
 * Anchored on the invoking skill's dir rather than this file's, so the same
 * text works inside a shell command from any public skill in the pack.
 */
function sourcePackPath(target: PackTarget): string {
  return `${SKILL_DIR_TOKEN}/../../${target.side}/${target.attachment}/${target.file}`;
}

/**
 * A built skill reads a rendered copy of the unit in its own references/:
 * pack source ships as written, so a placeholder in it would reach the agent
 * unrendered. A stage or internal verb reaches its folder through stageDir.
 */
export function referencePath(ctx: Pick<PlaceholderContext, "stageDir">, target: PackTarget): string {
  return `${referencesDir(ctx, target.attachment)}/${target.file}`;
}

/** Whether `{{pack.path:<arg>}}` would render in this view, without throwing. */
export function packPathResolves(view: PackPathView, arg: string): boolean {
  try {
    resolvePackPath(view, arg, `{{pack.path:${arg}}}`, "");
    return true;
  } catch {
    return false;
  }
}

function stageFields(meta: NonNullable<PlaceholderContext["stageMeta"]>): string {
  const q = (xs: string[]) => xs.map((x) => `\`${x}\``).join(", ");
  const consume = meta.consumes.length ? `You consume ${q(meta.consumes)}.` : "You consume nothing.";
  const produce = meta.produces.length ? `You must produce ${q(meta.produces)}.` : "You produce nothing.";
  return `${consume} ${produce}`;
}

/** `references` holds every unit a `{{pack.path}}` named, for the built skill to copy. */
export type Used = { includes: string[]; packPaths: string[]; references: PackTarget[] };

// Global-regex `.replace` resets `lastIndex` per call, so PLACEHOLDER_RE is safe to share with findPlaceholders.
export function substituteLine(line: string, i: number, ctx: PlaceholderContext, where: string, used: Used): string {
  return line.replace(PLACEHOLDER_RE, (raw, kind: string, arg?: string) => {
    // The console's parser and stripCompilerComments both require an include
    // seam marker to start a line, so the placeholder that produces it must be
    // alone on its own line too -- an inline one would emit a marker neither
    // recognizes, turning a legitimate binding into unstrippable lint material.
    switch (kind) {
      case "include": {
        if (line.trim() !== raw) throw new Error(`${where}: ${raw} must be alone on its line (line ${i + 1})`);
        const inc = arg ? ctx.includes[arg] : undefined;
        if (!arg || !inc) throw new Error(`${where}: include "${arg}" is not a loaded attachment`);
        used.includes.push(arg);
        return includeText(arg, inc, ctx);
      }
      case "pipeline.stages": return fenced(stageTableJson(ctx.pipelines));
      case "pipeline.table":
        if (line.trim() !== raw) throw new Error(`${where}: ${raw} must be alone on its line (line ${i + 1})`);
        if (arg !== undefined) throw new Error(`${where}: ${raw} takes no argument`);
        return pipelineTable(ctx, where);
      case "run-list.pipelines":
        if (arg !== undefined) throw new Error(`${where}: ${raw} takes no argument`);
        return runListPipelines(ctx, where);
      case "work-type": return workTypeText(ctx.pipelines, where);
      case "run-start.flags": return runStartFlags(ctx, arg, raw, where);
      case "verb.path": return verbPath(ctx, arg, raw, where);
      case "pack.path": {
        const target = resolvePackPath(ctx, arg, raw, where);
        const rendered = referencePath(ctx, target);
        used.packPaths.push(rendered);
        used.references.push(target);
        return rendered;
      }
      case "compiled-from": return ctx.compiledFrom;
      case "stage.dir":
        if (!ctx.stageDir) throw new Error(`${where}: {{stage.dir}} used in a public verb`);
        return ctx.stageDir;
      case "stage.fields":
        if (!ctx.stageMeta) throw new Error(`${where}: {{stage.fields}} used outside a stage`);
        return stageFields(ctx.stageMeta);
      default:
        throw new Error(`${where}: unknown placeholder ${raw} at line ${i + 1}`);
    }
  });
}
