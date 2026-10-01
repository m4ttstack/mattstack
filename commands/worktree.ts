#!/usr/bin/env bun

/**
 * rt worktree — the worktree lifecycle CLI (spec §3): provision, create,
 * dispose, list, freshen, adopt, and `each` (run a command across worktrees).
 *
 * Every mutating verb here is a thin wrapper over the daemon's `worktree:*`
 * handlers (`lib/daemon/handlers/worktree.ts`) — the daemon is the single
 * writer of the registry, so there is no inline fallback when it's down
 * (`daemonQuery` returning null is a hard stop, not a "do it locally"
 * signal). The one exception is `worktreeEach`, which is read-only and falls
 * back to enumerating worktrees straight from git.
 */

import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { bold, dim, green, red, reset } from "../lib/tui.ts";
import { RT_DIR } from "../lib/daemon-config.ts";
import { getRepoIdentity } from "../lib/repo.ts";
import { loadRepoIndex } from "../lib/repo-index.ts";
import { currentRepoIdentity, repoLabel, resolveRepoArg, tryResolveRepoArg } from "../lib/repo-arg.ts";
import { changeMarker, repoLabelFull } from "../lib/repo-label.ts";
import { loadWorktreeRepoConfig, inspectReadyGate, type ReadyStep } from "../lib/worktree/config.ts";
import { explainError } from "../lib/explain-error.ts";
import type { MergeCleanupGap } from "../lib/worktree/merge-cleanup-gap.ts";
import { shellQuote } from "../lib/herdr-launch.ts";
import { maybeOfferClaudeHook } from "./worktree-hook.ts";
import { writeReadyApproval } from "../lib/worktree/ready-approval.ts";
import { daemonQuery, lastQueryTimedOut, suppressDaemonDownWarning, type DaemonResponse } from "../lib/daemon-client.ts";
import { listWorktrees } from "../lib/git-worktrees.ts";
import { clonePath, cloneExitCode, CLONE_EXIT } from "../lib/worktree/clonefile.ts";
import {
  parseEachArgs,
  filterTargets,
  relWorktreeName,
  formatSummary,
  hasFailures,
  type EachResult,
  type WorktreeBinding,
} from "../lib/worktree-each.ts";
import * as out from "../lib/ui/out.ts";
import type { EnrichedBranch } from "../lib/enrich.ts";
import type { Block, PickRow, PickSegment, RenderStatus, Segment } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import type { RestorableEntry } from "../lib/worktree/restore.ts";

// Provision and create both do a targeted `git fetch` / cold clone (up to
// 5 min server-side per lib/daemon/handlers/worktree.ts) — give the round
// trip room beyond that. Dispose and freshen get their own generous budgets
// (freshen's fetch alone is budgeted 5min server-side, and a repo-wide sweep
// with no `tree` given can touch many trees in one call). The default 2s
// daemonQuery timeout used elsewhere is a client-not-a-daemon-op number —
// using it here would make the CLI report "daemon unavailable" while the
// daemon is still working.
const PROVISION_TIMEOUT_MS = 6 * 60_000;
const DISPOSE_TIMEOUT_MS = 2 * 60_000;
const FRESHEN_TIMEOUT_MS = 10 * 60_000;
const ADOPT_TIMEOUT_MS = 2 * 60_000;
// Restore recreates the worktree AND re-runs ready steps (an install), so it
// gets provision's budget rather than dispose's.
const RESTORE_TIMEOUT_MS = 6 * 60_000;

// ─── Arg parsing (pure — unit tested in lib/__tests__/worktree-cli-args.test.ts) ──

/** A value token that itself looks like a flag (starts with "-") is never a value — the flag was passed bare. */
function isFlagLike(token: string | undefined): boolean {
  return token !== undefined && token.startsWith("-");
}

function takeFlag(args: string[], flag: string): { value: string | undefined; rest: string[] } {
  const idx = args.indexOf(flag);
  if (idx === -1 || args[idx + 1] === undefined || isFlagLike(args[idx + 1])) {
    return { value: undefined, rest: args };
  }
  return { value: args[idx + 1], rest: [...args.slice(0, idx), ...args.slice(idx + 2)] };
}

function takeBoolFlag(args: string[], flag: string): { present: boolean; rest: string[] } {
  const idx = args.indexOf(flag);
  if (idx === -1) return { present: false, rest: args };
  return { present: true, rest: [...args.slice(0, idx), ...args.slice(idx + 1)] };
}

export interface ProvisionArgs {
  repoName?: string;
  ticket?: string;
  title?: string;
  branch?: string;
  owner?: string;
  disposal?: string;
  wait: boolean;
  json: boolean;
}

export function parseProvisionArgs(args: string[]): ProvisionArgs {
  let rest = args;
  const json = takeBoolFlag(rest, "--json"); rest = json.rest;
  const wait = takeBoolFlag(rest, "--wait"); rest = wait.rest;
  const repo = takeFlag(rest, "--repo"); rest = repo.rest;
  const ticket = takeFlag(rest, "--ticket"); rest = ticket.rest;
  const title = takeFlag(rest, "--title"); rest = title.rest;
  const branch = takeFlag(rest, "--branch"); rest = branch.rest;
  const owner = takeFlag(rest, "--owner"); rest = owner.rest;
  const disposal = takeFlag(rest, "--disposal"); rest = disposal.rest;
  return {
    repoName: repo.value,
    ticket: ticket.value,
    title: title.value,
    branch: branch.value,
    owner: owner.value,
    disposal: disposal.value,
    wait: wait.present,
    json: json.present,
  };
}

export interface CreateArgs {
  repoName?: string;
  onDeck: boolean;
  json: boolean;
}

export function parseCreateArgs(args: string[]): CreateArgs {
  let rest = args;
  const json = takeBoolFlag(rest, "--json"); rest = json.rest;
  const onDeck = takeBoolFlag(rest, "--on-deck"); rest = onDeck.rest;
  const repo = takeFlag(rest, "--repo"); rest = repo.rest;
  return { repoName: repo.value, onDeck: onDeck.present, json: json.present };
}

export interface DisposeArgs {
  tree?: string;
  owner?: string;
  repoName?: string;
  force: boolean;
  json: boolean;
}

export function parseDisposeArgs(args: string[]): DisposeArgs {
  let rest = args;
  const json = takeBoolFlag(rest, "--json"); rest = json.rest;
  const force = takeBoolFlag(rest, "--force"); rest = force.rest;
  const owner = takeFlag(rest, "--owner"); rest = owner.rest;
  const repo = takeFlag(rest, "--repo"); rest = repo.rest;
  const tree = rest.find((a) => !a.startsWith("--"));
  return { tree, owner: owner.value, repoName: repo.value, force: force.present, json: json.present };
}

export interface RestoreArgs {
  tree?: string;
  repoName?: string;
  list: boolean;
  json: boolean;
}

