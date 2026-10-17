/**
 * Where each tracked repo lives on this Mac: an existing checkout the member
 * pointed at, or the folder a new clone becomes. Answers are staged in rt's
 * own runtime file, so they can be given before and after Install alike.
 */
import { realpathSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { loadRepoIndex, resolveIndexPathForIdentity } from "../repo-index.ts";
import { deriveRepoIdentity, normalizeRemote, serializeIdentity } from "../settings/identity.ts";
import { getSetting } from "../settings/resolve.ts";
import { listOrgs } from "../settings/stores.ts";
import { orgRefFromIntent, readIntent } from "./intent.ts";
import type { PlacementMode } from "./contract.ts";
import type { Probes } from "./probes.ts";
import { readTeamSnapshot } from "./team-settings.ts";
import { CANDIDATE_ROOT_NAMES, detectCandidate, expandHome } from "./repo-root.ts";

/** The identity's last path segment (`github.com/acme/repo` -> `repo`) — the clone destination's directory name. `board.keys` derives the same registered-repo-name set from tracking identities and must agree with `repos.clone` on what a repo is called. */
export function repoBasename(identity: string): string {
  return identity.split("/").pop() || identity;
}

export interface Placement {
  mode: PlacementMode;
  path: string;
}
export interface PlacementsFile {
  placements: Record<string, Placement>;
  deferred: string[];
  /** The sentence a deferred repo's row shows for its last failed placement. */
  failed: Record<string, string>;
  /** Set when team.join lands: the setup intent that marks a joiner is gone by the time a resumed Install reaches `repos.clone`. */
  joining?: true;
}

export function placementsPath(home: string): string {
  return join(home, ".mattstack", "rt", "repo-placements.json");
}

function isPlacement(v: unknown): v is Placement {
  if (typeof v !== "object" || v === null) return false;
  const { mode, path } = v as Record<string, unknown>;
  return (mode === "checkout" || mode === "clone") && typeof path === "string" && path !== "";
}

export function readPlacements(p: Pick<Probes, "home" | "readFile">): PlacementsFile {
  const empty: PlacementsFile = { placements: {}, deferred: [], failed: {} };
  const raw = p.readFile(placementsPath(p.home));
  if (raw === null) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null) return empty;
  const { placements, deferred, failed, joining } = parsed as Record<string, unknown>;
  return {
    ...(joining === true ? { joining: true as const } : {}),
    placements: Object.fromEntries(Object.entries(typeof placements === "object" && placements !== null ? placements : {}).filter(([, v]) => isPlacement(v))) as Record<string, Placement>,
    deferred: Array.isArray(deferred) ? deferred.filter((d): d is string => typeof d === "string") : [],
    failed: Object.fromEntries(Object.entries(typeof failed === "object" && failed !== null ? failed : {}).filter(([, v]) => typeof v === "string")) as Record<string, string>,
  };
}

function updatePlacements(p: Probes, change: (file: PlacementsFile) => void): void {
  const file = readPlacements(p);
  change(file);
  const target = placementsPath(p.home);
  p.mkdirp(dirname(target));
  // A torn read parses as empty, and the next write from it would erase every deferral.
  const tmp = `${target}.${process.pid}.tmp`;
  p.writeFile(tmp, JSON.stringify(file), 0o600);
  p.chmod(tmp, 0o600);
  p.rename(tmp, target);
}

/** Leaves `deferred` alone: only `repos.clone` clears a deferral, once the repo lands. */
export function writePlacement(p: Probes, identity: string, placement: Placement): void {
  updatePlacements(p, (f) => {
    f.placements[identity] = { mode: placement.mode, path: placement.path };
  });
}

export function clearPlacement(p: Probes, identity: string): void {
  updatePlacements(p, (f) => {
    delete f.placements[identity];
  });
}

export function markDeferred(p: Probes, identity: string): void {
  updatePlacements(p, (f) => {
    if (!f.deferred.includes(identity)) f.deferred.push(identity);
  });
}

export function clearDeferred(p: Probes, identity: string): void {
  updatePlacements(p, (f) => {
    f.deferred = f.deferred.filter((d) => d !== identity);
  });
}

export function markJoining(p: Probes): void {
  updatePlacements(p, (f) => {
    f.joining = true;
  });
}

export function clearJoining(p: Probes): void {
  if (!readPlacements(p).joining) return;
  updatePlacements(p, (f) => {
    delete f.joining;
  });
}

export function recordCloneFailure(p: Probes, identity: string, reason: string): void {
  updatePlacements(p, (f) => {
    f.failed[identity] = reason;
  });
}

export function clearCloneFailure(p: Probes, identity: string): void {
  updatePlacements(p, (f) => {
    delete f.failed[identity];
  });
}

