/**
 * Which session holds which pool worktree, and the lifecycle events a
 * harness reports for it (enter, relocate, leave).
 *
 * The pool itself is untouched: claims, repo identity, hydrate stamps and
 * volume rules stay with lib/worktree and the daemon. This module keeps one
 * record per claimed tree naming the caller that claimed it through rt (a
 * native create hook or the explicit provision operation), and an event is
 * authorized only against that record. A record holds only while the tree
 * is still the same claim (same repo, name and claimedAt), so a path the
 * pool reuses never carries an old owner forward.
 */

import type { Database } from "bun:sqlite";
import type { CallerContext, HarnessId, Outcome } from "../../packages/rt-client/src/agent-integrations.ts";
import type { WorktreeProvisionData } from "../../packages/rt-client/src/commands.ts";
import { canon } from "../fs-canon.ts";
import { getStateDb } from "../state/db.ts";
import { getKvValue, listKvValues, setKvValueCritical } from "../state/kv-blob.ts";
import { findTreeByPath, loadRegistry, type TreeKind, type TreeState } from "../worktree/registry.ts";
import { codexWorktreeLifecycle } from "./codex/worktrees.ts";

export type WorktreeEvent = { kind: "enter" | "leave" | "relocate"; path: string };

/** "native": the harness reports create/remove itself. "explicit": its sessions call rt's provision and dispose. */
export type WorktreeLifecycle = "native" | "explicit";

export type ManagedTree = {
  repoName: string; name: string; path: string; kind: TreeKind; state?: TreeState; claimedAt?: string;
};

export type ProvisionRequest = {
  repoName: string; ticket?: string; ticketTitle?: string; branch?: string; disposal?: "merge" | "job"; owner?: string;
};

export type ProvisionedTree = Pick<WorktreeProvisionData, "tree" | "path"> & Partial<WorktreeProvisionData>;

export type WorktreeHolder = {
  owner: string; bindingKey: string; attemptId?: string; harness: HarnessId;
  repoName: string; tree: string; path: string; claimedAt: string | null;
  readRoots: string[]; current: boolean; enteredAt: number;
  leavingAt?: number; disposedAt?: number;
};

export type WorktreeDeps = {
  db?: Database;
  findTree?: (path: string) => ManagedTree | null;
  findTreeByName?: (repoName: string, name: string) => ManagedTree | null;
  dispose?: (tree: ManagedTree) => Promise<Outcome<void>>;
  provision?: (request: ProvisionRequest) => Promise<Outcome<ProvisionedTree>>;
  now?: () => number;
};

const NS = "agent-worktrees";
const DISPOSE_TIMEOUT_MS = 120_000;
const PROVISION_TIMEOUT_MS = 300_000;

const LIFECYCLES: Partial<Record<HarnessId, WorktreeLifecycle>> = { claude: "native", codex: codexWorktreeLifecycle };

export function worktreeLifecycle(harness: HarnessId): WorktreeLifecycle {
  return LIFECYCLES[harness] ?? "explicit";
}

/** One owner per binding and attempt: a resumed attempt keeps it, a replacement attempt on the same binding does not. */
export function worktreeOwner(context: CallerContext): string {
  return ownerOf(context.binding.key, context.assignment?.attemptId ?? context.binding.attemptId);
}

function ownerOf(bindingKey: string, attemptId: string | undefined): string {
  return attemptId !== undefined ? `binding:${bindingKey}:attempt:${attemptId}` : `binding:${bindingKey}`;
}

function fail<T>(code: "refused" | "transient" | "invalid", message: string): Outcome<T> {
  return { ok: false, error: { code, message } };
}

function toManaged(repoName: string, rec: { name: string; path: string; kind: TreeKind; state?: TreeState; claimedAt?: string }): ManagedTree {
  return {
    repoName, name: rec.name, path: rec.path, kind: rec.kind,
    ...(rec.state !== undefined && { state: rec.state }), ...(rec.claimedAt !== undefined && { claimedAt: rec.claimedAt }),
  };
}

function registryTreeByName(repoName: string, name: string): ManagedTree | null {
  const rec = loadRegistry(repoName).find((t) => t.name === name);
  return rec ? toManaged(repoName, rec) : null;
}

function registryTree(path: string): ManagedTree | null {
  const hit = findTreeByPath(path) ?? findTreeByPath(canon(path));
  return hit ? registryTreeByName(hit.repoName, hit.tree) : null;
}

async function daemonDispose(tree: ManagedTree): Promise<Outcome<void>> {
  const { daemonQuery } = await import("../daemon-client.ts");
  const { explainError } = await import("../explain-error.ts");
  const res = await daemonQuery("worktree:dispose", { repoName: tree.repoName, tree: tree.name, force: false, callerPid: process.pid }, DISPOSE_TIMEOUT_MS);
  if (res === null) return fail("transient", "the rt daemon did not answer");
  if (!res.ok) return fail("refused", explainError(res.error ?? "unknown error"));
  const refused = (res.data as { refused?: Array<{ tree: string; reason: string }> }).refused?.find((r) => r.tree === tree.name);
  return refused ? fail("refused", explainError(refused.reason)) : { ok: true, data: undefined };
}