export function parseRestoreArgs(args: string[]): RestoreArgs {
  let rest = args;
  const json = takeBoolFlag(rest, "--json"); rest = json.rest;
  const list = takeBoolFlag(rest, "--list"); rest = list.rest;
  const repo = takeFlag(rest, "--repo"); rest = repo.rest;
  const tree = rest.find((a) => !a.startsWith("--"));
  return { tree, repoName: repo.value, list: list.present, json: json.present };
}

export interface ListArgs {
  repoName?: string;
  json: boolean;
}

export function parseListArgs(args: string[]): ListArgs {
  let rest = args;
  const json = takeBoolFlag(rest, "--json"); rest = json.rest;
  const repo = takeFlag(rest, "--repo"); rest = repo.rest;
  return { repoName: repo.value, json: json.present };
}

export interface FreshenArgs {
  tree?: string;
  repoName?: string;
  json: boolean;
}

export function parseFreshenArgs(args: string[]): FreshenArgs {
  let rest = args;
  const json = takeBoolFlag(rest, "--json"); rest = json.rest;
  const repo = takeFlag(rest, "--repo"); rest = repo.rest;
  const tree = rest.find((a) => !a.startsWith("--"));
  return { tree, repoName: repo.value, json: json.present };
}

export interface AdoptArgs {
  repoName?: string;
  json: boolean;
  claim: boolean;
}

export function parseAdoptArgs(args: string[]): AdoptArgs {
  let rest = args;
  const json = takeBoolFlag(rest, "--json"); rest = json.rest;
  const claim = takeBoolFlag(rest, "--claim"); rest = claim.rest;
  const repo = takeFlag(rest, "--repo"); rest = repo.rest;
  return { repoName: repo.value, json: json.present, claim: claim.present };
}

// ─── Shared IO helpers ───────────────────────────────────────────────────────

/**
 * `daemonQuery` returned null: hard stop, no inline fallback (spec §3). Two
 * very different reasons collapse to null — genuinely down, or a slow
 * operation (provision's fetch, a repo-wide freshen sweep) outran its
 * timeout while the daemon kept working — so `lastQueryTimedOut()` picks the
 * message that doesn't lie about which one happened.
 */
function daemonUnavailable(): never {
  out.fail(
    lastQueryTimedOut()
      ? { title: "This is taking longer than rt waits for", why: "The daemon may still be working on it.", next: out.cmd("rt worktree list") }
      : { title: "The rt daemon is not running", why: "Worktrees are made and cleaned up by the daemon.", next: out.cmd("rt daemon start") },
  );
  process.exit(1);
}

/** These verbs say the daemon is down themselves, so the client must not say it first. */
function queryDaemon(cmd: string, payload?: Record<string, unknown>, timeoutMs?: number): Promise<DaemonResponse | null> {
  suppressDaemonDownWarning();
  return daemonQuery(cmd, payload, timeoutMs);
}

/** `message` is the --json error value and never changes; `human` is what a person reads instead. */
function failText(json: boolean, message: string, human: out.FailureInput = { title: message }): never {
  if (json) out.json({ error: message });
  else out.fail(human);
  process.exit(1);
}

/** Implementation lives in lib/explain-error.ts so lib/mcp/tools.ts can share
    it without pulling this module's TUI-adjacent graph in. Re-exported here
    so existing imports of `explainError` from this module keep compiling. */
export { explainError };

/** A refusal is rt declining by policy: it prints as `refused` on stderr, never as a coral failure. */
type CodeCopy = out.FailureInput & { refused?: true };

/** Parity: `validateGitRef` in lib/daemon/git-ref-validation.ts writes this prefix before the ref. */
const UNSAFE_REF = "unsafe git ref (starts with '-' or empty): ";

function copyForCode(error: string): CodeCopy {
  if (error === "busy") return { refused: true, title: "That worktree is busy right now", hint: "another rt operation is using it", next: "Try again in a moment" };
  if (error === "repo-unknown") return { title: "rt does not know that repo", why: "Name a repo rt knows, or run this from inside one.", next: out.cmd("rt repos status") };
  if (error === "branch-unresolved") return usageFailure("Which branch?", "rt worktree provision --branch <name>", "A new worktree needs a branch, or a ticket to name one after.");
  if (error === "no-target") return usageFailure("Which worktree?", "rt worktree dispose <tree>");
  if (error === "tree-required") return usageFailure("Which worktree?", "rt worktree await-ready <tree>");
  if (error === "tree-unknown") return { title: "rt has no worktree by that name", next: out.cmd("rt worktree list") };
  if (error === "tree-ambiguous") return { title: "More than one repo has a worktree with that name", next: "Run it again with the repo named" };
  if (error === "branch-duplicated") {
    return { refused: true, title: "That branch is checked out in more than one worktree", hint: "rt will not pick one of them for you", next: out.cmd("rt worktree adopt --repo <name>") };
  }
  if (error.startsWith("branch-attached:")) {
    return { refused: true, title: `That branch is already checked out in the ${error.slice("branch-attached:".length)} worktree`, hint: "a branch can only be in one worktree at a time" };
  }
  if (error.startsWith("checkout-failed:")) return { title: "The branch could not be checked out", details: error.slice("checkout-failed:".length) };
  if (error.startsWith("create-failed:")) {
    // The step name is the first line; the step's output tail and a note may follow.
    const [step, ...output] = error.slice("create-failed:".length).split("\n");
    return {
      title: "The worktree could not be created",
      why: step === "unknown" ? "It stopped before finishing setup." : `It stopped at the ${step} step.`,
      next: out.cmd("rt daemon logs"),
      ...(output.length > 0 ? { details: output.join("\n") } : {}),
    };
  }
  if (error.startsWith(UNSAFE_REF)) {
    const ref = error.slice(UNSAFE_REF.length);
    return {
      title: "That is not a branch name rt can use",
      why: ref ? `${ref} starts with a dash, so git would read it as an option.` : "The branch name is empty.",
      next: out.cmd("rt worktree provision --branch <name>"),
    };
  }
  if (error === "claim-write-failed") return { title: "rt could not mark the worktree as yours", why: "Writing its record failed, so it was given back.", next: out.cmd("rt daemon logs") };
  if (error === "handoff-write-failed") return { title: "rt could not hand the worktree over", why: "Writing its record failed.", next: out.cmd("rt daemon logs") };
  if (error === "not-found") return { title: "No cleaned-up worktree has that name", next: out.cmd("rt worktree restore --list") };
  if (error === "no-manifest") return { title: "That worktree cannot be brought back", why: "rt kept no record of how it was cleaned up." };
  if (error === "branch-elsewhere") {
    return { refused: true, title: "That branch exists again", hint: "bringing the worktree back would overwrite it, so rt left both alone" };
  }
  if (error === "no-head-sha") return { title: "That worktree cannot be brought back", why: "rt has no record of the commit it was on." };
  if (error === "path-exists") return { refused: true, title: "A worktree with that name already exists", hint: "rt will not write over it", next: out.cmd("rt worktree list") };
  if (error === "worktree-add-failed") return { title: "The worktree could not be recreated", next: out.cmd("rt daemon logs") };
  if (error === "copy-failed") {
    return {
      title: "The worktree is back, but its untracked files are not",
      why: "Copying them back failed. The saved copy is still there.",
      next: out.cmd("rt worktree dispose <tree> --force"),
      details: "Then bring it back again.",
    };
  }
  if (error === "register-failed") return { title: "The worktree is back on disk, but rt lost track of it", next: out.cmd("rt worktree adopt --repo <name>") };
  return { title: explainError(error) };
}

