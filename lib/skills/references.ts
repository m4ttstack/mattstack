import { readFileSync } from "fs";
import { join } from "path";
import { walkAttachmentFiles } from "./base-attachments.ts";
import {
  assertNoTeamMarkerInRawFile,
  fileVerbPath,
  includeText,
  PLACEHOLDER_RE,
  readTextUnlessBinary,
  referencePath,
  resolveAttachmentTeamMarkers,
  resolvePackPath,
  type PackTarget,
} from "./placeholders.ts";
import type { AttachmentSource, CompiledFile, PlaceholderContext } from "./types.ts";

/** `from` names where each file came from, so a collision with the skill's own files can say which two met. */
export type ReferenceCopies = { files: { file: CompiledFile; from: string }[]; includes: Record<string, AttachmentSource> };

export type ReferenceOpts = {
  /** The built skill's folder from the pack root, `<side>/<name>`, which a copy's `{{verb.path}}` is relative to. */
  skillRel: string;
  loadInclude?: (name: string) => AttachmentSource;
};

const COPIED = "a file copied into a built skill's references/";

type UnitSource = { dir: string; label: string; base: boolean };

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
 * `.md` file is rendered and may carry what a prop value may; other files
 * are copied as written.
 */
export function referenceCopies(targets: PackTarget[], ctx: PlaceholderContext, opts: ReferenceOpts): ReferenceCopies {
  const out: ReferenceCopies = { files: [], includes: {} };
  const queue = [...targets];
  const copiedUnits = new Set<string>();
  const copiedPaths = new Set<string>();
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
      const content = renderCopy(readFileSync(abs, "utf8"), { where, fileRel: `${opts.skillRel}/${path}`, base: source.base, ctx, queue, opts, includes: out.includes });
      out.files.push({ file: { path, content }, from: abs });
    }
  }
  return out;
}

type CopyRender = {
  where: string;
  fileRel: string;
  base: boolean;
  ctx: PlaceholderContext;
  queue: PackTarget[];
  opts: ReferenceOpts;
  includes: Record<string, AttachmentSource>;
};

/** Team markers resolve only in a unit the org base supplies, the rule a prop value follows. */
function renderCopy(text: string, r: CopyRender): string {
  const resolved = resolveAttachmentTeamMarkers(text, r.where, r.base ? r.ctx.team ?? null : null);
  return resolved
    .split("\n")
    .map((line, i) => {
      const out = line.replace(PLACEHOLDER_RE, (raw, kind: string, arg?: string) => {
        switch (kind) {
          case "include": {
            if (line.trim() !== raw) throw new Error(`${r.where}: ${raw} must be alone on its line (line ${i + 1})`);
            return includeText(arg!, copyInclude(arg, raw, i, r), r.ctx);
          }
          case "verb.path":
            return fileVerbPath(r.ctx.verbSides, arg, raw, r.where, r.fileRel);
          case "pack.path": {
            const target = resolvePackPath(r.ctx, arg, raw, r.where);
            r.queue.push(target);
            return referencePath(r.ctx, target);
          }
          default:
            throw new Error(`${r.where}: ${raw} -- ${COPIED} may carry {{include}}, {{verb.path}} or {{pack.path}} only (line ${i + 1})`);
        }
      });
      if (out.includes("{{")) throw new Error(`${r.where}: literal "{{" at line ${i + 1} -- ${COPIED} may not carry it`);
      return out;
    })
    .join("\n");
}

/** An include the built skill has not loaded is loaded here, and returned so its files vendor under parts/. */
function copyInclude(arg: string | undefined, raw: string, i: number, r: CopyRender): AttachmentSource {
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
  if (inc.tree) throw new Error(`${r.where}: ${raw} -- ${COPIED} may include a flat attachment only, not a block tree (line ${i + 1})`);
  if (!known) r.includes[arg] = inc;
  return inc;
}
