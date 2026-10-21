import type { TeamContext } from "./team-params.ts";

export type Side = "skills" | "attachments";

export type SlotSpec = { contract: string; required?: boolean };

export type StepSource = {
  name: string; // engine name, e.g. "watch-ci"
  plugin: string; // e.g. "mattstack"
  version: string; // plugin version string
  dir: string; // absolute source dir
  srcPath: string; // source SKILL.md path, relative to its PLUGIN root
  bodyStartLine: number; // 1-indexed line in that file where the body begins
  body: string; // frontmatter-stripped markdown
  slots: Record<string, SlotSpec>;
  allowedTools: string[]; // raw entries from frontmatter allowed-tools
  stepFiles: string[]; // non-SKILL.md files relative to dir (scripts/, references/, ...), vendored path-preserving
  stageMeta: { stage: string; consumes: string[]; produces: string[] } | null;
  description: string;
};

export type AttachmentSource = {
  binding: string; // e.g. "acme:watch-ci-domain"
  plugin: string;
  version: string;
  dir: string;
  srcPath: string; // source SKILL.md path, relative to its PLUGIN root
  bodyStartLine: number; // 1-indexed line in that file where the body begins
  body: string;
  provides: string; // frontmatter metadata.provides, e.g. "watch-ci-domain@1"
  allowedTools: string[];
  extraFiles: string[]; // non-SKILL.md files relative to dir, vendored under parts/<slot>/
  registered: boolean; // true = top-level skill under skills/, referenced not inlined; false = internal attachment under attachments/, inlined
};

/** `pipeline` is the pipeline a work verb runs, or the one a stage copy compiles for. */
export type VerbDef = { name: string; engine: string; description: string; pipeline?: string };

export type CompiledFile = { path: string; content: string } | { path: string; copyFrom: string };

export type CompileResult = { files: CompiledFile[]; warnings: string[]; errors: string[] };

/** `name` is the compiled target, a stage copy's own name for a copy; `engine` is the stage it compiles. */
export type StageEntry = {
  name: string; engine: string; stage: string; dir: string; consumes: string[]; produces: string[];
};

export type PlannedAttachments = ReadonlyMap<string, ReadonlySet<string>>;

export type PlaceholderContext = {
  fills: Record<string, AttachmentSource | null>;
  slotMode: Record<string, "inline" | "reference">;
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