function lineWithNext(status: RenderStatus, title: string, hint?: string, next?: out.CellInput): Block[] {
  return [out.line(status, title, hint), ...(next ? [out.callout("next", next)] : [])];
}

function refusalBlocks(c: { title: string; hint?: string; next?: out.CellInput }): Block[] {
  return lineWithNext("refused", c.title, c.hint, c.next);
}

function failResult(json: boolean, error: string): never {
  if (json) out.json({ error });
  else {
    const { refused, ...copy } = copyForCode(error);
    if (refused) out.note(...refusalBlocks(copy));
    else out.fail(copy);
  }
  process.exit(1);
}

/** Under --json the refusal is resolveRepoArg's own message, unchanged. */
async function resolveRepo(json: boolean, arg: string): Promise<string> {
  if (json) return resolveRepoArg(arg, (message) => failText(true, message));
  const resolution = await tryResolveRepoArg(arg);
  if (resolution.kind === "resolved") return resolution.identity;
  out.fail(
    resolution.kind === "ambiguous"
      ? { title: `More than one repo is called ${arg}`, why: "Use the full name of the one you mean.", details: `It could be ${resolution.matches.map(repoLabelFull).join(", ")}` }
      : { title: `rt does not know a repo called ${arg}`, next: out.cmd("rt repos status") },
  );
  process.exit(1);
}

function noRepo(usage: string): out.FailureInput {
  return usageFailure("Which repo?", usage, "You are not inside a repo rt knows.");
}

function nothingSelected(): void {
  out.print(out.line("skipped", "Nothing selected"));
}

const STALE_DEPS = "you can use this worktree, but its dependencies may be out of date";

/** No failed step means the steps never got to run (the settle could not take the tree lock), not that one ran and failed. */
function setupFailedLine(failedStep: string | undefined, tree?: string): Block {
  const what = failedStep ? `The ${failedStep} setup step failed` : "Setup did not finish";
  return out.line("warn", tree ? `${what} in ${tree}` : what, STALE_DEPS);
}

export const __test__ = { copyForCode, restorableEntriesBlock, readyStepsBlock, disposeReason };

function requireQueryResult(json: boolean, res: DaemonResponse | null): DaemonResponse {
  if (res === null) daemonUnavailable();
  if (!res.ok) failResult(json, res.error ?? "unknown error");
  return res;
}

/** Re-exported so existing imports of `repoLabel` from this module keep compiling — the implementation now lives in `lib/repo-arg.ts` alongside `resolveRepoArg`, which it shares a parity contract with. */
export { repoLabel } from "../lib/repo-arg.ts";

// ─── Tree rows (worktree:list) shared by list / nav / the dispose+freshen pickers ──

interface TreeRow {
  name: string;
  path: string;
  kind: string;
  state?: string;
  branch: string | null;
  owner?: string;
  disposableReason?: string;
  heldReason?: string;
  repoName: string;
  mr?: { iid: number; state: string; title: string } | null;
  duplicateBranch?: boolean;
}

type MergeCleanupOffRow = { repo: string; path: string } & MergeCleanupGap;

function mergeCleanupOffBlocks(gap: MergeCleanupOffRow): Block[] {
  const title = `Merged worktrees are not cleaned up in ${repoLabel(gap.repo)}`;
  if (gap.reason === "no-branches-grant") {
    const mode = gap.mode === "off" ? "poll" : gap.mode;
    return lineWithNext(
      "warn",
      title,
      gap.mode === "off" ? "rt is not watching this repo" : "rt watches this repo, but not its pull requests",
      out.cmd(`rt repos register ${shellQuote(gap.path)} --track ${mode} --caches ${[...gap.caches, "branches"].join(",")}`),
    );
  }
  return gap.forge === "github"
    ? lineWithNext("warn", title, "rt has no GitHub login", out.cmd("rt setup github connect --use-gh"))
    : lineWithNext("warn", title, "rt has no GitLab login", out.cmd("rt setup gitlab connect"));
}

/** The golden's state is readiness bookkeeping; its kind is what a human needs to see. */
function rowLabel(r: { kind: string; state?: string }): string {
  return r.kind === "golden" ? "golden" : (r.state ?? r.kind);
}

const DISPOSE_WORDS: Record<string, string> = {
  changed: "it was modified while rt was checking it, try again",
  "kind-main": "it is the repo's main folder",
  "kind-golden": "it is the copy rt builds new worktrees from",
  dirty: "it has changes that are not committed",
  unpushed: "it has commits that are not merged or pushed",
  attended: "someone is working on its merge request right now",
  grace: "it was claimed moments ago",
  "no-trash": "rt could not keep a copy to bring it back from",
  busy: "another rt operation is using it, try again in a moment",
  "remove-failed": "it could not be moved away, try again",
  unknown: "rt has no worktree by that name",
};

/**
 * Why rt left a tree, in words. `detail` is lib/worktree/dispose.ts's sentence
 * for the two run guards, read here and never printed as written. `failed`
 * marks the codes that are faults rather than a guard declining.
 */
function disposeReason(reason: string, detail?: string): { words: string; next?: out.CellInput; failed?: true } {
  if (reason === "running-run") {
    const m = detail ? /^running run (\S+) at (\S+);/.exec(detail) : null;
    if (!m) return { words: detail ?? "a pipeline run is still working in it" };
    return { words: `a pipeline run is still working in it (run ${m[1]}, at ${m[2]})`, next: out.cmd(`rt runs abandon ${m[1]}`) };
  }
  if (reason === "runs-unreadable") return { words: "rt could not check whether a pipeline run is using it", next: out.cmd("rt runs") };
  if (reason === "remove-failed") return { words: DISPOSE_WORDS[reason]!, failed: true };
  if (reason === "unknown") return { words: DISPOSE_WORDS[reason]!, next: out.cmd("rt worktree list"), failed: true };
  if (DISPOSE_WORDS[reason]) return { words: DISPOSE_WORDS[reason]! };
  if (reason.startsWith("kind-")) return { words: "rt did not make it, so rt does not remove it" };
  return { words: reason };
}

