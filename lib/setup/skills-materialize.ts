/**
 * Materializes every registered repo's per-pack bindings files through
 * lib/skills/materialize.ts. Idempotent and re-callable, and never throws
 * for the ordinary fresh-machine case: the apply engine's skills.materialize
 * step runs before plugins.install, so the mattstack plugin (the defaults
 * layer) is routinely absent the first time. That case comes back as
 * `{skipped: true, reason}`; callers rerun once the plugin is on disk.
 */

import { basename, join, resolve } from "path";
import { getKnownRepos, type KnownRepo } from "../repo-index.ts";
import { repoLabel } from "../repo-label.ts";
import { tryResolveRepoArg } from "../repo-arg.ts";
import { parseRemote } from "../skills/init.ts";
import { ENGINE_PACK_REF, findInstalledPluginDir } from "../skills/installed-plugins.ts";
import { materializeRepo, type MaterializeRepoOutcome, type PackOutcome } from "../skills/materialize.ts";
import { UserActionableError } from "./errors.ts";
import type { Probes } from "./probes.ts";

export const ENGINE_PACK_MISSING_CODE = "engine-pack-missing";

const GIT_TIMEOUT_MS = 10_000;

/** RT_ENGINE_PACK_DIR (a checkout's plugins/mattstack, for development) wins when it exists; else the installed mattstack plugin; null before plugins.install has run. */
export function findEnginePackDir(p: Pick<Probes, "readDir" | "exists" | "home" | "env">): string | null {
  const override = p.env.RT_ENGINE_PACK_DIR;
  if (override && p.exists(override)) return override;
  return findInstalledPluginDir(p, p.home, ENGINE_PACK_REF);
}

export interface MaterializeRepoResult {
  name: string;
  path: string;
  ok: boolean;
  /** Nothing to materialize for this repo (no remote, or no team declares it): not a merge error. */
  noManifest?: true;
  /** The no-manifest case is the repo having no git remote, rather than no team pack declaring it. */
  noRemote?: true;
  detail: string;
  packs?: PackOutcome[];
  migrated?: string | null;
  /** Bindings files this run renamed to `.stale` (their new paths): no pack claims them any more. */
  pruned?: string[];
}

export type MaterializeSkillsResult =
  | { skipped: true; reason: string; repos: [] }
  | { skipped: false; repos: MaterializeRepoResult[] };

/** One wording for every step that reports a materialize run: a repo nothing declares is its own count, never a failure. */
export function materializeTally(repos: MaterializeRepoResult[]): string {
  const written = repos.flatMap((r) => r.packs ?? []).filter((pk) => pk.ok).length;
  const undeclared = repos.filter((r) => r.noManifest).length;
  const pruned = repos.reduce((n, r) => n + (r.pruned?.length ?? 0), 0);
  const failures = repos.flatMap((r) => {
    if (r.packs) return r.packs.flatMap((pk) => (pk.ok ? [] : [`${pk.pack} (${r.name}): ${pk.detail}`]));
    return r.ok || r.noManifest ? [] : [`${r.name}: ${r.detail}`];
  });
  const head = `materialized ${written} pack file${written === 1 ? "" : "s"}` +
    (undeclared > 0 ? `, no skills declared ${undeclared}` : "") +
    (pruned > 0 ? `, ${setAsideLine(pruned)}` : "");
  return failures.length > 0 ? `${head}; failed: ${failures.join("\nfailed: ")}` : head;
}

export function setAsideLine(count: number): string {
  return `set aside ${count} stale bindings file${count === 1 ? "" : "s"}`;
}

function registeredKnownRepos(): Pick<KnownRepo, "repoName" | "worktrees">[] {
  return getKnownRepos().filter((r) => r.registered !== false);
}

async function originRemote(p: Probes, dir: string): Promise<string | null> {
  const origin = await p.exec(["git", "-C", dir, "remote", "get-url", "origin"], { timeoutMs: GIT_TIMEOUT_MS });
  if (origin.code === 0 && origin.stdout.trim()) return origin.stdout.trim();
  const remotes = await p.exec(["git", "-C", dir, "remote"], { timeoutMs: GIT_TIMEOUT_MS });
  const first = remotes.stdout.split("\n")[0]?.trim();
  if (!first) return null;
  const url = await p.exec(["git", "-C", dir, "remote", "get-url", first], { timeoutMs: GIT_TIMEOUT_MS });
  return url.code === 0 && url.stdout.trim() ? url.stdout.trim() : null;
}

