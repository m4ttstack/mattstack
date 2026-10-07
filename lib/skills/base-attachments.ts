import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { TEAM_NAME_RE } from "../settings/stores.ts";
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
  errors: string[];
};

/** A hand-authored data file may also be called compiled.json, so only compile's own shape marks a folder as output. */
export function isEmittedAttachmentText(text: string | null): boolean {
  if (text === null) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return !!parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as { base?: unknown }).base === "string";
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
  return rel.split("/").some((segment) => segment.startsWith(".") || segment === "__pycache__") || rel.endsWith(".pyc");
}

export function listAttachmentFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (sub: string) => {
    for (const entry of readdirSync(sub ? join(dir, sub) : dir, { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (isSkippedAttachmentPath(rel)) continue;
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  walk("");
  return out.sort();
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

export function planBaseAttachments(input: { packDir: string; packName: string; verbSides: Record<string, Side> }): BaseAttachmentPlan {
  const { packDir, packName, verbSides } = input;
  const ext = readJsoncObject(join(packDir, "pack", "skills.jsonc"))?.extends;
  const attachmentsDir = join(packDir, "attachments");
  const onDiskEmitted = listDirs(attachmentsDir).filter((name) => isEmittedAttachmentDir(join(attachmentsDir, name)));

  if (ext === undefined) {
    return { base: null, emits: [], kept: [], stale: onDiskEmitted.map((name) => ({ name, why: "no-base" as const })), errors: [] };
  }
  const base = resolveBase(packDir, packName, ext);
  if (typeof base === "string") return { base: null, emits: [], kept: [], stale: [], errors: [base] };

  const errors: string[] = [];
  const kept: string[] = [];
  const records: { name: string; srcDir: string; files: string[] }[] = [];
  for (const name of listDirs(join(base.dir, "attachments"))) {
    if (name.startsWith(".")) continue;
    const srcDir = join(base.dir, "attachments", name);
    if (isFill(srcDir)) continue;
    const label = `${base.name} attachment ${name}`;
    if (Object.hasOwn(verbSides, name)) {
      errors.push(`${label} has the same name as the ${packName} verb ${name}; rename one of them`);
    } else if (isHandAuthored(join(packDir, "skills", name))) {
      errors.push(`${label} has the same name as the ${packName} skill skills/${name}; rename one of them`);
    } else if (existsSync(join(srcDir, PROVENANCE_FILE))) {
      errors.push(`${label} carries ${PROVENANCE_FILE}, a name compile keeps for itself`);
    } else if (existsSync(join(attachmentsDir, name)) && !isEmittedAttachmentDir(join(attachmentsDir, name))) {
      kept.push(name);
    } else {
      records.push({ name, srcDir, files: listAttachmentFiles(srcDir) });
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

  if (errors.length > 0) return { base, emits: [], kept, stale: [], errors };
  return { base, emits, kept, stale, errors };
}

export function plannedAttachmentsOf(plan: BaseAttachmentPlan): PlannedAttachments {
  return new Map<string, ReadonlySet<string>>([
    ...plan.emits.map((e): [string, ReadonlySet<string>] => [e.name, new Set(e.files.map((f) => f.path))]),
    ...plan.stale.map((s): [string, ReadonlySet<string>] => [s.name, new Set<string>()]),
  ]);
}