function stateLabel(r: TreeRow): string {
  return r.state === "disposable" && r.disposableReason ? `disposable (${disposeReason(r.disposableReason).words})` : rowLabel(r);
}

async function fetchTreeRows(json: boolean, repoName?: string): Promise<TreeRow[]> {
  const res = await queryDaemon("worktree:list", repoName ? { repoName } : undefined);
  const ok = requireQueryResult(json, res);
  return (ok.data?.trees ?? []) as TreeRow[];
}

/** One daemon `cache:read` per repo, the same source `rt cd` renders from. */
async function enrichByPath(rows: TreeRow[]): Promise<Map<string, EnrichedBranch>> {
  const byPath = new Map<string, EnrichedBranch>();
  const withBranch = rows.filter((r): r is TreeRow & { branch: string } => Boolean(r.branch));
  if (withBranch.length === 0) return byPath;

  const { enrichBranches } = await import("../lib/enrich.ts");
  const { getRemoteUrl } = await import("../lib/pickers.ts");
  const repoIndex = loadRepoIndex();

  const byRepo = new Map<string, Array<TreeRow & { branch: string }>>();
  for (const r of withBranch) {
    const group = byRepo.get(r.repoName) ?? [];
    group.push(r);
    byRepo.set(r.repoName, group);
  }

  await Promise.all(
    [...byRepo].map(async ([repoName, group]) => {
      const repoPath = repoIndex[repoName];
      const remoteUrl = repoPath ? await getRemoteUrl(repoPath) : undefined;
      const enriched = await enrichBranches(group.map((r) => ({ path: r.path, branch: r.branch })), remoteUrl);
      for (const eb of enriched) byPath.set(eb.path, eb);
    }),
  );
  return byPath;
}

async function pickOneTree(rows: TreeRow[], message: string, breadcrumb: string[]): Promise<TreeRow | null> {
  if (rows.length === 0) return null;
  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  const { formatBranchSegments } = await import("../lib/enrich.ts");
  const enriched = await enrichByPath(rows);
  const nameWidth = Math.max(...rows.map((r) => r.name.length));
  const pickRows: PickRow[] = rows.map((r) => {
    const state = rowLabel(r);
    const base = state === "disposable" ? stateLabel(r) : `${state}${r.branch ? `  ${r.branch}` : ""}${r.owner ? `  ${r.owner}` : ""}`;
    const name = r.name.padEnd(nameWidth);
    const left: PickSegment[] = [{ text: name, bold: true, column: true }, { text: `  ${base}`, tone: "dim" }];
    const eb = enriched.get(r.path);
    if (eb) left.push({ text: "  ", tone: "dim" }, ...formatBranchSegments(eb).right);
    return { value: r.path, match: name, left };
  });
  const picked = await filterableSelect({ message, options: [], stderr: true, breadcrumb }, { rows: pickRows });
  if (!picked) return null;
  return rows.find((r) => r.path === picked) ?? null;
}

