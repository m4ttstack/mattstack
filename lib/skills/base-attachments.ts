import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { TEAM_NAME_RE } from "../settings/stores.ts";
import { boardOnlyBaseFills, mergedBindings } from "./board-fills.ts";
import { hasCompiledHeader } from "./compile.ts";
import { substituteAttachmentPlaceholders } from "./placeholders.ts";
import { packPluginIdentity } from "./provenance.ts";
import { listDirs, orgOfPackDir, readJsoncObject, stripFrontmatter } from "./sources.ts";
import type { CompiledFile, PlannedAttachments, Side } from "./types.ts";

export const PROVENANCE_FILE = "compiled.json";

export type BaseRef = { name: string; dir: string; version: string | null };
export type EmittedAttachment = { name: string; files: CompiledFile[] };
export type StaleAttachment = { name: string; why: "dropped" | "no-base" };
export type BaseAttachmentPlan = {
  base: BaseRef | null;
  emits: EmittedAttachment[];
  kept: string[];
  stale: StaleAttachment[];
  /** Folders a since-retired verb compiled at a unit's path; compile removes each before copying the unit there. */
  retired: string[];
  errors: string[];
};

/** A hand-authored data file may also be called compiled.json, so only compile's own shape marks a folder as output. */
export function isEmittedAttachmentText(text: string | null): boolean {
  if (text === null) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const { base, files, version } = parsed as { base?: unknown; files?: unknown; version?: unknown };
    return typeof base === "string" && Array.isArray(files) && Object.hasOwn(parsed, "version") && (typeof version === "string" || version === null);
  } catch {
    return false;
  }
}

