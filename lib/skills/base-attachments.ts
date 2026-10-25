import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { TEAM_NAME_RE } from "../settings/stores.ts";
import { boardOnlyBaseFills, mergedBindings } from "./board-fills.ts";
import { hasCompiledHeader, unresolvedRelativePaths } from "./compile.ts";
import { handPathDiagnostics } from "./hand-paths.ts";
import { FRONTMATTER_RE } from "./frontmatter-re.ts";
import { hostDir } from "./layout.ts";
import { assertNoTeamMarkerInRawFile, packPathResolves, readTextUnlessBinary, referencePath, sourcePackPath, substituteAttachmentPlaceholders, type PackTarget } from "./placeholders.ts";
import { referenceCopies } from "./references.ts";
import type { TeamContext } from "./team-params.ts";
import { unitId, type Target } from "./pointers.ts";
import { packPluginIdentity } from "./provenance.ts";
import { listDirs, orgOfPackDir, readJsoncObject, stripFrontmatter } from "./sources.ts";
import { keyFiles, leafOf, MAP_FILE, unitTableOf } from "./unit-maps.ts";
import type { AttachmentSource, CompiledFile, PlaceholderContext, PlannedAttachments, PlannedSource, Side } from "./types.ts";

export const PROVENANCE_FILE = MAP_FILE;

export type BaseRef = { name: string; dir: string; version: string | null };
/** `pointers` is set when the copy's files were keyed: its own keys and the leaf of every unit it reads by path. */
export type EmittedAttachment = { name: string; files: CompiledFile[]; warnings: string[]; source?: PlannedSource; pointers?: { keys: Record<string, Target>; reads: string[] } };
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

