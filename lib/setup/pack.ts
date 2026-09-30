/**
 * `rt setup pack` -- installs a team pack's plugins, materializes skills, then
 * checks that the pack's declared work-type pipeline is usable: every stage it
 * names must have no empty slot in the pack's own bindings file.
 */

import { getKnownRepos, type KnownRepo } from "../repo-index.ts";
import { stripJsonc } from "../jsonc.ts";
import type { ApplyContext } from "./apply.ts";
import { installPlugins } from "./steps/plugins.ts";
import { materializeSkills } from "./skills-materialize.ts";

const DEFAULT_WORK_TYPE = "feature";

export const NO_MANIFEST_DETAIL = "no per-repo manifest yet";

/** No repo is registered yet, so the pipeline check has nothing to read: an expected first-run state, not a failure. */
const AWAITING_CLONE_NOTE = "waiting on a repo clone to check the pipeline";

interface PackManifest {
  pipelines?: Record<string, string[] | undefined>;
  bindings?: Record<string, Record<string, unknown> | undefined>;
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

function stageUnresolved(stage: string, bindings: PackManifest["bindings"]): boolean {
  const entry = bindings?.[`mattstack:${stage}`] ?? bindings?.[stage];
  if (!entry) return false;
  return Object.values(entry).some((v) => typeof v !== "string" || v.trim().length === 0);
}

export async function setupPackFlow(ctx: ApplyContext): Promise<{ ok: boolean; stage?: string; detail: string }> {
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
  const written = materialized.skipped
    ? null
    : materialized.repos.flatMap((r) => r.packs ?? []).find((pk) => pk.ok && pk.pack === packName);
  const text = written && written.ok ? ctx.p.readFile(written.path) : null;
  if (text === null) {
    const nothing = materialized.skipped ? undefined : materialized.repos.find((r) => r.noManifest && r.path === repo.worktrees[0]?.path);
    if (nothing?.noRemote) return { ok: true, detail: `${repo.repoName} has no git remote; no pipeline to check` };
    if (nothing) return { ok: true, detail: `no team pack declares ${repo.repoName}; no pipeline to check` };
    return { ok: false, detail: NO_MANIFEST_DETAIL };
  }

  const workType = ctx.reqs[0]?.workType ?? DEFAULT_WORK_TYPE;
  const manifest = parseManifest(text);
  const stages = manifest.pipelines?.[workType] ?? [];
  for (const stage of stages) {
    if (stageUnresolved(stage, manifest.bindings)) return { ok: false, stage, detail: `stage "${stage}" is unresolved` };
  }
  return { ok: true, detail: `${stages.length} stage(s) resolved for "${workType}"` };
}