export function isEmittedAttachmentDir(dir: string): boolean {
  const path = join(dir, PROVENANCE_FILE);
  try {
    return statSync(path).isFile() && isEmittedAttachmentText(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

export function maskProvenanceVersion(text: string): string {
  return text.replace(/"version": (?:"[^"]*"|null)/, '"version": "*"');
}

export function isSkippedAttachmentPath(rel: string): boolean {
  return rel.split("/").some((segment) => segment === ".DS_Store" || segment === "__pycache__") || rel.endsWith(".pyc");
}

export function walkAttachmentFiles(dir: string): { files: string[]; symlinks: string[] } {
  const files: string[] = [];
  const symlinks: string[] = [];
  const walk = (sub: string) => {
    for (const entry of readdirSync(sub ? join(dir, sub) : dir, { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (isSkippedAttachmentPath(rel)) continue;
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile()) files.push(rel);
      else if (entry.isSymbolicLink()) symlinks.push(rel);
    }
  };
  walk("");
  return { files: files.sort(), symlinks: symlinks.sort() };
}

function isFill(dir: string): boolean {
  const skillMd = join(dir, "SKILL.md");
  if (!existsSync(skillMd)) return false;
  const provides = (stripFrontmatter(readFileSync(skillMd, "utf8")).frontmatter.metadata as { provides?: unknown } | undefined)?.provides;
  return typeof provides === "string" && provides !== "";
}

function isHandAuthored(dir: string): boolean {
  return existsSync(join(dir, "SKILL.md")) && !hasCompiledHeader(dir);
}

function resolveBase(packDir: string, packName: string, name: unknown): BaseRef | string {
  if (typeof name !== "string") return `${packName}'s extends is not a string`;
  const org = orgOfPackDir(packDir);
  if (!org) return `${packName} extends ${name}, but it is not inside an org repo`;
  if (!TEAM_NAME_RE.test(name)) return `${packName} extends "${name}", which is not a base pack name`;
  const dir = join(org.root, "mattstack", "org", "packs", name);
  const fragment = readJsoncObject(join(dir, "pack", "skills.jsonc"));
  if (!fragment) return `${packName} extends ${name}, but the org has no base pack called ${name}`;
  if (fragment.base !== true) return `${packName} extends ${name}, but the org's ${name} pack is not marked as a base pack`;
  if (typeof fragment.extends === "string") return `${packName} extends ${name}, which extends ${fragment.extends}; a base pack cannot extend another`;
  return { name, dir, version: packPluginIdentity(dir)?.version || null };
}

/**
 * An emitted unit sits at attachments/<name> or one group deep at
 * attachments/<group>/<name>, the depth loadAttachment resolves; a folder
 * holding a SKILL.md is never a group, so nothing inside it is scanned.
 */
export function listEmittedUnits(attachmentsDir: string): string[] {
  const units: string[] = [];
  for (const top of listDirs(attachmentsDir)) {
    const dir = join(attachmentsDir, top);
    if (isEmittedAttachmentDir(dir)) units.push(top);
    else if (!existsSync(join(dir, "SKILL.md"))) units.push(...listDirs(dir).filter((leaf) => isEmittedAttachmentDir(join(dir, leaf))).map((leaf) => `${top}/${leaf}`));
  }
  return units;
}

type BaseUnit = { rel: string; srcDir: string };

function baseUnits(baseName: string, attachmentsDir: string, errors: string[]): BaseUnit[] {
  const units: BaseUnit[] = [];
  for (const top of listDirs(attachmentsDir)) {
    if (top.startsWith(".")) continue;
    const dir = join(attachmentsDir, top);
    if (existsSync(join(dir, "SKILL.md"))) {
      units.push({ rel: top, srcDir: dir });
      continue;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (isSkippedAttachmentPath(entry.name)) continue;
      const child = join(dir, entry.name);
      if (entry.isDirectory() && existsSync(join(child, "SKILL.md"))) {
        units.push({ rel: `${top}/${entry.name}`, srcDir: child });
        continue;
      }
      if (entry.isDirectory()) {
        const { files, symlinks } = walkAttachmentFiles(child);
        if (files.length === 0 && symlinks.length === 0) continue;
      }
      errors.push(`${baseName} attachment folder ${top} holds ${entry.name} outside any attachment; compile copies only folders with a SKILL.md`);
    }
  }
  return units;
}

/**
 * The team's attachments by bare name, the way the surface verbs enumerate
 * them (which refuse one name twice): a folder with a SKILL.md, else its
 * leaves that have one, else the folder itself. Emitted units are left out,
 * since the plan re-emits or removes each of them.
 */
function teamAttachmentNames(attachmentsDir: string): Map<string, string[]> {
  const names = new Map<string, string[]>();
  const add = (name: string, rel: string) => {
    if (!isEmittedAttachmentDir(join(attachmentsDir, rel))) names.set(name, [...(names.get(name) ?? []), rel]);
  };
  for (const top of listDirs(attachmentsDir)) {
    const dir = join(attachmentsDir, top);
    const leaves = existsSync(join(dir, "SKILL.md")) ? [] : listDirs(dir).filter((leaf) => existsSync(join(dir, leaf, "SKILL.md")));
    if (leaves.length === 0) add(top, top);
    for (const leaf of leaves) add(leaf, `${top}/${leaf}`);
  }
  return names;
}

/** A team folder is its own copy unless compile put it there: an emitted unit, or a group holding nothing but emitted units. */
function isTeamOwned(dir: string): boolean {
  if (!existsSync(dir) || isEmittedAttachmentDir(dir)) return false;
  if (existsSync(join(dir, "SKILL.md"))) return true;
  return readdirSync(dir, { withFileTypes: true }).some((entry) =>
    !isSkippedAttachmentPath(entry.name) && !(entry.isDirectory() && isEmittedAttachmentDir(join(dir, entry.name))));
}

export function planBaseAttachments(input: { packDir: string; packName: string; verbSides: Record<string, Side> }): BaseAttachmentPlan {
  const { packDir, packName, verbSides } = input;
  const own = readJsoncObject(join(packDir, "pack", "skills.jsonc"));
  const ext = own?.extends;
  const attachmentsDir = join(packDir, "attachments");
  const onDiskEmitted = listEmittedUnits(attachmentsDir);

  if (ext === undefined) {
    return { base: null, emits: [], kept: [], stale: onDiskEmitted.map((name) => ({ name, why: "no-base" as const })), retired: [], errors: [] };
  }
  const base = resolveBase(packDir, packName, ext);
  if (typeof base === "string") return { base: null, emits: [], kept: [], stale: [], retired: [], errors: [base] };

  const errors: string[] = [];
  const kept: string[] = [];
  const retired: string[] = [];
  const records: { name: string; srcDir: string; files: string[] }[] = [];
  const leafOf = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);
  const boardFills = boardOnlyBaseFills(base.name, mergedBindings(readJsoncObject(join(base.dir, "pack", "skills.jsonc")), own));
  const units = baseUnits(base.name, join(base.dir, "attachments"), errors).filter((u) => !isFill(u.srcDir) || boardFills.has(leafOf(u.rel)));
  const teamNames = teamAttachmentNames(attachmentsDir);
  for (const { rel: name, srcDir } of units) {
    const label = `${base.name} attachment ${name}`;
    const [group, leaf] = name.split("/") as [string, string | undefined];
    const groupDir = join(attachmentsDir, group);
    const sharing = units.map((u) => u.rel).filter((rel) => rel !== name && leafOf(rel) === leafOf(name));
    const teamClash = (teamNames.get(leafOf(name)) ?? []).find((rel) => rel !== name);
    if (Object.hasOwn(verbSides, group)) {
      errors.push(`${label} has the same name as the ${packName} verb ${group}; rename one of them`);
    } else if (leaf !== undefined && Object.hasOwn(verbSides, leaf)) {
      errors.push(`${label} has the same name as the ${packName} verb ${leaf}; rename one of them`);
    } else if (teamClash !== undefined) {
      errors.push(`${label} has the same name as the ${packName} attachment attachments/${teamClash}; rename one of them`);
    } else if (sharing.length > 0) {
      const partner = sharing.sort().find((rel) => rel > name);
      if (partner !== undefined) errors.push(`${base.name} attachments ${name} and ${partner} share the name ${leafOf(name)}; rename one of them`);
    } else if (isHandAuthored(join(packDir, "skills", name))) {
      errors.push(`${label} has the same name as the ${packName} skill skills/${name}; rename one of them`);
    } else if (leaf !== undefined && existsSync(join(groupDir, "SKILL.md")) && !isEmittedAttachmentDir(groupDir)) {
      errors.push(hasCompiledHeader(groupDir)
        ? `${label} would land inside attachments/${group}, which an earlier compile wrote; delete that folder and compile again`
        : `${label} would land inside the ${packName} attachment attachments/${group}; rename one of them`);
    } else if (existsSync(join(srcDir, PROVENANCE_FILE))) {
      errors.push(`${label} carries ${PROVENANCE_FILE}, a name compile keeps for itself`);
    } else if (isTeamOwned(join(attachmentsDir, name)) && !hasCompiledHeader(join(attachmentsDir, name))) {
      kept.push(name);
    } else {
      const { files, symlinks } = walkAttachmentFiles(srcDir);
      if (symlinks.length > 0) errors.push(...symlinks.map((rel) => `${label} has a symlink at ${rel}; compile copies regular files only`));
      else records.push({ name, srcDir, files });
      if (symlinks.length === 0 && hasCompiledHeader(join(attachmentsDir, name))) retired.push(name);
    }
  }

  const recorded = new Set(records.map((r) => r.name));
  const stale = onDiskEmitted.filter((name) => !recorded.has(name)).map((name) => ({ name, why: "dropped" as const }));
  const planned = new Map<string, Set<string>>([
    ...records.map((r): [string, Set<string>] => [r.name, new Set([...r.files, PROVENANCE_FILE])]),
    ...stale.map((s): [string, Set<string>] => [s.name, new Set()]),
  ]);

  const emits: EmittedAttachment[] = [];
  for (const { name, srcDir, files } of records) {
    const out: CompiledFile[] = [];
    for (const file of files) {
      const abs = join(srcDir, file);
      if (!file.endsWith(".md")) {
        out.push({ path: file, copyFrom: abs });
        continue;
      }
      try {
        const content = substituteAttachmentPlaceholders(readFileSync(abs, "utf8"), {
          packName,
          fileRel: `attachments/${name}/${file}`,
          verbSides,
          packRoot: packDir,
          plannedAttachments: planned,
          where: `${base.name}:attachments/${name}/${file}`,
        });
        out.push({ path: file, content });
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    out.push({ path: PROVENANCE_FILE, content: JSON.stringify({ base: base.name, version: base.version, files }, null, 2) + "\n" });
    emits.push({ name, files: out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) });
  }

  if (errors.length > 0) return { base, emits: [], kept, stale: [], retired: [], errors };
  return { base, emits, kept, stale, retired, errors };
}

export function plannedAttachmentsOf(plan: BaseAttachmentPlan): PlannedAttachments {
  return new Map<string, ReadonlySet<string>>([
    ...plan.emits.map((e): [string, ReadonlySet<string>] => [e.name, new Set(e.files.map((f) => f.path))]),
    ...plan.stale.map((s): [string, ReadonlySet<string>] => [s.name, new Set<string>()]),
  ]);
}
