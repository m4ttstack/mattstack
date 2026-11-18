/**
 * The org clone health a telemetry ping carries per org, so a person whose
 * packs show changes they never made can be diagnosed from the relay: where
 * the clone sits against origin, why its last pull did not land, which files
 * are dirty and since when, and which skills read as waiting for compile.
 *
 * Paths are org-relative (`mattstack/teams/<team>/plugin/...`), never this
 * Mac's; a pull failure travels as a kind, never git's text, which can name
 * hosts and repos.
 */

import type { SnapshotStatus } from "../daemon/home-snapshot.ts";
import type { Probes } from "../setup/probes.ts";
import { knownDataBranch } from "../team/org-branch.ts";
import type { PingHealthDeps } from "./ping.ts";

export type PullState =
  | "ok"
  | "fetch-auth"
  | "fetch-network"
  | "fetch-other"
  | "local-changes"
  | "layout-hold"
  | "conflict"
  | "detached"
  | "no-remote"
  | "no-tracking"
  | "disabled"
  | "skipped-other"
  | "unknown";

export interface DirtyFile {
  path: string;
  status: string;
}

export interface CloneHealth {
  branch: string | null;
  dataBranch: string | null;
  head: string | null;
  upstream: string | null;
  behind: number | null;
  ahead: number | null;
  lastPullAt: string | null;
  pull: PullState;
  canPublish: boolean;
  dirtyCount: number;
  dirty: DirtyFile[];
  dirtySince: string | null;
  conflicted: boolean;
  layoutHold: boolean;
}

export interface StaleSkill {
  skill: string;
  causes: string[];
}

export type CloneStatusSlice = Pick<SnapshotStatus, "lastPullAt" | "lastPullError" | "lastPullSkipped" | "conflicted" | "pullOnly" | "firstSeenDirty"> & {
  layoutHold?: SnapshotStatus["layoutHold"];
  pullBlockedBy?: string[];
};

export interface CloneGitFacts {
  branch: string | null;
  head: string | null;
  upstream: string | null;
  behind: number | null;
  ahead: number | null;
  dirty: DirtyFile[];
}

const MAX_DIRTY = 40;
const SHA_LENGTH = 12;

const AUTH = /authentication failed|could not read username|terminal prompts disabled|http basic|403|401|invalid username or password|access denied|permission denied/i;
const NETWORK = /could not resolve host|timed out|connection refused|failed to connect|network is unreachable|connection reset|ssl/i;
const LOCAL_CHANGES = /would be overwritten|unstaged changes|uncommitted changes|local changes/i;

/** What the clone's last pull did, from the snapshot engine's status. */
export function pullState(s: CloneStatusSlice): PullState {
  if (s.lastPullError) return AUTH.test(s.lastPullError) ? "fetch-auth" : NETWORK.test(s.lastPullError) ? "fetch-network" : "fetch-other";
  if (s.conflicted) return "conflict";
  if (s.layoutHold) return "layout-hold";
  const skipped = s.lastPullSkipped;
  if (skipped) {
    if ((s.pullBlockedBy?.length ?? 0) > 0 || LOCAL_CHANGES.test(skipped)) return "local-changes";
    if (skipped === "detached HEAD") return "detached";
    if (skipped === "no remote") return "no-remote";
    if (skipped === "no remote-tracking ref yet") return "no-tracking";
    if (skipped === "pull not enabled for this repo") return "disabled";
    return "skipped-other";
  }
  return s.lastPullAt > 0 ? "ok" : "unknown";
}

export function buildCloneHealth(s: CloneStatusSlice, git: CloneGitFacts, dataBranch: string | null): CloneHealth {
  const dirtyPaths = new Set(git.dirty.map((d) => d.path));
  const seen = Object.entries(s.firstSeenDirty)
    .filter(([path]) => dirtyPaths.has(path))
    .map(([, at]) => at);
  return {
    branch: git.branch,
    dataBranch,
    head: git.head,
    upstream: git.upstream,
    behind: git.behind,
    ahead: git.ahead,
    lastPullAt: s.lastPullAt > 0 ? new Date(s.lastPullAt).toISOString() : null,
    pull: pullState(s),
    canPublish: !s.pullOnly,
    dirtyCount: git.dirty.length,
    dirty: git.dirty.slice(0, MAX_DIRTY),
    dirtySince: seen.length > 0 ? new Date(Math.min(...seen)).toISOString() : null,
    conflicted: s.conflicted !== null,
    layoutHold: (s.layoutHold ?? null) !== null,
  };
}