/** `loadInclude` loads an include a file vendored into a copy's references/ names, as a built skill's copies load theirs. */
export function planBaseAttachments(input: {
  packDir: string;
  packName: string;
  verbSides: Record<string, Side>;
  team: TeamContext | null;
  loadInclude?: (name: string) => AttachmentSource;
  /** The team pack's plugin identity, which stamps each copy's id; without a version, nothing is keyed. */
  identity?: { name: string; version: string } | null;
}): BaseAttachmentPlan {
  const { packDir, packName, verbSides, team, loadInclude, identity } = input;
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
  const bindings = mergedBindings(readJsoncObject(join(base.dir, "pack", "skills.jsonc")), own);
  const boardFills = boardOnlyBaseFills(base.name, bindings);
  const allUnits = baseUnits(base.name, join(base.dir, "attachments"), errors);
  // The board resolves <plugin>:<name> at attachments/<name> only, so a fill it cannot reach is refused here rather than in the pane.
  for (const name of boardFills) {
    if (allUnits.some((u) => u.rel === name) || isTeamOwned(join(attachmentsDir, name))) continue;
    const grouped = allUnits.find((u) => leafOf(u.rel) === name);
    if (grouped) {
      errors.push(`${base.name} keeps its board fill ${name} at attachments/${grouped.rel}; the board only finds attachments/${name}`);
      continue;
    }
    const engineRef = Object.entries(bindings).find(([ref, slots]) => ref.startsWith("board:") && Object.values(slots).includes(`${base.name}:${name}`))?.[0];
    errors.push(`${base.name} binds ${engineRef} to ${base.name}:${name}, but has no attachments/${name}`);
  }
  const units = allUnits.filter((u) => !isFill(u.srcDir) || boardFills.has(leafOf(u.rel)));
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
  const planned = Object.assign(new Map<string, Set<string>>([
    ...records.map((r): [string, Set<string>] => [r.name, new Set([...r.files, PROVENANCE_FILE])]),
    ...stale.map((s): [string, Set<string>] => [s.name, new Set()]),
  ]), { sources: new Map(records.map((r): [string, PlannedSource] => [r.name, { dir: r.srcDir, base: base.name }])) });

  const emits: EmittedAttachment[] = [];
  const pointers: Pointer[] = [];
  const unitTable = unitTableOf(verbSides, records.map((r) => r.name));
  const verbDirs = Object.entries(verbSides).map(([verb, side]) => join(packDir, side, verb));
  const pathView = { verbSides, packRoot: packDir, plannedAttachments: planned };
  const fixView = {
    verbs: new Set(Object.keys(verbSides)),
    packSource: (arg: string) => packPathResolves(pathView, arg),
    teamValue: team ? (key: string) => (Object.hasOwn(team.values.params, key) ? team.values.params[key] : undefined) : undefined,
  };
  for (const { name, srcDir, files } of records) {
    const out: CompiledFile[] = [];
    const warnings: string[] = [];
    const vendored: PackTarget[] = [];
    const reads: string[] = [];
    const copyDir = hostDir(name, "attachments");
    const packPath = (where: string) => (target: PackTarget, raw: string): string => {
      pointers.push({ where, raw, unit: name, target });
      if (target.planned) {
        reads.push(leafOf(target.unit));
        return sourcePackPath(target);
      }
      vendored.push(target);
      return referencePath({ stageDir: copyDir }, target);
    };
    for (const file of files) {
      const abs = join(srcDir, file);
      if (!file.endsWith(".md")) {
        try {
          const text = readTextUnlessBinary(abs);
          if (text !== null) assertNoTeamMarkerInRawFile(text, `${base.name}:attachments/${name}/${file}`);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
        out.push({ path: file, copyFrom: abs });
        continue;
      }
      const where = `${base.name}:attachments/${name}/${file}`;
      const raw = readFileSync(abs, "utf8");
      // Read before team markers resolve, so a path built from a team value is still the hand-typed text the author wrote.
      const head = raw.match(FRONTMATTER_RE)?.[0] ?? "";
      const handPaths = handPathDiagnostics(raw.slice(head.length), file, {
        ...fixView,
        startLine: (head.match(/\n/g)?.length ?? 0) + 1,
        depth: file.split("/").length - 1,
      });
      if (handPaths.length > 0) {
        errors.push(...handPaths.map((d) => `${where}: ${d.message} (line ${d.line})`));
        continue;
      }
      try {
        const content = substituteAttachmentPlaceholders(raw, {
          packName,
          fileRel: `attachments/${name}/${file}`,
          verbSides,
          packRoot: packDir,
          plannedAttachments: planned,
          where,
          team,
          packPath: packPath(where),
          verbPaths: reads,
        });
        out.push({ path: file, content });
        const layout = { packRoot: packDir, compiledDir: dirname(join(attachmentsDir, name, file)) };
        for (const path of unresolvedRelativePaths(content, layout, verbDirs, planned)) {
          warnings.push(`${file} references ${path} which is not an emitted file`);
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (vendored.length > 0) {
      const v = vendorTeamSources(vendored, out, { name, label: `${base.name} attachment ${name}`, copyDir, packDir, packName, verbSides, planned, team, loadInclude });
      errors.push(...v.errors);
      warnings.push(...v.warnings);
      reads.push(...v.verbPaths);
    }
    const keyed = identity?.version ? keyFiles(out, { id: unitId(identity.name, identity.version, leafOf(name)), dir: `attachments/${name}`, units: unitTable }) : null;
    const emitted = keyed?.files ?? out;
    emitted.push({ path: PROVENANCE_FILE, content: JSON.stringify({ base: base.name, version: base.version, files }, null, 2) + "\n" });
    emits.push({
      name,
      files: emitted.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      warnings,
      source: { dir: srcDir, base: base.name },
      ...(keyed ? { pointers: { keys: keyed.keys, reads: [...new Set(reads)] } } : {}),
    });
  }

  errors.push(...unrenderedPointers(pointers, emits));
  if (errors.length > 0) return { base, emits: [], kept, stale: [], retired: [], errors };
  return { base, emits, kept, stale, retired, errors };
}

/** `unit` is the base copy the pointer sits in; `target` is what its `{{pack.path}}` named. */
type Pointer = { where: string; raw: string; unit: string; target: PackTarget };

type VendorInput = {
  name: string;
  label: string;
  copyDir: string;
  packDir: string;
  packName: string;
  verbSides: Record<string, Side>;
  planned: PlannedAttachments;
  team: TeamContext | null;
  loadInclude?: (name: string) => AttachmentSource;
};

/** The team's source ships as written, so a base copy reads its own rendered copy of each unit it names, as a built skill does. */
function vendorTeamSources(targets: PackTarget[], out: CompiledFile[], v: VendorInput): { errors: string[]; warnings: string[]; verbPaths: string[] } {
  const ctx: PlaceholderContext = {
    partsPrefix: `${v.copyDir}/parts`, includes: {}, pipelines: {}, repoKey: "", mattstackSha: "", mattstackDirty: 0, packSha: "",
    stageDir: v.copyDir, stageMeta: null, compiledFrom: "", verbSides: v.verbSides, side: "attachments", packRoot: v.packDir,
    plannedAttachments: v.planned, pipeline: null, team: v.team,
  };
  let copies;
  try {
    copies = referenceCopies(targets, ctx, { skillRel: `attachments/${v.name}`, packName: v.packName, loadInclude: v.loadInclude });
  } catch (err) {
    return { errors: [err instanceof Error ? err.message : String(err)], warnings: [], verbPaths: [] };
  }
  const errors = copies.diagnostics.map((d) => `${d.file}: ${d.message} (line ${d.line})`);
  const own = new Set(out.map((f) => f.path));
  const includeFiles = Object.entries(copies.includes).flatMap(([name, inc]) =>
    inc.extraFiles.map((entry): CompiledFile => ({ path: `parts/include-${name}/${entry}`, copyFrom: `${inc.dir}/${entry}` })));
  for (const file of [...copies.files.map((c) => c.file), ...includeFiles]) {
    const what = file.path.startsWith("references/") ? `its copy of ${file.path.slice("references/".length)}` : "an include's file";
    if (own.has(file.path)) errors.push(`${v.label} has its own ${file.path}, where ${what} would land; rename one of them`);
    else {
      own.add(file.path);
      out.push(file);
    }
  }
  return { errors, warnings: copies.warnings, verbPaths: copies.verbPaths };
}

/** A reader follows a base copy's pointer to the file it names, so that file must carry no placeholder left unrendered. */
function unrenderedPointers(pointers: Pointer[], emits: EmittedAttachment[]): string[] {
  const errors: string[] = [];
  for (const p of pointers) {
    const { unit, path } = p.target.planned
      ? { unit: p.target.unit, path: p.target.unit === p.target.attachment ? p.target.file : p.target.file.slice(p.target.unit.length - p.target.attachment.length) }
      : { unit: p.unit, path: `references/${p.target.attachment}/${p.target.file}` };
    const file = emits.find((e) => e.name === unit)?.files.find((f) => f.path === path);
    if (!file || !("content" in file) || !path.endsWith(".md")) continue;
    const line = file.content.split("\n").findIndex((l) => l.includes("{{"));
    if (line >= 0) errors.push(`${p.where}: ${p.raw} points at a copy that still holds {{ at its line ${line + 1}, which a reader would meet unrendered`);
  }
  return errors;
}

export function plannedAttachmentsOf(plan: BaseAttachmentPlan): PlannedAttachments {
  const planned = new Map<string, ReadonlySet<string>>([
    ...plan.emits.map((e): [string, ReadonlySet<string>] => [e.name, new Set(e.files.map((f) => f.path))]),
    ...plan.stale.map((s): [string, ReadonlySet<string>] => [s.name, new Set<string>()]),
  ]);
  const sources = new Map(plan.emits.flatMap((e): [string, PlannedSource][] => (e.source ? [[e.name, e.source]] : [])));
  return Object.assign(planned, { sources });
}
