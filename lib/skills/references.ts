import { existsSync, readFileSync } from "fs";
import { dirname, isAbsolute, join, relative } from "path";
import type { BlockDiagnostic } from "./blocks/diagnostics.ts";
import { FRONTMATTER_RE, walkAttachmentFiles } from "./base-attachments.ts";
import { findHandPaths, handPathDiagnostics } from "./hand-paths.ts";
import {
  assertNoTeamMarkerInRawFile,
  includeText,
  packPathResolves,
  readTextUnlessBinary,
  referencePath,
  referencesDir,
  substituteAttachmentPlaceholders,
  type PackTarget,
} from "./placeholders.ts";
import type { AttachmentSource, CompiledFile, PlaceholderContext } from "./types.ts";

/**
 * `from` names where each file came from, so a collision with the skill's own files can say which two met.
 * `diagnostics` are hand-typed paths in copied attachment text; `warnings` are links a copied hand-authored skill can no longer reach.
 */
export type ReferenceCopies = {
  files: { file: CompiledFile; from: string }[];
  includes: Record<string, AttachmentSource>;
  diagnostics: BlockDiagnostic[];
  warnings: string[];
};

export type ReferenceOpts = {
  /** The built skill's folder from the pack root, `<side>/<name>`, which a copy's `{{verb.path}}` is relative to. */
  skillRel: string;
  /** What a copy's `{{pack.name}}` renders to: the pack's plugin name. */
  packName?: string;
  loadInclude?: (name: string) => AttachmentSource;
};

const COPIED = "a file copied into a built skill's references/";

type UnitSource = { dir: string; label: string; base: boolean };

type SkillLinks = { where: string; unit: string; name: string; body: string; startLine: number };

function unitSource(target: PackTarget, ctx: PlaceholderContext): UnitSource {
  if (!target.planned) return { dir: join(ctx.packRoot!, target.side, target.unit), label: `${target.side}/${target.unit}`, base: false };
  const source = ctx.plannedAttachments?.sources?.get(target.unit);
  if (!source) throw new Error(`attachments/${target.unit}: compile plans this attachment but has no folder to copy it from`);
  return { dir: source.dir, label: `${source.base}:attachments/${target.unit}`, base: true };
}

/**
 * Copies every unit a built skill's `{{pack.path}}` names into its
 * references/, then every unit a copy names in turn; a unit is copied once
 * however often it is named, so two units naming each other end. A copied
 * `.md` file is rendered the way a base attachment copied into the pack is; other files
 * are copied as written.
 */
export function referenceCopies(targets: PackTarget[], ctx: PlaceholderContext, opts: ReferenceOpts): ReferenceCopies {
  const out: ReferenceCopies = { files: [], includes: {}, diagnostics: [], warnings: [] };
  const queue = [...targets];
  const copiedUnits = new Set<string>();
  const copiedPaths = new Set<string>();
  const skillLinks: SkillLinks[] = [];
  while (queue.length > 0) {
    const target = queue.shift()!;
    if (copiedUnits.has(`${target.side}/${target.unit}`)) continue;
    copiedUnits.add(`${target.side}/${target.unit}`);
    const source = unitSource(target, ctx);
    const { files, symlinks } = walkAttachmentFiles(source.dir);
    if (symlinks.length > 0) throw new Error(`${source.label}/${symlinks[0]}: a symlink cannot be ${COPIED}; compile copies regular files only`);
    for (const name of files) {
      const path = `references/${target.unit}/${name}`;
      if (copiedPaths.has(path)) continue;
      copiedPaths.add(path);
      const abs = join(source.dir, name);
      const where = `${source.label}/${name}`;
      if (!name.endsWith(".md")) {
        const text = readTextUnlessBinary(abs);
        if (text !== null) assertNoTeamMarkerInRawFile(text, where);
        out.files.push({ file: { path, copyFrom: abs }, from: abs });
        continue;
      }
      const raw = readFileSync(abs, "utf8");
      const head = raw.match(FRONTMATTER_RE)?.[0] ?? "";
      const at = { body: raw.slice(head.length), startLine: (head.match(/\n/g)?.length ?? 0) + 1 };
      if (target.side === "skills") {
        skillLinks.push({ where, unit: target.unit, name, ...at });
      } else {
        const handPaths = handPathDiagnostics(at.body, where, { ...copyFixView(ctx, source.base), startLine: at.startLine, depth: name.split("/").length - 1 });
        if (handPaths.length > 0) {
          out.diagnostics.push(...handPaths);
          continue;
        }
      }
      const content = renderCopy(raw, { where, unit: target.unit, fileRel: `${opts.skillRel}/${path}`, base: source.base, ctx, queue, opts, includes: out.includes });
      out.files.push({ file: { path, content }, from: abs });
    }
  }
  for (const links of skillLinks) out.warnings.push(...deadSkillLinks(links, copiedPaths, join(ctx.packRoot!, opts.skillRel)));
  return out;
}