/** Every stale skill and attachment in an `rt skills check --json` report, with what made it stale. */
export function staleSkillsOf(check: unknown): StaleSkill[] {
  const report = (check ?? {}) as { verbs?: unknown; attachments?: unknown };
  const rows = [...(Array.isArray(report.verbs) ? report.verbs : []), ...(Array.isArray(report.attachments) ? report.attachments : [])] as {
    name?: unknown;
    status?: unknown;
    staleBecause?: unknown;
  }[];
  return rows
    .filter((r) => r.status === "stale" && typeof r.name === "string")
    .map((r) => ({
      skill: r.name as string,
      causes: Array.isArray(r.staleBecause) ? r.staleBecause.filter((c): c is string => typeof c === "string") : [],
    }));
}

const GIT_TIMEOUT_MS = 10_000;

async function gitText(p: Probes, dir: string, args: string[]): Promise<string | null> {
  const res = await p.exec(["git", "-C", dir, ...args], { timeoutMs: GIT_TIMEOUT_MS });
  const text = res.stdout.trim();
  return res.code === 0 && text !== "" ? text : null;
}

/** The clone's branch, HEAD and upstream, its distance from origin as of the last fetch, and its dirty files. */
export async function readCloneGit(p: Probes, dir: string): Promise<CloneGitFacts> {
  const branch = await gitText(p, dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = await gitText(p, dir, ["rev-parse", `--short=${SHA_LENGTH}`, "HEAD"]);
  const upstream = await gitText(p, dir, ["rev-parse", `--short=${SHA_LENGTH}`, "@{u}"]);
  const counts = upstream ? await gitText(p, dir, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]) : null;
  const [behind, ahead] = counts ? counts.split(/\s+/).map((n) => Number.parseInt(n, 10)) : [null, null];
  const porcelain = (await p.exec(["git", "-C", dir, "status", "--porcelain=v1", "--untracked-files=all"], { timeoutMs: GIT_TIMEOUT_MS })).stdout;
  const dirty = porcelain
    .split("\n")
    .filter((line) => line.length > 3)
    .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3).replace(/^.* -> /, "") }));
  return {
    branch: branch === "HEAD" ? null : branch,
    head,
    upstream,
    behind: Number.isFinite(behind) ? (behind as number) : null,
    ahead: Number.isFinite(ahead) ? (ahead as number) : null,
    dirty,
  };
}

/** The org clones' snapshot status, one entry per org slug, as the daemon's team snapshots report it. */
type StatusEntry = CloneStatusSlice & { slug: string; repoDir: string };

const CHECK_TIMEOUT_MS = 60_000;

/** The daemon's clone and stale-skill readers for a telemetry ping. `rtArgv` runs this rt (`rtSelfArgv` with the CLI entry, never the daemon's own `Bun.main`). */
export function makePingHealth(deps: { probes: Probes; rtArgv: string[]; status: () => StatusEntry[] }): PingHealthDeps {
  return {
    async cloneHealth(slug) {
      const entry = deps.status().find((e) => e.slug === slug);
      if (!entry) return null;
      const git = await readCloneGit(deps.probes, entry.repoDir);
      return buildCloneHealth(entry, git, knownDataBranch(deps.probes, entry.repoDir));
    },
    async staleSkills(pack) {
      // A pack with stale skills exits nonzero and still prints the report.
      const res = await deps.probes.exec([...deps.rtArgv, "skills", "check", "--pack", pack, "--json"], { timeoutMs: CHECK_TIMEOUT_MS });
      return staleSkillsOf(JSON.parse(res.stdout));
    },
  };
}
