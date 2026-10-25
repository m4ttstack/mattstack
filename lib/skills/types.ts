import type { BlockDiagnostic } from "./blocks/diagnostics.ts";
import type { BlockTree } from "./blocks/types.ts";
import type { Target } from "./pointers.ts";
import type { TeamContext } from "./team-params.ts";

export type Side = "skills" | "attachments";

export type StepSource = {
  name: string; // engine name, e.g. "watch-ci"
  plugin: string; // e.g. "mattstack"
  version: string; // plugin version string
  dir: string; // absolute source dir
  srcPath: string; // the root's index.block.md path, relative to its PLUGIN root
  bodyStartLine: number; // 1-indexed line in that file where the body begins
  allowedTools: string[]; // raw entries from frontmatter allowed-tools
  stepFiles: string[]; // non-block files relative to dir (scripts/, references/, ...), vendored path-preserving
  stageMeta: { stage: string; consumes: string[]; produces: string[] } | null;
  description: string;
  tree: BlockTree;
};

export type AttachmentSource = {
  binding: string; // e.g. "acme:watch-ci-domain"
  plugin: string;
  version: string;
  dir: string;
  srcPath: string; // source SKILL.md path, relative to its PLUGIN root
  bodyStartLine: number; // 1-indexed line in that file where the body begins
  bodyIndent?: number; // spaces trimmed off the body's first line, which a col on that line adds back
  body: string;
  provides: string; // frontmatter metadata.provides, e.g. "watch-ci-domain@1"
  allowedTools: string[];
  extraFiles: string[]; // non-SKILL.md files relative to dir, vendored under the prop's parts dir
  registered: boolean; // true = top-level skill under skills/, referenced not inlined; false = internal attachment under attachments/, inlined
  file: string | null; // "fast.md" for a "plugin:skill/fast" value, relative to dir; null = the SKILL.md body
  /** The first team marker in the file's frontmatter, kept because the body handed to compile has none of it. */
  frontmatterTeamMarker?: { raw: string; line: number };
  /** Set for an include whose folder holds `index.block.md`; `body` is "" then. */
  tree?: BlockTree;
};

/** `pipeline` is the pipeline a work verb runs, or the one a stage copy compiles for. */
export type VerbDef = { name: string; engine: string; description: string; pipeline?: string };

export type CompiledFile = { path: string; content: string } | { path: string; copyFrom: string };

/** `pointers` is set when the compile keyed its files: the unit's own keys and the leaf of every unit it reads by path. */
export type CompileResult = {
  files: CompiledFile[];
  warnings: string[];
  errors: string[];
  diagnostics: BlockDiagnostic[];
  pointers?: { keys: Record<string, Target>; reads: string[] };
};

/** `name` is the compiled target, a stage copy's own name for a copy; `engine` is the stage it compiles. */
export type StageEntry = {
  name: string; engine: string; stage: string; dir: string; consumes: string[]; produces: string[];
};

/** Where a planned unit is copied from: its folder in the org base pack, which `base` names. */
export type PlannedSource = { dir: string; base: string };

/** `sources` names each unit's base folder, so a built skill can copy one before compile has written it. */
export type PlannedAttachments = ReadonlyMap<string, ReadonlySet<string>> & { readonly sources?: ReadonlyMap<string, PlannedSource> };

export type PlaceholderContext = {
  partsPrefix: string;
  includes: Record<string, AttachmentSource>;
  pipelines: Record<string, StageEntry[]>;
  repoKey: string;
  mattstackSha: string;
  mattstackDirty: 0 | 1;
  packSha: string;
  stageDir: string | null;
  stageMeta: StepSource["stageMeta"];
  compiledFrom: string;
  verbSides: Record<string, Side>;
  side: Side;
  packRoot: string | null;
  plannedAttachments?: PlannedAttachments;
  /** The pipeline a work verb that renders `{{pipeline.table}}` runs; null for every other target. */
  pipeline: string | null;
  /** The team pack being compiled; absent or null means none is in play, so any `{{team.` marker is an error. */
  team?: TeamContext | null;
};