function copyFixView(ctx: PlaceholderContext, base: boolean) {
  const team = base ? ctx.team ?? null : null;
  return {
    verbs: new Set(Object.keys(ctx.verbSides)),
    packSource: (arg: string) => packPathResolves(ctx, arg),
    teamValue: team ? (key: string) => (Object.hasOwn(team.values.params, key) ? team.values.params[key] : undefined) : undefined,
  };
}

/**
 * A hand-authored skill is also read in place, where a placeholder would read as text, so its
 * links cannot be rewritten: each one judged from where the copy lands only warns.
 */
function deadSkillLinks(links: SkillLinks, copiedPaths: ReadonlySet<string>, skillDir: string): string[] {
  const unitDir = join(skillDir, "references", links.unit);
  const fileDir = dirname(join(unitDir, links.name));
  const dead: string[] = [];
  for (const p of findHandPaths(links.body, { startLine: links.startLine })) {
    if (p.anchor === "plugin-root" || p.path.includes("{{") || p.path.includes("<")) continue;
    const dest = join(p.anchor === "skill-dir" ? unitDir : fileDir, "../".repeat(p.ups), p.rest);
    const inRefs = relative(join(skillDir, "references"), dest);
    const reaches = inRefs.startsWith("..") || isAbsolute(inRefs) ? existsSync(dest) : copiedPaths.has(`references/${inRefs}`);
    if (!reaches && !dead.includes(p.path)) dead.push(p.path);
  }
  return dead.map((path) => `${links.where}: ${path} does not resolve from its copy in references/${links.unit}/`);
}

type CopyRender = {
  where: string;
  fileRel: string;
  unit: string;
  base: boolean;
  ctx: PlaceholderContext;
  queue: PackTarget[];
  opts: ReferenceOpts;
  includes: Record<string, AttachmentSource>;
};

/** Rendered like a base attachment copied into the pack; team markers resolve only in a unit the org base supplies. */
function renderCopy(text: string, r: CopyRender): string {
  return substituteAttachmentPlaceholders(text, {
    packName: r.opts.packName ?? "",
    fileRel: r.fileRel,
    verbSides: r.ctx.verbSides,
    packRoot: r.ctx.packRoot!,
    plannedAttachments: r.ctx.plannedAttachments,
    where: r.where,
    team: r.base ? r.ctx.team ?? null : null,
    copy: {
      skillDir: referencesDir(r.ctx, r.unit),
      packPath: (target) => {
        r.queue.push(target);
        return referencePath(r.ctx, target);
      },
      include: (arg, raw, at) => {
        if (!at.alone) throw new Error(`${r.where}: ${raw} must be alone on its line (line ${at.line})`);
        return includeText(arg!, copyInclude(arg, raw, at.line, r), r.ctx);
      },
    },
  });
}

/** An include the built skill has not loaded is loaded here, and returned so its files vendor under parts/. */
function copyInclude(arg: string | undefined, raw: string, line: number, r: CopyRender): AttachmentSource {
  const known = arg ? (Object.hasOwn(r.ctx.includes, arg) ? r.ctx.includes[arg] : r.includes[arg]) : undefined;
  let inc = known;
  if (!inc && arg && r.opts.loadInclude) {
    try {
      inc = r.opts.loadInclude(arg);
    } catch (err) {
      throw new Error(`${r.where}: ${(err as Error).message}`);
    }
  }
  if (!arg || !inc) throw new Error(`${r.where}: include "${arg}" is not a loaded attachment`);
  if (inc.tree) throw new Error(`${r.where}: ${raw} -- ${COPIED} may include a flat attachment only, not a block tree (line ${line})`);
  if (!known) r.includes[arg] = inc;
  return inc;
}