/** Disposable first (with their reason as the hint), then everything else. */
function sortDisposableFirst(rows: TreeRow[]): TreeRow[] {
  const rank = (r: TreeRow) => (r.state === "disposable" ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// ─── provision ───────────────────────────────────────────────────────────────

const BRANCH_STATE: Record<string, string> = {
  new: "a new branch",
  "existing-clean": "a branch you already had",
  behind: "a branch you already had, behind its remote",
  diverged: "a branch you already had, which has moved apart from its remote",
  "tracking-remote": "a branch from the remote",
};

function provisionBlocks(d: Record<string, any>): Block[] {
  const origin = [
    BRANCH_STATE[d.branchState] ?? String(d.branchState),
    ...(d.wasOnDeck ? ["on a spare worktree rt had ready"] : []),
    ...(d.hydratedFrom ? ["set up from a ready-made copy"] : []),
  ].join(", ");
  const blocks: Block[] = [out.line("done", d.tree, d.path), out.kv("branch", d.branch, origin)];
  if (d.readyHeld) {
    blocks.push(...lineWithNext("needs-you", "The team's setup steps are waiting for your approval", undefined, out.cmd("rt worktree ready-approve")));
  }
  if (d.readyPending) {
    const steps = ((d.readySteps ?? []) as string[]).join(", ");
    blocks.push(...lineWithNext("running", "Still setting up in the background", steps || undefined, out.cmd(`rt worktree await-ready ${d.tree}`)));
  }
  if (d.readyFailed) blocks.push(setupFailedLine(d.failedStep));
  return blocks;
}

export async function worktreeProvision(args: string[], _ctx: unknown): Promise<void> {
  const parsed = parseProvisionArgs(args);
  const repoName = parsed.repoName ? await resolveRepo(parsed.json, parsed.repoName) : currentRepoIdentity();
  if (!repoName) failText(parsed.json, "no repo — pass --repo <name> or run from inside a registered repo", noRepo("rt worktree provision --repo <name>"));

  const payload: Record<string, unknown> = { repoName };
  if (parsed.owner) payload.owner = parsed.owner;
  if (parsed.disposal) payload.disposal = parsed.disposal;
  if (parsed.wait) payload.wait = true;
  if (parsed.branch) {
    payload.branch = parsed.branch;
  } else if (parsed.ticket) {
    payload.ticket = parsed.ticket;
    if (parsed.title) payload.ticketTitle = parsed.title;
  }

  const res = await queryDaemon("worktree:provision", payload, PROVISION_TIMEOUT_MS);
  const ok = requireQueryResult(parsed.json, res);

  if (parsed.json) { out.json(ok.data, 2); return; }

  out.print(...provisionBlocks(ok.data));
  await maybeOfferClaudeHook(parsed.json);
}

// ─── await-ready ─────────────────────────────────────────────────────────────

/** Settles can legitimately run for minutes (installs, migrations); give the
 *  join more headroom than the steps' own timeouts before daemonUnavailable. */
const AWAIT_READY_TIMEOUT_MS = 10 * 60_000;

export interface AwaitReadyArgs {
  tree?: string;
  repoName?: string;
  json: boolean;
}

export function parseAwaitReadyArgs(args: string[]): AwaitReadyArgs {
  let rest = args;
  const json = takeBoolFlag(rest, "--json"); rest = json.rest;
  const repo = takeFlag(rest, "--repo"); rest = repo.rest;
  return { tree: rest[0], repoName: repo.value, json: json.present };
}

export async function worktreeAwaitReady(args: string[], _ctx: unknown): Promise<void> {
  const parsed = parseAwaitReadyArgs(args);
  let treeName = parsed.tree;
  let repoName = parsed.repoName ? await resolveRepo(parsed.json, parsed.repoName) : undefined;

  if (!treeName) {
    if (!process.stdin.isTTY || parsed.json || process.env.RT_BATCH) {
      failText(parsed.json, "no tree — pass a tree name (no TTY for the picker)", usageFailure("Which worktree?", "rt worktree await-ready <tree>"));
    }
    // Only claimed trees carry a claim-time settle to wait on.
    const rows = (await fetchTreeRows(parsed.json, repoName)).filter((r) => r.state === "claimed");
    const picked = await pickOneTree(rows, "Await which worktree's readiness?", ["rt", "worktree", "await-ready"]);
    if (!picked) { nothingSelected(); return; }
    treeName = picked.name;
    repoName = picked.repoName;
  }
  if (!repoName) {
    repoName = currentRepoIdentity() ?? undefined;
    if (!repoName) failText(parsed.json, "no repo — pass --repo <name> or run from inside a registered repo", noRepo("rt worktree await-ready <tree> --repo <name>"));
  }

  const res = await queryDaemon("worktree:await-ready", { repoName, tree: treeName }, AWAIT_READY_TIMEOUT_MS);
  const ok = requireQueryResult(parsed.json, res);

  if (parsed.json) { out.json(ok.data, 2); return; }

  const d = ok.data;
  if (d.ready) {
    out.print(out.line("done", `${d.tree} is ready`, d.readyAt ?? "it had no setup steps"));
    return;
  }
  process.exitCode = 1;
  out.print(setupFailedLine(d.failedStep, d.tree));
}

// ─── create ──────────────────────────────────────────────────────────────────

export async function worktreeCreate(args: string[], _ctx: unknown): Promise<void> {
  const parsed = parseCreateArgs(args);
  const repoName = parsed.repoName ? await resolveRepo(parsed.json, parsed.repoName) : currentRepoIdentity();
  if (!repoName) failText(parsed.json, "no repo — pass --repo <name> or run from inside a registered repo", noRepo("rt worktree create --repo <name>"));

  const res = await queryDaemon("worktree:create", { repoName, onDeck: parsed.onDeck }, PROVISION_TIMEOUT_MS);
  const ok = requireQueryResult(parsed.json, res);

  if (parsed.json) { out.json(ok.data, 2); return; }

  out.print(out.line("done", ok.data.tree, parsed.onDeck ? `${ok.data.path}, kept as a spare` : ok.data.path));
  await maybeOfferClaudeHook(parsed.json);
}

// ─── dispose ─────────────────────────────────────────────────────────────────

export async function worktreeDispose(args: string[], _ctx: unknown): Promise<void> {
  const parsed = parseDisposeArgs(args);
  let treeName = parsed.tree;
  let repoName = parsed.repoName ? await resolveRepo(parsed.json, parsed.repoName) : undefined;

  if (!treeName && !parsed.owner) {
    if (!process.stdin.isTTY) {
      failText(parsed.json, "no target — pass a tree name or --owner (no TTY for the picker)", usageFailure("Which worktree?", "rt worktree dispose <tree>"));
    }
    // Only rt-managed (ephemeral) trees are ever disposable — offering the
    // main clone here would just earn every pick a pointless "kind-main" refusal.
    const rows = sortDisposableFirst(
      (await fetchTreeRows(parsed.json, repoName)).filter((r) => r.kind === "ephemeral"),
    );
    const picked = await pickOneTree(rows, "Dispose which worktree?", ["rt", "worktree", "dispose"]);
    if (!picked) { nothingSelected(); return; }
    treeName = picked.name;
    repoName = picked.repoName;
  }

  const payload: Record<string, unknown> = { force: parsed.force, callerPid: process.pid };
  if (repoName) payload.repoName = repoName;
  if (parsed.owner) payload.owner = parsed.owner;
  if (treeName) payload.tree = treeName;

  const res = await queryDaemon("worktree:dispose", payload, DISPOSE_TIMEOUT_MS);
  const ok = requireQueryResult(parsed.json, res);

  const { disposed, refused, recoverable } = ok.data as {
    disposed: string[];
    refused: Array<{ tree: string; reason: string; detail?: string }>;
    recoverable?: Array<{ tree: string; path: string; until: string }>;
  };
  // Set before either return path — --json must not exit 0 on a partial failure.
  if (refused.length > 0) process.exitCode = 1;

  if (parsed.json) { out.json(ok.data, 2); return; }

  const done = disposed.map((name) => {
    const kept = recoverable?.find((r) => r.tree === name);
    return out.line("done", `${name} cleaned up`, kept ? `you can bring it back until ${kept.until.slice(0, 10)}` : undefined);
  });
  if (done.length > 0) out.print(...done);
  else if (refused.length === 0) out.print(out.line("skipped", "Nothing to clean up"));

  const notes = refused.flatMap((r) => {
    const why = disposeReason(r.reason, r.detail);
    return why.failed ? lineWithNext("failed", r.tree, why.words, why.next) : refusalBlocks({ title: r.tree, hint: why.words, next: why.next });
  });
  if (notes.length > 0) out.note(...notes);
  await maybeOfferClaudeHook(parsed.json);
}

// ─── restore ─────────────────────────────────────────────────────────────────

/** Restorable trash entries for `repoName`, straight from disk (read-only, so like `each` this skips the daemon round trip). */
async function fetchRestorableEntries(repoName: string, repoPath: string) {
  const { listRestorableEntries } = await import("../lib/worktree/restore.ts");
  return listRestorableEntries(repoName, repoPath);
}

const RESTORE_REASON: Record<string, string> = {
  manual: "by you",
  auto: "by rt after its merge",
  force: "by you, with force",
};

function cleanedUp(e: RestorableEntry): string {
  return `cleaned up ${e.disposedAt.slice(0, 10)} ${RESTORE_REASON[e.reason] ?? `(${e.reason})`}`;
}

function keptUntil(e: RestorableEntry): string {
  return `kept until ${e.keptUntil.slice(0, 10)}`;
}

function restorableEntriesBlock(entries: RestorableEntry[]): Block {
  return out.table(entries.map((e) => [out.strong(e.name), out.key(e.branch ?? "(detached)"), out.dim(cleanedUp(e)), out.dim(keptUntil(e))]));
}

function printRestorableEntries(entries: RestorableEntry[]): void {
  if (entries.length === 0) { out.print(out.line("skipped", "Nothing to bring back")); return; }
  out.print(restorableEntriesBlock(entries));
}

async function pickRestorableEntry(entries: RestorableEntry[]): Promise<string | null> {
  if (entries.length === 0) return null;
  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  const nameWidth = Math.max(...entries.map((e) => e.name.length));
  const options = entries.map((e) => ({
    value: e.name,
    label: e.name.padEnd(nameWidth),
    hint: `${e.branch ?? "(detached)"}  ${cleanedUp(e)}, ${keptUntil(e)}`,
  }));
  return filterableSelect({ message: "Restore which worktree?", options, stderr: true, breadcrumb: ["rt", "worktree", "restore"] });
}

export async function worktreeRestore(args: string[], _ctx: unknown): Promise<void> {
  const parsed = parseRestoreArgs(args);
  const repoName = parsed.repoName ? await resolveRepo(parsed.json, parsed.repoName) : currentRepoIdentity();
  if (!repoName) failText(parsed.json, "no repo... pass --repo <name> or run from inside a registered repo", noRepo("rt worktree restore <tree> --repo <name>"));

  const repoIndex = loadRepoIndex();
  const repoPath = repoIndex[repoName];
  if (!repoPath) failText(parsed.json, `repo "${repoName}" not registered in ~/.mattstack/rt/repos.json`, { title: `rt does not know a repo called ${repoLabel(repoName)}`, next: out.cmd("rt repos status") });

  if (parsed.list) {
    const entries = await fetchRestorableEntries(repoName, repoPath);
    if (parsed.json) { out.json({ entries }, 2); return; }
    printRestorableEntries(entries);
    return;
  }

  let treeName = parsed.tree;
  if (!treeName) {
    if (process.stdin.isTTY && !parsed.json && !process.env.RT_BATCH) {
      const entries = await fetchRestorableEntries(repoName, repoPath);
      const picked = await pickRestorableEntry(entries);
      if (!picked) { nothingSelected(); return; }
      treeName = picked;
    } else {
      failText(parsed.json, "no target... pass a tree name (no TTY for the picker)", usageFailure("Which worktree?", "rt worktree restore <tree>"));
    }
  }

  const res = await queryDaemon("worktree:restore", { repoName, tree: treeName }, RESTORE_TIMEOUT_MS);
  const ok = requireQueryResult(parsed.json, res);

  if (parsed.json) { out.json(ok.data, 2); return; }

  const d = ok.data as { restored: boolean; path: string; tree: string; readyFailed?: boolean; failedStep?: string };
  out.print(out.line("done", `${d.tree} restored`, d.path), ...(d.readyFailed ? [setupFailedLine(d.failedStep)] : []));
  await maybeOfferClaudeHook(parsed.json);
}

// ─── list ────────────────────────────────────────────────────────────────────

const CHECKS: Record<string, Segment> = {
  success: { text: "checks passed", role: "done" },
  success_with_warnings: { text: "checks passed with warnings", role: "warn" },
  failed: { text: "checks failed", role: "failed" },
  running: { text: "checks running", role: "running" },
  pending: { text: "checks waiting", role: "pending" },
  created: { text: "checks waiting", role: "pending" },
  canceled: { text: "checks canceled", role: "off" },
};

function spaced(parts: Segment[]): Segment[] {
  return parts.flatMap((p, i) => (i === 0 ? [p] : [{ text: " " }, p]));
}

function changeCell(r: TreeRow, eb: EnrichedBranch | undefined): Segment[] {
  const mr = eb?.mr ?? r.mr ?? null;
  const parts: Segment[] = [];
  if (mr) parts.push(out.dim(`${changeMarker(r.repoName)}${mr.iid} ${mr.state}`));
  const checks = eb?.mr?.pipeline ? CHECKS[eb.mr.pipeline.status] : undefined;
  if (checks) parts.push(checks);
  if (eb?.linearId) parts.push(out.dim(eb.linearId));
  return spaced(parts);
}

function noteCell(r: TreeRow): Segment[] {
  const parts: Segment[] = [];
  if (r.duplicateBranch) parts.push({ text: "duplicate branch", role: "warn" });
  // A hold only means something while the reactor still sees a terminal MR; past that it is a leftover.
  if (r.state === "claimed" && r.heldReason && (r.mr?.state === "merged" || r.mr?.state === "closed")) {
    parts.push({ text: `held: ${r.heldReason}`, role: "warn" });
  }
  return spaced(parts);
}

function cellIsEmpty(cell: out.CellInput): boolean {
  const parts = Array.isArray(cell) ? cell : [cell];
  return parts.every((p) => (typeof p === "string" ? p : p.text) === "");
}

/** A row ends at its last cell with text, so no line carries trailing spaces. */
function listRow(r: TreeRow, eb: EnrichedBranch | undefined): out.CellInput[] {
  const cells: out.CellInput[] = [
    out.strong(`${repoLabel(r.repoName)}/${r.name}`),
    out.dim(stateLabel(r)),
    out.key(r.branch ?? "(detached)"),
    out.dim(r.owner ?? ""),
    changeCell(r, eb),
    noteCell(r),
  ];
  while (cells.length > 0 && cellIsEmpty(cells[cells.length - 1]!)) cells.pop();
  return cells;
}

export async function worktreeList(args: string[], _ctx: unknown): Promise<void> {
  const parsed = parseListArgs(args);
  const repoName = parsed.repoName ? await resolveRepo(parsed.json, parsed.repoName) : undefined;
  const res = await queryDaemon("worktree:list", repoName ? { repoName } : undefined);
  const ok = requireQueryResult(parsed.json, res);
  const rows = (ok.data?.trees ?? []) as TreeRow[];
  const readyHeldRepos = (ok.data?.readyHeldRepos ?? []) as string[];
  const mergeCleanupOff = (ok.data?.mergeCleanupOff ?? []) as MergeCleanupOffRow[];

  if (parsed.json) { out.json({ trees: rows, readyHeldRepos, mergeCleanupOff }, 2); return; }

  const blocks: Block[] = [];
  if (readyHeldRepos.length > 0) {
    blocks.push(
      ...lineWithNext("needs-you", "The team's setup steps are waiting for your approval", readyHeldRepos.map(repoLabel).join(", "), out.cmd("rt worktree ready-approve <repo>")),
    );
  }
  for (const gap of mergeCleanupOff) blocks.push(...mergeCleanupOffBlocks(gap));

  if (rows.length === 0) {
    out.print(...blocks, out.line("skipped", "No worktrees"));
    return;
  }

  const enriched = await enrichByPath(rows);
  out.print(...blocks, out.table(rows.map((r) => listRow(r, enriched.get(r.path)))));
}

// ─── triage ──────────────────────────────────────────────────────────────────

export async function worktreeTriage(args: string[], _ctx: unknown): Promise<void> {
  const parsed = parseListArgs(args);
  const repoName = parsed.repoName ? await resolveRepo(parsed.json, parsed.repoName) : undefined;
  const res = await queryDaemon("worktree:triage", repoName ? { repoName } : undefined);
  const ok = requireQueryResult(parsed.json, res);
  if (parsed.json) { out.json(ok.data, 2); return; }
  const { rows, banners, counts } = ok.data as {
    rows: Array<Record<string, any>>;
    banners: MergeCleanupOffRow[];
    counts: { needsDecision: number };
  };
  const header = counts.needsDecision === 1 ? "1 worktree needs a decision" : `${counts.needsDecision} worktrees need a decision`;
  out.print(
    out.section(
      header,
      undefined,
      ...(banners ?? []).flatMap(mergeCleanupOffBlocks),
      out.table(
        rows.map((r) => [
          out.strong(`${repoLabel(r.repo)}/${r.tree}`),
          out.dim(r.group),
          out.dim(r.mr ? `${changeMarker(r.repo)}${r.mr.iid} ${r.mr.state}` : ""),
          String(r.verdict),
        ]),
      ),
    ),
  );
}

// ─── ready-approve ────────────────────────────────────────────────────────────

async function pickRepoName(repoIndex: Record<string, string>): Promise<string | undefined> {
  const names = Object.keys(repoIndex);
  if (names.length === 0) return undefined;
  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  const picked = await filterableSelect({
    message: "Approve team ready steps for which repo?",
    options: names.map((n) => ({ value: n, label: repoLabel(n) })),
    stderr: true,
    breadcrumb: ["rt", "worktree", "ready-approve"],
  });
  return picked ?? undefined;
}

async function confirmApprove(): Promise<boolean> {
  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  const picked = await filterableSelect({
    message: "Approve these steps to run unattended on every create/freshen?",
    options: [
      { value: "approve", label: "Approve" },
      { value: "cancel", label: "Cancel" },
    ],
    stderr: true,
    breadcrumb: ["rt", "worktree", "ready-approve"],
  });
  return picked === "approve";
}

function readyStepsBlock(label: string, hash: string, ladder: ReadyStep[]): Block {
  return out.section(
    `Setup steps the team wrote for ${label}`,
    `hash ${hash}`,
    out.verbatim(ladder.map((s) => (s.when ? `${s.run}  (${s.when})` : s.run))),
  );
}

/**
 * Approve a repo's team-authored `ready` shell before it runs (RT-89). The
 * daemon fail-closes on an unapproved team ladder; this records the user's
 * approval, keyed by the ladder's content hash so a later team edit re-holds it.
 * TTY only: a non-interactive caller gets the hash and a nonzero exit, never a
 * prompt.
 */
export async function worktreeReadyApprove(args: string[], _ctx: unknown): Promise<void> {
  const json = args.includes("--json");
  const interactive = !!process.stdin.isTTY && !json && !process.env.RT_BATCH;
  const positional = args.filter((a) => !a.startsWith("-"));

  const repoIndex = loadRepoIndex();
  let repoName = positional[0]
    ? await resolveRepo(json, positional[0])
    : undefined;
  if (!repoName) {
    if (!interactive) failText(json, "no repo... pass a repo name (no TTY for the picker)", usageFailure("Which repo?", "rt worktree ready-approve <repo>"));
    repoName = await pickRepoName(repoIndex);
    if (!repoName) { nothingSelected(); return; }
  }

  const repoPath = repoIndex[repoName];
  if (!repoPath) failText(json, `repo not registered: ${repoName}`, { title: `rt does not know a repo called ${repoLabel(repoName)}`, next: out.cmd("rt repos status") });

  const cfg = await loadWorktreeRepoConfig(repoName, repoPath);
  const info = await inspectReadyGate(cfg, repoPath);

  if (!info.teamOwned) {
    if (json) { out.json({ teamOwned: false }); return; }
    out.print(out.line("skipped", `${repoLabel(repoName)} has no team setup steps to approve`));
    return;
  }
  if (info.approved) {
    if (json) { out.json({ teamOwned: true, approved: true, hash: info.hash }); return; }
    out.print(out.line("done", "Already approved", info.hash));
    return;
  }
  if (!info.identity) failText(json, "repo has no derivable identity; cannot record an approval", { title: "rt cannot record an approval for this repo", why: "It has no remote or folder rt can name it by." });

  if (!interactive) {
    // Never prompt off a TTY: name the hash and exit nonzero so a script must
    // approve deliberately (mirrors the leaf-picker gate).
    if (!json) {
      out.note(
        ...lineWithNext(
          "needs-you",
          `The team's setup steps for ${repoLabel(repoName)} need your approval`,
          "approving needs a terminal, so rt can show you the steps first",
          out.cmd(`rt worktree ready-approve ${shellQuote(repoName)}`),
        ),
        out.callout("note", ["From a script: ", out.cmd(`rt settings set rt.worktreeReadyApproval '"${info.hash}"' --scope user --repo ${shellQuote(repoName)}`)]),
      );
      process.exit(1);
    }
    failText(
      json,
      `team \`ready\` steps for ${repoLabel(repoName)} need approval (hash ${info.hash}). Re-run in a TTY, or: rt settings set rt.worktreeReadyApproval '"${info.hash}"' --scope user --repo ${shellQuote(repoName)}`,
    );
  }

  out.print(readyStepsBlock(repoLabel(repoName), info.hash, info.ladder));

  if (!(await confirmApprove())) { out.print(out.line("skipped", "Not approved")); return; }
  writeReadyApproval(info.identity, info.hash);
  out.print(out.line("done", "Approved", info.hash));
}

// ─── freshen ─────────────────────────────────────────────────────────────────

export async function worktreeFreshen(args: string[], _ctx: unknown): Promise<void> {
  const parsed = parseFreshenArgs(args);
  let treeName = parsed.tree;
  let repoName = parsed.repoName ? await resolveRepo(parsed.json, parsed.repoName) : undefined;

  if (!treeName && process.stdin.isTTY) {
    // Mirrors freshenCandidate (lib/daemon/worktree-reconciler.ts): only
    // on-deck ephemeral or golden trees and the main clone are ever
    // freshened... a claimed tree is someone's active work and always comes
    // back ran:[].
    const rows = (await fetchTreeRows(parsed.json, repoName))
      .filter((r) => ((r.kind === "ephemeral" || r.kind === "golden") && r.state === "on-deck") || r.kind === "main")
      .sort((a, b) => a.name.localeCompare(b.name));
    const picked = await pickOneTree(rows, "Freshen which worktree?", ["rt", "worktree", "freshen"]);
    if (!picked) { nothingSelected(); return; }
    treeName = picked.name;
    repoName = picked.repoName;
  }

  const payload: Record<string, unknown> = {};
  if (repoName) payload.repoName = repoName;
  if (treeName) payload.tree = treeName;

  const res = await queryDaemon("worktree:freshen", payload, FRESHEN_TIMEOUT_MS);
  const ok = requireQueryResult(parsed.json, res);

  if (parsed.json) { out.json(ok.data, 2); return; }

  const ran = (ok.data?.ran ?? []) as string[];
  out.print(...(ran.length === 0 ? [out.line("skipped", "Nothing needed freshening")] : ran.map((name) => out.line("done", `${name} freshened`))));
  await maybeOfferClaudeHook(parsed.json);
}

// ─── adopt ───────────────────────────────────────────────────────────────────

export async function worktreeAdopt(args: string[], _ctx: unknown): Promise<void> {
  const parsed = parseAdoptArgs(args);
  // Deliberately no cwd fallback: adopt rewrites the whole repo's registry in
  // one sweep, so it must be pointed at explicitly rather than guessed from
  // wherever the shell happens to be.
  if (!parsed.repoName) failText(parsed.json, "--repo <name> is required for adopt", usageFailure("Which repo?", "rt worktree adopt --repo <name>", "This changes every worktree in the repo, so name it."));
  const repoName = await resolveRepo(parsed.json, parsed.repoName);

  const res = await queryDaemon("worktree:adopt", { repoName, claim: parsed.claim }, ADOPT_TIMEOUT_MS);
  const ok = requireQueryResult(parsed.json, res);

  if (parsed.json) { out.json(ok.data, 2); return; }

  const d = ok.data as {
    main: string;
    claimed: string[];
    unmanaged: string[];
    disposed: string[];
    refused: Array<{ tree: string; reason: string; detail?: string }>;
  };
  // Adopt cleans up parked trees on its own, unasked: a tree a guard kept is
  // skipped rather than refused, and one rt failed to move is a warning.
  const left = (r: { tree: string; reason: string; detail?: string }) => {
    const why = disposeReason(r.reason, r.detail);
    return out.line(why.failed ? "warn" : "skipped", `${r.tree} was left as it is`, why.words);
  };
  out.print(
    ...d.claimed.map((name) => out.line("done", name, "now looked after by rt")),
    ...d.unmanaged.map((name) => out.line("skipped", name, "left alone")),
    ...d.refused.map(left),
    out.summary("done", "Adopted this repo's worktrees", [`${d.claimed.length} claimed`, `${d.unmanaged.length} left alone`, `${d.disposed.length} cleaned up`]),
  );
}

// ─── each ────────────────────────────────────────────────────────────────────

function fail(msg: string): never {
  console.log(`  ${red}✗${reset} ${msg}\n`);
  process.exit(1);
}

function loadRepos(): Record<string, string> {
  return loadRepoIndex();
}

/** Bindings from the daemon's registry-aware worktree:list, when it's up. */
async function bindingsFromDaemon(repoName: string): Promise<WorktreeBinding[] | null> {
  const res = await daemonQuery("worktree:list", { repoName });
  if (res === null || !res.ok) return null;
  const rows = (res.data?.trees ?? []) as TreeRow[];
  return rows.map((r) => ({ path: r.path, branch: r.branch, state: r.state, kind: r.kind }));
}

/** Read-only git fallback — each is the one lifecycle command allowed this, since it never mutates. */
function bindingsFromGit(repoPath: string): WorktreeBinding[] {
  return listWorktrees(repoPath).map((w) => ({ path: w.path, branch: w.branch || null }));
}

export async function worktreeEach(args: string[], _ctx: unknown): Promise<void> {
  const parsed = parseEachArgs(args);
  if (parsed.error) fail(parsed.error);

  const identity = getRepoIdentity();
  if (!identity) fail("not in a git repo");

  const repos    = loadRepos();
  const repoPath = repos[identity.identity];
  if (!repoPath) fail(`repo "${identity.repoName}" not registered in ~/.mattstack/rt/repos.json`);

  const bindings = (await bindingsFromDaemon(identity.identity)) ?? bindingsFromGit(repoPath);
  if (bindings.length === 0) {
    console.log(`\n  ${dim}no worktrees in ${identity.repoName}${reset}\n`);
    return;
  }

  let targets: WorktreeBinding[];
  if (parsed.mode === "pick") {
    if (!process.stdin.isTTY) {
      fail("no --all/--on-deck flag and no TTY for the picker — pass --all or --on-deck");
    }
    const pickable = filterTargets(bindings, "pick");
    if (pickable.length === 0) {
      console.log(`\n  ${dim}no worktrees to run in${reset}\n`);
      return;
    }
    const widest  = Math.max(...pickable.map(b => relWorktreeName(repoPath, b.path).length));
    const options = pickable.map(b => ({
      value: b.path,
      label: relWorktreeName(repoPath, b.path).padEnd(widest),
      hint:  b.branch ?? "(detached)",
    }));
    const { filterableMultiselect } = await import("../lib/pick-wrappers.ts");
    const selected = await filterableMultiselect({
      message: `Run "${parsed.command}" in which worktrees? (${identity.repoName})`,
      options,
    });
    if (!selected || selected.length === 0) {
      console.log(`\n  ${dim}nothing selected${reset}\n`);
      return;
    }
    const set = new Set(selected);
    targets = pickable.filter(b => set.has(b.path));
  } else {
    targets = filterTargets(bindings, parsed.mode);
    if (targets.length === 0) {
      const what = parsed.mode === "on-deck" ? "on-deck worktrees" : "worktrees";
      console.log(`\n  ${dim}no ${what} to run in${reset}\n`);
      return;
    }
  }

  console.log("");
  const results: EachResult[] = [];
  for (const b of targets) {
    const name   = relWorktreeName(repoPath, b.path);
    const branch = b.branch ?? "(detached)";
    console.log(`${bold}── ${name}${reset} ${dim}[${branch}]${reset} ${bold}──${reset}`);

    if (!existsSync(b.path)) {
      console.log(`  ${red}✗${reset} ${dim}path no longer exists${reset}\n`);
      results.push({ name, code: 1, reason: "path gone" });
      continue;
    }

    const res = spawnSync("sh", ["-c", parsed.command], { cwd: b.path, stdio: "inherit" });
    const code = res.status ?? 1;
    console.log(code === 0
      ? `  ${green}✓${reset} ${dim}exit 0${reset}\n`
      : `  ${red}✗${reset} ${dim}exit ${code}${reset}\n`);
    results.push({ name, code });
  }

  const summary = formatSummary(results);
  console.log(`  ${hasFailures(results) ? red : green}${summary}${reset}\n`);
  if (hasFailures(results)) process.exit(1);
}

/** Child-process body for hydration: one clonefile(2) of <src> at <dst>. Exit codes are the daemon's contract; see lib/worktree/clonefile.ts. */
export async function worktreeHydrateClone(args: string[], _ctx: unknown): Promise<void> {
  // The daemon reads this verb's stderr. Off a terminal a failure that opens the
  // output prints its title alone, so each line reaches the daemon as written here.
  const [src, dst] = args.filter((a) => !a.startsWith("--"));
  if (!src || !dst || src === dst) {
    out.fail({ title: "usage: rt worktree hydrate-clone <src> <dst>" });
    process.exit(CLONE_EXIT.usage);
  }
  const r = clonePath(src, dst);
  if (!r.ok) out.fail({ title: `clonefile: ${r.message}` });
  process.exit(cloneExitCode(r));
}