async function daemonProvision(request: ProvisionRequest): Promise<Outcome<ProvisionedTree>> {
  const { daemonQuery } = await import("../daemon-client.ts");
  const res = await daemonQuery("worktree:provision", request, PROVISION_TIMEOUT_MS);
  if (res === null) return fail("transient", "the rt daemon did not answer");
  return res.ok ? { ok: true, data: res.data as WorktreeProvisionData } : fail("refused", res.error ?? "unknown error");
}

function resolved(deps: WorktreeDeps) {
  return {
    db: deps.db ?? getStateDb(),
    findTree: deps.findTree ?? registryTree,
    findTreeByName: deps.findTreeByName ?? registryTreeByName,
    dispose: deps.dispose ?? daemonDispose,
    provision: deps.provision ?? daemonProvision,
    now: deps.now ?? Date.now,
  };
}

function readHolder(db: Database, path: string): WorktreeHolder | null {
  return getKvValue<WorktreeHolder | null>(NS, path, null, db);
}

function writeHolder(db: Database, holder: WorktreeHolder): boolean {
  return setKvValueCritical(NS, holder.path, holder, db);
}

/** The record still names this tree's current claim; a disposed or re-claimed tree's record grants nothing. */
function holds(holder: WorktreeHolder | null, tree: ManagedTree): holder is WorktreeHolder {
  return holder !== null && holder.disposedAt === undefined
    && holder.repoName === tree.repoName && holder.tree === tree.name
    && tree.state === "claimed" && holder.claimedAt === (tree.claimedAt ?? null);
}

function claimable(tree: ManagedTree | null, path: string): Outcome<ManagedTree> {
  if (!tree) return fail("refused", `${path} is not a worktree rt manages`);
  if (tree.kind !== "ephemeral" || tree.state !== "claimed") return fail("refused", `${tree.name} is not a claimed worktree`);
  return { ok: true, data: tree };
}

/** Only one tree is a session's current one; moving into another clears the rest. */
function makeCurrent(db: Database, owner: string, path: string): void {
  for (const holder of Object.values(listKvValues<WorktreeHolder>(NS, db))) {
    if (holder.owner === owner && holder.current && holder.path !== path) writeHolder(db, { ...holder, current: false });
  }
}

/**
 * Records that the caller holds a tree it just claimed through rt. Refuses a
 * tree another session holds; a stale record (the tree was disposed or
 * claimed again since) is replaced.
 */
export function claimWorktree(
  context: CallerContext, path: string, opts: { readRoots?: string[] } = {}, deps: WorktreeDeps = {},
): Outcome<WorktreeHolder> {
  const d = resolved(deps);
  const tree = claimable(d.findTree(path), path);
  if (!tree.ok) return tree;
  const owner = worktreeOwner(context);
  const existing = readHolder(d.db, tree.data.path);
  if (holds(existing, tree.data) && existing.owner !== owner) {
    return fail("refused", `${tree.data.name} belongs to another session`);
  }
  const attemptId = context.assignment?.attemptId ?? context.binding.attemptId;
  const holder: WorktreeHolder = {
    owner, bindingKey: context.binding.key, ...(attemptId !== undefined && { attemptId }),
    harness: context.binding.native.harness, repoName: tree.data.repoName, tree: tree.data.name, path: tree.data.path,
    claimedAt: tree.data.claimedAt ?? null, readRoots: opts.readRoots ?? existing?.readRoots ?? [],
    current: true, enteredAt: d.now(),
  };
  if (!writeHolder(d.db, holder)) return fail("transient", `rt could not record that this session holds ${tree.data.name}`);
  makeCurrent(d.db, owner, holder.path);
  return { ok: true, data: holder };
}

/** The shared explicit operation: provision through rt, then record the caller as the tree's holder. */
export async function provisionWorktree(
  context: CallerContext, request: ProvisionRequest, deps: WorktreeDeps = {}, opts: { readRoots?: string[] } = {},
): Promise<Outcome<ProvisionedTree>> {
  const provisioned = await resolved(deps).provision(request);
  if (!provisioned.ok) return provisioned;
  const held = claimWorktree(context, provisioned.data.path, opts, deps);
  if (held.ok) return provisioned;
  return fail(held.error.code === "transient" ? "transient" : "refused", `${held.error.message}; the tree was provisioned at ${provisioned.data.path}`);
}