/** A linked worktree's `.git` is a file naming its own git dir, whose `commondir` leads to the git dir the main checkout shares. Null for a main checkout. */
function linkedGitDirs(p: Pick<Probes, "readFile">, dest: string): { gitDir: string; commonDir: string } | null {
  const pointer = p.readFile(join(dest, ".git"))?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
  if (!pointer) return null;
  const gitDir = resolve(dest, pointer);
  const common = p.readFile(join(gitDir, "commondir"))?.trim();
  return { gitDir, commonDir: common ? resolve(gitDir, common) : gitDir };
}

function gitConfigPath(p: Pick<Probes, "readFile">, dest: string): string {
  return join(linkedGitDirs(p, dest)?.commonDir ?? join(dest, ".git"), "config");
}

/**
 * The main checkout a linked worktree belongs to, or null when `dest` is not
 * a linked worktree. `rt worktree` and the repo index treat the placed folder
 * as the canonical checkout, so a linked worktree can never be one.
 */
export function linkedWorktreeMain(p: Pick<Probes, "readFile">, dest: string): { main: string | null } | null {
  const dirs = linkedGitDirs(p, dest);
  if (!dirs) return null;
  return { main: basename(dirs.commonDir) === ".git" ? dirname(dirs.commonDir) : null };
}

/** A real clone of `identity`, not just any directory that happens to share its basename — two tracked identities can collide on basename (`gitlab.com/a/api`, `github.com/b/api`), and an unrelated folder can already occupy the path. */
export function isCloneOf(p: Pick<Probes, "readFile">, dest: string, identity: string): boolean {
  const config = p.readFile(gitConfigPath(p, dest));
  if (config === null) return false;
  // Any remote's URL, in whatever form git accepts (scp-style ssh has no slash after the host), normalized to the identity's own host/path form.
  for (const match of config.matchAll(/^\s*url\s*=\s*(\S+)/gm)) {
    if (normalizeRemote(match[1]!) === identity) return true;
  }
  return false;
}

/**
 * `isCloneOf` is only a prefilter: any `url =` line matches it, so a fork
 * whose `upstream` is the tracked repo, or a superproject carrying it as a
 * submodule, would pass. The repo's own derived identity (origin) decides.
 */
export async function isReusableCloneOf(p: Pick<Probes, "readFile">, path: string, identity: string): Promise<boolean> {
  if (linkedWorktreeMain(p, path) || !isCloneOf(p, path, identity)) return false;
  try {
    return serializeIdentity(await deriveRepoIdentity(path)) === serializeIdentity({ kind: "remote", id: identity });
  } catch {
    return false;
  }
}

function inferredRoots(): string[] {
  try {
    return Object.values(loadRepoIndex()).map((path) => dirname(path));
  } catch {
    return [];
  }
}

/** The index row, then direct children of the configured roots, the usual repo folders under home, and the folders already-indexed repos sit in. */
export async function findCheckout(p: Pick<Probes, "home" | "readFile" | "readDir">, identity: string, opts: { rootPaths: string[] }): Promise<string | null> {
  const indexed = await resolveIndexPathForIdentity(serializeIdentity({ kind: "remote", id: identity }));
  if (indexed && (await isReusableCloneOf(p, indexed, identity))) return indexed;
  const roots = [...new Set([...opts.rootPaths, ...CANDIDATE_ROOT_NAMES.map((rel) => join(p.home, rel)), ...inferredRoots()])];
  for (const root of roots) {
    for (const child of p.readDir(root)) {
      const candidate = join(root, child);
      if (await isReusableCloneOf(p, candidate, identity)) return candidate;
    }
  }
  return null;
}

/** Where a new clone goes when nothing was found or recorded for the repo. */
export function defaultClonePath(p: Pick<Probes, "home" | "exists">, identity: string, ctx: { rootPaths: string[]; placedParents: string[] }): string {
  const parent = ctx.placedParents[0] ?? ctx.rootPaths[0] ?? detectCandidate(p) ?? join(p.home, "Documents/GitHub");
  return join(parent, repoBasename(identity));
}

/** What a row shows before the member touches it, and what `repos.clone` does for a row left untouched. */
export async function defaultPlacement(
  p: Pick<Probes, "home" | "readFile" | "readDir" | "exists">,
  identity: string,
  ctx: { rootPaths: string[]; placedParents: string[] },
): Promise<Placement & { found: boolean }> {
  const found = await findCheckout(p, identity, { rootPaths: ctx.rootPaths });
  if (found) return { mode: "checkout", path: found, found: true };
  return { mode: "clone", path: defaultClonePath(p, identity, ctx), found: false };
}

export type PlacementSource = "recorded" | "found" | "default";
export type ResolvedPlacement = Placement & { source: PlacementSource };

