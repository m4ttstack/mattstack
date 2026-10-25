/**
 * `rt setup pack` -- installs a team pack's plugins, materializes skills, then
 * reads the pack's declared work-type pipeline from its bindings file.
 */

import { getKnownRepos, type KnownRepo } from "../repo-index.ts";
import { stripJsonc } from "../jsonc.ts";
import { normalizePipelines } from "../skills/pipelines.ts";
import type { ApplyContext } from "./apply.ts";
import { installPlugins } from "./steps/plugins.ts";
import { materializeSkills } from "./skills-materialize.ts";

const DEFAULT_WORK_TYPE = "feature";

export const NO_MANIFEST_DETAIL = "This pack has no bindings file yet. Run rt skills materialize";

/** No repo is registered yet, so the pipeline check has nothing to read: an expected first-run state, not a failure. */
const AWAITING_CLONE_NOTE = "the pipeline check waits for a repo clone";

interface PackManifest {
  pipelines?: unknown;
}

function firstRegisteredRepo(): KnownRepo | null {
  return getKnownRepos().find((r) => r.registered !== false) ?? null;
}

/** A manifest that fails to parse reads as empty, the same "nothing declared yet" shape as a missing pipeline, never a crash. */
function parseManifest(text: string): PackManifest {
  try {
    const parsed: unknown = JSON.parse(stripJsonc(text));
    return typeof parsed === "object" && parsed !== null ? (parsed as PackManifest) : {};
  } catch {
    return {};
  }
}

export async function setupPackFlow(ctx: ApplyContext): Promise<{ ok: boolean; detail: string }> {
  // A malformed requirements file is reported here rather than falling back to
  // DEFAULT_WORK_TYPE, which would mask it behind an unrelated stage failure.
  const packError = ctx.reqs[0]?.error;
  if (packError) return { ok: false, detail: packError };

  const pluginsOutcome = await installPlugins(ctx);
  if (pluginsOutcome.state === "failed") return { ok: false, detail: pluginsOutcome.detail };

  const materialized = await materializeSkills(ctx.p, {});
  if (!materialized.skipped) {
    for (const r of materialized.repos) {
      if (!r.ok) ctx.log("plugins.install", `materialize ${r.name}: ${r.detail}`);
    }
  }

  const repo = firstRegisteredRepo();
  if (!repo) {
    const plugins = pluginsOutcome.state === "done" ? "plugins installed" : pluginsOutcome.detail;
    return { ok: true, detail: `${plugins}; ${AWAITING_CLONE_NOTE}` };
  }

  const packName = ctx.reqs[0]?.pack;
  const outcomes = materialized.skipped ? [] : materialized.repos.flatMap((r) => r.packs ?? []).filter((pk) => pk.pack === packName);
  const written = outcomes.find((pk) => pk.ok);
  const text = written && written.ok ? ctx.p.readFile(written.path) : null;
  if (text === null) {
    const failed = outcomes.find((pk) => !pk.ok);
    if (failed && !failed.ok) return { ok: false, detail: failed.detail };
    const nothing = materialized.skipped ? undefined : materialized.repos.find((r) => r.noManifest && r.path === repo.worktrees[0]?.path);
    if (nothing?.noRemote) return { ok: true, detail: `${repo.repoName} has no git remote, so there is no pipeline to check` };
    if (nothing) return { ok: true, detail: `No team pack covers ${repo.repoName}, so there is no pipeline to check` };
    return { ok: false, detail: NO_MANIFEST_DETAIL };
  }

  const workType = ctx.reqs[0]?.workType ?? DEFAULT_WORK_TYPE;
  const manifest = parseManifest(text);
  const pipelines = normalizePipelines(manifest.pipelines);
  const stages = pipelines.stages[workType] ?? [];
  // No per-stage binding check: a "" is a clear, not a gap, and rt skills compile and check refuse a required prop nothing binds.
  return { ok: true, detail: `${stages.length} stage${stages.length === 1 ? "" : "s"} in the ${workType} pipeline` };
}
