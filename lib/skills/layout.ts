import { join } from "path";
import { DEFAULT_HARNESS } from "./harness-target.ts";
import { loadStepSource, parseStageQualifiedName, type PluginRoots } from "./sources.ts";
import type { Side, StageEntry, StepSource, VerbDef } from "./types.ts";

type Resolved = {
  packDir: string;
  pipelines: Record<string, string[]>;
  pluginRoots: PluginRoots;
};

type CompileTarget = { verb: VerbDef; isPublic: boolean };

/** The `${CLAUDE_SKILL_DIR}`-relative directory a pack-side reader reaches a compiled target at: the target's own side, hopped to from the invoking public skill's dir. */
export function hostDir(name: string, side: Side): string {
  return `\${CLAUDE_SKILL_DIR}/../../${side}/${name}`;
}

/**
 * Builds each work type's ordered StageEntry[] from its manifest pipeline
 * list: one entry per qualified name, carrying the stage's dir, consumes,
 * and produces. Stage names are validated upstream by parseStageQualifiedName
 * (shared with stageRoster) before they ever reach outDirFor's rmSync; a dir
 * here is always a sibling path relative to the orchestrator's own
 * ${CLAUDE_SKILL_DIR}, never packDir-relative, and it names the side the
 * stage is emitted to: skills/ when the surface lists it public, else
 * attachments/.
 */
export function buildStageEntries(
  input: Pick<Resolved, "pipelines" | "pluginRoots"> & { publicSet: Set<string> | null },
): Record<string, StageEntry[]> {
  const out: Record<string, StageEntry[]> = {};
  for (const [type, names] of Object.entries(input.pipelines)) {
    out[type] = names.map((qualified) => {
      let name: string;
      try {
        name = parseStageQualifiedName(qualified, `pipeline "${type}"`);
      } catch (err) {
        throw new Error((err as Error).message);
      }
      let step: StepSource;
      try {
        step = loadStepSource(name, input.pluginRoots);
      } catch (err) {
        throw new Error(`pipeline "${type}": "${name}": ${(err as Error).message}`);
      }
      if (!step.stageMeta) {
        throw new Error(`pipeline "${type}": "${name}" has no metadata.stage; it cannot appear in a pipeline`);
      }
      return {
        name,
        stage: step.stageMeta.stage,
        dir: hostDir(name, input.publicSet?.has(name) ? "skills" : "attachments"),
        consumes: step.stageMeta.consumes,
        produces: step.stageMeta.produces,
      };
    });
  }
  return out;
}

/**
 * Where a harness's compiled skills and attachments land. Claude's are the
 * pack's own skills/ and attachments/, which is what Claude loads; any other
 * harness gets its own root, so one target's output never replaces another's.
 */
export function targetRoot(packDir: string, harness: string = DEFAULT_HARNESS): string {
  return harness === DEFAULT_HARNESS ? packDir : join(packDir, "targets", harness);
}

/** The `../`-hops from a target root back to the pack root, for a compiled path that names a pack source file. */
export function packFromTargetRoot(harness: string = DEFAULT_HARNESS): string {
  return harness === DEFAULT_HARNESS ? "" : "../../";
}

/** outDirFor/otherSideDir also name the stale side of a name that flips public/internal, so compile can clean it up. */
export function outDirFor(packDir: string, name: string, isPublic: boolean, harness: string = DEFAULT_HARNESS): string {
  return join(targetRoot(packDir, harness), isPublic ? "skills" : "attachments", name);
}

export function otherSideDir(packDir: string, name: string, isPublic: boolean, harness: string = DEFAULT_HARNESS): string {
  return join(targetRoot(packDir, harness), isPublic ? "attachments" : "skills", name);
}

/**
 * Where this run's targets land, for the sibling-reference lint. Absolute
 * (outDirFor), where a StageEntry's `dir` is the orchestrator-relative token
 * form the compiled body carries.
 */
export function targetOutDirs(resolved: Resolved, targets: CompileTarget[], harness: string = DEFAULT_HARNESS): string[] {
  return targets.map((t) => outDirFor(resolved.packDir, t.verb.name, t.isPublic, harness));
}
