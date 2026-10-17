/**
 * "Your repos": one row per tracked repo, saying where it lives on this Mac or
 * where its clone goes. The rows and `rt setup repo place` resolve placements
 * and clashes through the same functions, so they never disagree. A joiner
 * sees no rows before Install (no tracked list yet); a repo Install left for
 * them comes back here finish-gated.
 */
import { dirname, join } from "path";
import { resolveIndexPathForIdentity } from "../../repo-index.ts";
import { serializeIdentity } from "../../settings/identity.ts";
import { REPO_PLACE_ROW_PREFIX, row, type Action, type OrgRef, type PlacementMode, type Row, type RowStatus } from "../contract.ts";
import type { Probes } from "../probes.ts";
import {
  checkCheckout,
  checkCloneTarget,
  configuredRepoRoots,
  defaultClonePath,
  isReusableCloneOf,
  readPlacements,
  repoBasename,
  resolvePlacements,
  takenFor,
  tildify,
  type ResolvedPlacement,
} from "../repo-placement.ts";
import { detectCandidate } from "../repo-root.ts";
import { homeGitDir } from "../steps/home.ts";
import { skippedIdentities } from "../steps/repos.ts";
import type { TeamSnapshot } from "../team-settings.ts";

type PlaceRepo = Extract<Action, { type: "place-repo" }>;

const CLONES_AT_INSTALL = "rt clones it here when you click Install";

async function indexedCheckout(p: Probes, identity: string): Promise<string | null> {
  const indexed = await resolveIndexPathForIdentity(serializeIdentity({ kind: "remote", id: identity }));
  return indexed && (await isReusableCloneOf(p, indexed, identity)) ? indexed : null;
}

interface RowState {
  status: RowStatus;
  mode: PlacementMode;
  checkoutPath: string | null;
  clonePath: string;
  note: string;
  problem: string | null;
  oneClick: PlaceRepo["oneClick"];
  gated: boolean;
}

export async function repoPlacementRows(p: Probes, _team: OrgRef, snapshot: TeamSnapshot): Promise<Row[]> {
  const tracked = snapshot.trackingIdentities;
  const skip = skippedIdentities(p.env);
  const shown = tracked.filter((identity) => !skip.has(identity) && !skip.has(repoBasename(identity)));
  if (shown.length === 0) return [];

  const rootPaths = configuredRepoRoots(p);
  const resolved = await resolvePlacements(p, tracked, rootPaths);
  const { placements, deferred, failed } = readPlacements(p);
  const placedParents = [...new Set(Object.values(resolved).filter((pl) => pl.mode === "checkout").map((pl) => dirname(pl.path)))];
  const installed = p.exists(homeGitDir(p.home));
  const then = installed ? ["setup", "apply", "--only", "repos.clone"] : null;
  const taken = (identity: string) => takenFor(resolved, tracked, identity);

  /** A checkout row's other segment: the first folder rt would clone into that is free and is not the checkout itself, else the default's name with the first free `-<n>` suffix. */
  function cloneAlternative(identity: string, checkoutPath: string): string {
    const free = (path: string) => path !== checkoutPath && checkCloneTarget(p, path, taken(identity)).ok;
    const parents = [...placedParents, ...rootPaths, detectCandidate(p), join(p.home, "Documents/GitHub")].filter((parent): parent is string => parent !== null);
    for (const parent of new Set(parents)) {
      const path = join(parent, repoBasename(identity));
      if (free(path)) return path;
    }
    const fallback = defaultClonePath(p, identity, { rootPaths, placedParents });
    for (let n = 2; ; n++) {
      if (free(`${fallback}-${n}`)) return `${fallback}-${n}`;
    }
  }

  async function stateOf(identity: string, placement: ResolvedPlacement): Promise<RowState> {
    const base = repoBasename(identity);
    const clonePath = placement.mode === "clone" ? placement.path : cloneAlternative(identity, placement.path);
    const checkoutPath = placement.mode === "checkout" ? placement.path : null;
    const shape = { mode: placement.mode, checkoutPath, clonePath, problem: null, oneClick: null, gated: false };
    const indexed = await indexedCheckout(p, identity);
    const found = `Found your ${base} checkout`;

    if (deferred.includes(identity) && !indexed) {
      const gated = { ...shape, status: "needs-you" as const, gated: true };
      const recorded = placements[identity];
      if (!recorded) {
        const note = "Choose where your repos go";
        const target = checkCloneTarget(p, clonePath, taken(identity));
        if (!target.ok) return { ...gated, note, problem: target.detail };
        return { ...gated, note, oneClick: { label: "Clone here", mode: "clone", path: clonePath } };
      }
      const lastFailure = failed[identity];
      if (lastFailure !== undefined) return { ...gated, note: lastFailure, oneClick: { label: "Retry", mode: recorded.mode, path: recorded.path } };
      const where = tildify(p.home, recorded.path);
      return { ...gated, note: recorded.mode === "clone" ? `rt clones it to ${where} next` : `rt uses your checkout at ${where} next` };
    }

    // A recorded answer comes before the index, the order `repos.clone` follows.
    if (placement.source !== "recorded" && indexed) return { ...shape, status: "ready", mode: "checkout", checkoutPath: indexed, clonePath: cloneAlternative(identity, indexed), note: found };
    if (placement.mode === "checkout") {
      const check = await checkCheckout(p, identity, placement.path, { tracked });
      if (check.ok) return { ...shape, status: "ready", note: found };
      return { ...shape, status: "needs-you", note: check.detail, problem: check.detail };
    }
    const target = checkCloneTarget(p, placement.path, taken(identity));
    if (!target.ok) return { ...shape, status: "needs-you", note: target.detail, problem: target.detail };
    return { ...shape, status: "ready", note: CLONES_AT_INSTALL };
  }

  return Promise.all(
    shown.map(async (identity) => {
      const base = repoBasename(identity);
      const s = await stateOf(identity, resolved[identity]!);
      const label = s.mode === "clone" ? "Choose location…" : s.problem ? "Locate again…" : "Locate…";
      const action: PlaceRepo = {
        type: "place-repo",
        label,
        identity,
        repo: base,
        mode: s.mode,
        checkoutPath: s.checkoutPath,
        clonePath: s.clonePath,
        note: s.note,
        problem: s.problem,
        then,
        oneClick: s.oneClick,
        segmentRecords: !installed,
      };
      return row({
        id: `${REPO_PLACE_ROW_PREFIX}${identity}`,
        kind: "tool",
        title: base,
        why: dirname(identity),
        required: false,
        recheck: "on-activate",
        status: s.status,
        detail: s.problem ?? s.note,
        action,
        ...(s.gated ? { finishGated: true, waivable: false } : {}),
      });
    }),
  );
}