/**
 * Applies a lifecycle event for the caller. A tree the caller does not hold
 * refuses (an unrelated pool member, or one held by another session or
 * attempt). A leave disposes once: a repeated or racing leave of a tree
 * already disposed, or being disposed, succeeds without disposing again.
 * Leaving a path the pool does not hold (a stock tree, or one already gone)
 * has nothing of rt's to dispose, as on the hook's own path.
 */
export async function applyWorktreeEvent(context: CallerContext, event: WorktreeEvent, deps: WorktreeDeps = {}): Promise<Outcome<void>> {
  const d = resolved(deps);
  const owner = worktreeOwner(context);
  const tree = d.findTree(event.path);
  const key = tree?.path ?? event.path;
  const holder = readHolder(d.db, key) ?? (tree ? null : readHolder(d.db, canon(event.path)));

  if (event.kind === "leave" && holder?.owner === owner && holder.disposedAt !== undefined) return { ok: true, data: undefined };
  if (event.kind === "leave" && !tree) {
    if (holder?.owner === owner) writeHolder(d.db, { ...holder, current: false, disposedAt: d.now() });
    return { ok: true, data: undefined };
  }
  const claimed = claimable(tree, event.path);
  if (!claimed.ok) return claimed;
  if (!holds(holder, claimed.data) || holder.owner !== owner) {
    return fail("refused", `${claimed.data.name} is not held by this session`);
  }

  if (event.kind !== "leave") {
    if (!writeHolder(d.db, { ...holder, current: true, enteredAt: d.now() })) return fail("transient", `rt could not record the move into ${claimed.data.name}`);
    makeCurrent(d.db, owner, holder.path);
    return { ok: true, data: undefined };
  }

  if (!startLeave(d.db, holder.path, owner, d.now())) return { ok: true, data: undefined };
  const disposed = await d.dispose(claimed.data);
  const latest = readHolder(d.db, holder.path) ?? holder;
  const { leavingAt: _, ...rest } = latest;
  writeHolder(d.db, disposed.ok ? { ...rest, current: false, disposedAt: d.now() } : rest);
  return disposed;
}

/** Marks a leave in flight, under a write lock so two processes cannot both start one. False: another leave got there first. */
function startLeave(db: Database, path: string, owner: string, now: number): boolean {
  return db.transaction(() => {
    const holder = readHolder(db, path);
    if (!holder || holder.owner !== owner || holder.leavingAt !== undefined || holder.disposedAt !== undefined) return false;
    return writeHolder(db, { ...holder, leavingAt: now });
  }).immediate();
}

/** Notes a dispose the caller made through rt's explicit operation, so a later leave does not dispose again. */
export function settleDisposed(context: CallerContext, tree: ManagedTree, deps: WorktreeDeps = {}): void {
  const d = resolved(deps);
  const holder = readHolder(d.db, tree.path);
  if (holder?.owner === worktreeOwner(context) && holder.disposedAt === undefined) {
    writeHolder(d.db, { ...holder, current: false, disposedAt: d.now() });
  }
}

export function findManagedTree(repoName: string, name: string, deps: WorktreeDeps = {}): ManagedTree | null {
  return resolved(deps).findTreeByName(repoName, name);
}

/** The session that holds a tree, when it is not the caller; null when the caller holds it or nobody does. */
export function foreignHolder(context: CallerContext, tree: ManagedTree, deps: WorktreeDeps = {}): WorktreeHolder | null {
  const holder = readHolder(resolved(deps).db, tree.path);
  return holds(holder, tree) && holder.owner !== worktreeOwner(context) ? holder : null;
}

function currentFor(owner: string, d: ReturnType<typeof resolved>): WorktreeHolder | null {
  const mine = Object.values(listKvValues<WorktreeHolder>(NS, d.db)).filter((h) => h.owner === owner && h.current);
  const live = mine.filter((h) => {
    const tree = d.findTree(h.path);
    return tree !== null && holds(h, tree);
  });
  return live.sort((a, b) => b.enteredAt - a.enteredAt)[0] ?? null;
}

/** The tree the caller is working in, while it still holds it. */
export function currentWorktree(context: CallerContext, deps: WorktreeDeps = {}): WorktreeHolder | null {
  return currentFor(worktreeOwner(context), resolved(deps));
}

/**
 * What a resumed session needs to keep working where it left off: the tree
 * it holds, and the read roots it was granted, plus that tree when the
 * session is launched from somewhere else.
 */
export function resumeWorktreeAccess(
  binding: { key: string; attemptId?: string }, launchCwd: string, deps: WorktreeDeps = {},
): { worktree?: string; readRoots: string[] } {
  const holder = currentFor(ownerOf(binding.key, binding.attemptId), resolved(deps));
  if (!holder) return { readRoots: [] };
  const inside = launchCwd === holder.path || launchCwd.startsWith(`${holder.path}/`);
  const readRoots = inside || holder.readRoots.includes(holder.path) ? holder.readRoots : [...holder.readRoots, holder.path];
  return { worktree: holder.path, readRoots };
}