/** The first registered checkout whose remote is the forge repo `slug` names (the `repos/<slug>` directory), or null. */
export async function registeredCheckoutForSlug(p: Probes, slug: string): Promise<string | null> {
  for (const repo of registeredKnownRepos()) {
    const path = repo.worktrees[0]!.path;
    const remote = await originRemote(p, path);
    if (remote && parseRemote(remote)?.slug === slug) return path;
  }
  return null;
}

async function resolveTargets(opts: { repo?: string; dir?: string }): Promise<{ name: string; path: string }[]> {
  if (opts.dir) {
    const dir = resolve(opts.dir);
    return [{ name: basename(dir), path: dir }];
  }
  const known = registeredKnownRepos();
  if (!opts.repo) return known.map((r) => ({ name: repoLabel(r.repoName), path: r.worktrees[0]!.path }));
  // Rows are keyed by serialized identity, so a typed name resolves to one
  // before matching. The raw-spelling fallback is for kind "none" ONLY: on an
  // ambiguous label a legacy row spelled that way would otherwise decide
  // which repo gets materialized.
  const resolution = await tryResolveRepoArg(opts.repo);
  if (resolution.kind === "ambiguous") {
    throw new UserActionableError("repo-ambiguous", `"${opts.repo}" matches more than one repo: ${resolution.matches.join(", ")}... pass the full identity`);
  }
  const match = resolution.kind === "resolved"
    ? known.find((r) => r.repoName === resolution.identity)
    : known.find((r) => r.repoName === opts.repo);
  if (!match) throw new UserActionableError("repo-not-registered", `"${opts.repo}" is not a registered repo (rt repos register first)`);
  return [{ name: repoLabel(match.repoName), path: match.worktrees[0]!.path }];
}

function describe(packs: PackOutcome[]): string {
  const failed = packs.filter((pk) => !pk.ok);
  if (failed.length > 0) return failed.map((pk) => (pk.ok ? "" : `${pk.pack}: ${pk.detail}`)).join("; ");
  return `wrote ${packs.length} pack file${packs.length === 1 ? "" : "s"}: ${packs.map((pk) => pk.pack).join(", ")}`;
}

export async function materializeSkills(p: Probes, opts: { repo?: string; dir?: string }): Promise<MaterializeSkillsResult> {
  if (opts.repo && opts.dir) throw new UserActionableError("flags-conflict", "pass --repo or --dir, not both");
  const enginePackDir = findEnginePackDir(p);
  if (!enginePackDir) {
    return { skipped: true, reason: `${ENGINE_PACK_MISSING_CODE}: install the mattstack plugin first (plugins.install), then rerun`, repos: [] };
  }
  const deps = { fs: p, mattstackRoot: join(p.home, ".mattstack"), claudeHome: p.home, enginePackDir };
  const repos: MaterializeRepoResult[] = [];
  for (const target of await resolveTargets(opts)) {
    let outcome: MaterializeRepoOutcome;
    try {
      outcome = materializeRepo(deps, await originRemote(p, target.path));
    } catch (err) {
      repos.push({ ...target, ok: false, detail: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (outcome.kind === "no-remote") {
      repos.push({ ...target, ok: false, noManifest: true, noRemote: true, detail: `no git remote in ${target.path}` });
    } else if (outcome.kind === "undeclared") {
      repos.push({ ...target, ok: false, noManifest: true, detail: `no team declares ${outcome.repo}` });
    } else if (outcome.packs.length === 0) {
      repos.push({ ...target, ok: false, noManifest: true, detail: `no team declares a pack for ${outcome.repo}`, pruned: outcome.pruned });
    } else {
      repos.push({ ...target, ok: outcome.packs.every((pk) => pk.ok), detail: describe(outcome.packs), packs: outcome.packs, migrated: outcome.migrated, pruned: outcome.pruned });
    }
  }
  return { skipped: false, repos };
}

/** One pack's view of a run: its own failed outcomes and repo-level errors are failures; another pack's failure is only a warning. No-remote and undeclared rows are neither. */
export function packVerdict(repos: MaterializeRepoResult[], pack: string): { written: number; failures: string[]; warnings: string[] } {
  let written = 0;
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const repo of repos) {
    if (!repo.packs) {
      if (!repo.ok && !repo.noManifest) failures.push(`${repo.name}: ${repo.detail}`);
      continue;
    }
    for (const pk of repo.packs) {
      if (pk.ok) written += pk.pack === pack ? 1 : 0;
      else (pk.pack === pack ? failures : warnings).push(`${pk.pack} (${repo.name}): ${pk.detail}`);
    }
  }
  return { written, failures, warnings };
}
