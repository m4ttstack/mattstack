/**
 * Where each tracked repo lives on this Mac: an existing checkout the member
 * pointed at, or the folder a new clone becomes. Answers are staged in rt's
 * own runtime file, so they can be given before and after Install alike.
 */
import { realpathSync } from "fs";
import { dirname, join } from "path";
import { loadRepoIndex, resolveIndexPathForIdentity } from "../repo-index.ts";
import { deriveRepoIdentity, normalizeRemote, serializeIdentity } from "../settings/identity.ts";
import type { Probes } from "./probes.ts";
import { CANDIDATE_ROOT_NAMES, detectCandidate, expandHome } from "./repo-root.ts";

/** The identity's last path segment (`github.com/acme/repo` -> `repo`) — the clone destination's directory name. `board.keys` derives the same registered-repo-name set from tracking identities and must agree with `repos.clone` on what a repo is called. */
export function repoBasename(identity: string): string {
  return identity.split("/").pop() || identity;
}

export type PlacementMode = "checkout" | "clone";
export interface Placement {
  mode: PlacementMode;
  path: string;
}
export interface PlacementsFile {
  placements: Record<string, Placement>;
  deferred: string[];
  failed: Record<string, string>;
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
  const { placements, deferred, failed } = parsed as Record<string, unknown>;
  return {
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
  p.writeFile(target, JSON.stringify(file), 0o600);
  p.chmod(target, 0o600);
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

/** A real clone of `identity`, not just any directory that happens to share its basename — two tracked identities can collide on basename (`gitlab.com/a/api`, `github.com/b/api`), and an unrelated folder can already occupy the path. */
export function isCloneOf(p: Pick<Probes, "readFile">, dest: string, identity: string): boolean {
  const config = p.readFile(join(dest, ".git", "config"));
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
  if (!isCloneOf(p, path, identity)) return false;
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

/** What a row shows before the member touches it, and what `repos.clone` does for a row left untouched. */
export async function defaultPlacement(
  p: Pick<Probes, "home" | "readFile" | "readDir" | "exists">,
  identity: string,
  ctx: { rootPaths: string[]; placedParents: string[] },
): Promise<Placement & { found: boolean }> {
  const found = await findCheckout(p, identity, { rootPaths: ctx.rootPaths });
  if (found) return { mode: "checkout", path: found, found: true };
  const parent = ctx.placedParents[0] ?? ctx.rootPaths[0] ?? detectCandidate(p) ?? join(p.home, "Documents/GitHub");
  return { mode: "clone", path: join(parent, repoBasename(identity)), found: false };
}

/** Every identity's recorded placement, else its default, with checkouts placed first so a new clone lands next to them. */
export async function resolvePlacements(
  p: Pick<Probes, "home" | "readFile" | "readDir" | "exists">,
  identities: string[],
  rootPaths: string[],
): Promise<Record<string, Placement>> {
  const { placements } = readPlacements(p);
  const result: Record<string, Placement> = {};
  for (const identity of identities) {
    const recorded = placements[identity];
    if (recorded) {
      result[identity] = recorded;
      continue;
    }
    const found = await findCheckout(p, identity, { rootPaths });
    if (found) result[identity] = { mode: "checkout", path: found };
  }
  const placedParents = [...new Set(Object.values(result).filter((pl) => pl.mode === "checkout").map((pl) => dirname(pl.path)))];
  for (const identity of identities) {
    if (result[identity]) continue;
    const { mode, path } = await defaultPlacement(p, identity, { rootPaths, placedParents });
    result[identity] = { mode, path };
  }
  return result;
}

function normalize(p: Pick<Probes, "home">, raw: string): string {
  const path = expandHome(p, raw.trim());
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

function tildify(home: string, path: string): string {
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

export async function checkCheckout(p: Pick<Probes, "home" | "readFile" | "readDir" | "exists">, identity: string, raw: string, tracked: string[] = []): Promise<CheckoutCheck> {
  const base = repoBasename(identity);
  const path = normalize(p, raw);
  const shown = tildify(p.home, path);
  if (path === "") return { ok: false, detail: "No folder given" };
  const real = realPath(path);
  if (await isReusableCloneOf(p, real, identity)) return { ok: true, path };

  if (p.exists(join(real, ".git"))) {
    try {
      const other = await deriveRepoIdentity(real);
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
