/**
 * Where the board's review, respond and doctor agents start (`board.cwds`):
 * the local path of the board's repo. Install and a placement change write it
 * through `board.cwds`; the setup migration for Macs already set up writes it
 * through the same plan.
 */

export type BoardCwds = { review: string; respond: string; doctor: string };

const KEYS = ["review", "respond", "doctor"] as const;

function withoutHost(identity: string): string {
  const slash = identity.indexOf("/");
  return slash < 0 ? identity : identity.slice(slash + 1);
}

/** The first `board.projects` entry's tracked identity, matched by path with the host dropped; a project two identities match picks none. */
export function boardRepoIdentity(projects: unknown, tracked: string[]): string | null {
  if (!Array.isArray(projects) || projects.length === 0) return tracked[0] ?? null;
  const first: unknown = projects[0];
  if (typeof first !== "string") return null;
  const matches = tracked.filter((identity) => withoutHost(identity) === first);
  return matches.length === 1 ? matches[0]! : null;
}

export type BoardCwdsPlan = { write: BoardCwds } | { leave: "current" | "hand-set" | "no-repo" };

function sameCwds(a: Partial<BoardCwds> | undefined, b: Partial<BoardCwds> | undefined): boolean {
  return a !== undefined && b !== undefined && KEYS.every((k) => a[k] === b[k]);
}

export function isEmptyCwds(cwds: Partial<BoardCwds> | undefined): boolean {
  return cwds === undefined || KEYS.every((k) => !cwds[k]);
}

/** All three on one path is the shape the old setup step wrote, always the first tracked repo. */
function isUniform(cwds: Partial<BoardCwds> | undefined): boolean {
  return cwds !== undefined && KEYS.every((k) => cwds[k] === cwds.review);
}

/**
 * A value that cannot work (a field missing, gone, or not a checkout of a
 * tracked repo) or one in the shape the old setup step wrote. The migration
 * has no record of what rt wrote, so this is how it tells rt's value from
 * the member's.
 */
export function isOldRtValue(current: Partial<BoardCwds> | undefined, exists: (path: string) => boolean, isTrackedCheckout: (path: string) => boolean): boolean {
  const broken = KEYS.some((k) => {
    const path = current?.[k];
    return !path || !exists(path) || !isTrackedCheckout(path);
  });
  return broken || isUniform(current);
}

/** Install replaces only an empty value or the one rt wrote last, so a value the member set by hand stays. */
export function planBoardCwds(i: {
  current: Partial<BoardCwds> | undefined;
  rtWrote: Partial<BoardCwds> | undefined;
  target: string | null;
  mode: "install" | "migration";
  exists: (path: string) => boolean;
  isTrackedCheckout: (path: string) => boolean;
}): BoardCwdsPlan {
  if (i.target === null) return { leave: "no-repo" };
  const write: BoardCwds = { review: i.target, respond: i.target, doctor: i.target };
  if (sameCwds(i.current, write)) return { leave: "current" };

  if (i.mode === "install") {
    return isEmptyCwds(i.current) || sameCwds(i.current, i.rtWrote) ? { write } : { leave: "hand-set" };
  }
  return isOldRtValue(i.current, i.exists, i.isTrackedCheckout) ? { write } : { leave: "hand-set" };
}