/** Every identity's recorded placement, else its found checkout, else its default clone next to the placed checkouts. */
export async function resolvePlacements(
  p: Pick<Probes, "home" | "readFile" | "readDir" | "exists">,
  identities: string[],
  rootPaths: string[],
): Promise<Record<string, ResolvedPlacement>> {
  const { placements } = readPlacements(p);
  const result: Record<string, ResolvedPlacement> = {};
  for (const identity of identities) {
    const recorded = placements[identity];
    if (recorded) {
      result[identity] = { ...recorded, source: "recorded" };
      continue;
    }
    const found = await findCheckout(p, identity, { rootPaths });
    if (found) result[identity] = { mode: "checkout", path: found, source: "found" };
  }
  const placedParents = [...new Set(Object.values(result).filter((pl) => pl.mode === "checkout").map((pl) => dirname(pl.path)))];
  for (const identity of identities) {
    if (result[identity]) continue;
    result[identity] = { mode: "clone", path: defaultClonePath(p, identity, { rootPaths, placedParents }), source: "default" };
  }
  return result;
}

/**
 * The paths `identity` may not clone into: every other repo's recorded or
 * found folder, and the default of a repo earlier in `identities`. When two
 * repos share a basename, the first keeps the default and the second's row
 * shows the clash.
 */
export function takenFor(resolved: Record<string, ResolvedPlacement>, identities: string[], identity: string): { identity: string; path: string }[] {
  const position = identities.indexOf(identity);
  return identities
    .filter((other, i) => other !== identity && resolved[other] && (resolved[other]!.source !== "default" || position < 0 || i < position))
    .map((other) => ({ identity: other, path: resolved[other]!.path }));
}

/** The active team's tracked repos, the same list `repos.clone` places. */
export function trackedIdentities(p: Probes): string[] {
  const ref = orgRefFromIntent(readIntent(p), listOrgs());
  return ref.slug ? readTeamSnapshot(p, ref.slug).trackingIdentities : [];
}

/** `rt.repoRoots`, `~` expanded; an unresolvable value (an authored `${repoRoot}`) reads as none rather than throwing. */
export function configuredRepoRoots(p: Pick<Probes, "home">): string[] {
  try {
    return (getSetting<string[]>("rt.repoRoots").value ?? []).map((r) => expandHome(p, r));
  } catch {
    return [];
  }
}

function normalize(p: Pick<Probes, "home">, raw: string): string {
  const trimmed = raw.trim();
  return trimmed === "" ? "" : resolve(expandHome(p, trimmed));
}

export function tildify(home: string, path: string): string {
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export type CheckoutCheck = { ok: true; path: string } | { ok: false; detail: string };

export async function checkCheckout(p: Pick<Probes, "home" | "readFile" | "readDir" | "exists">, identity: string, raw: string, opts: { tracked: string[] }): Promise<CheckoutCheck> {
  const { tracked } = opts;
  const base = repoBasename(identity);
  const path = normalize(p, raw);
  const shown = tildify(p.home, path);
  if (path === "") return { ok: false, detail: "No folder given" };
  const real = realPath(path);
  if (await isReusableCloneOf(p, real, identity)) return { ok: true, path };

  if (p.exists(join(real, ".git"))) {
    try {
      const other = await deriveRepoIdentity(real);
      const linked = linkedWorktreeMain(p, real);
      if (linked && other.kind === "remote" && other.id === identity) {
        return linked.main
          ? { ok: false, detail: `${shown} is a worktree of ${base}. Choose your main checkout at ${tildify(p.home, linked.main)}.` }
          : { ok: false, detail: `${shown} is a worktree of ${base}. Choose your main checkout.` };
      }
      if (other.kind === "remote" && other.id !== identity) {
        return tracked.includes(other.id)
          ? { ok: false, detail: `${shown} is your ${repoBasename(other.id)} checkout, not ${base}.` }
          : { ok: false, detail: `${shown} is a checkout of ${other.id}, not ${base}.` };
      }
    } catch {
      // An unreadable repo reads as no checkout at all.
    }
  } else if (p.readDir(real).some((child) => p.exists(join(real, child, ".git")))) {
    return { ok: false, detail: `${shown} holds repos but isn't one. Choose the ${base} folder inside it.` };
  }
  return { ok: false, detail: `${shown} isn't a git checkout.` };
}

export function checkCloneTarget(p: Pick<Probes, "home" | "statPath" | "readDir">, raw: string, taken: { identity: string; path: string }[]): CheckoutCheck {
  const path = normalize(p, raw);
  const shown = tildify(p.home, path);
  if (path === "") return { ok: false, detail: "No folder given" };
  const owner = taken.find((t) => normalize(p, t.path) === path);
  if (owner) return { ok: false, detail: `${shown} is where ${repoBasename(owner.identity)} goes. Choose another folder.` };
  const stat = p.statPath(path);
  if (stat !== null && (!stat.isDirectory || p.readDir(path).length > 0)) {
    return { ok: false, detail: `${shown} already exists. Choose an empty or new folder.` };
  }
  return { ok: true, path };
}
