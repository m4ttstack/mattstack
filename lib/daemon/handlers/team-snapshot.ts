/**
 * team:snapshot-status / team:pull, a thin IPC surface over the
 * team-snapshot supervisor (lib/daemon/team-snapshots.ts). Same posture as
 * home.ts: no rt-client catalog entry, reached through the generic daemon
 * client.
 */

import { UserActionableError } from "../../errors.ts";
import { createRealProbes, type Probes } from "../../setup/probes.ts";
import { checkedOutBranch } from "../../team/org-branch.ts";
import { convergeDataBranch, heldCopy, MOVED_DONE } from "../../team/org-data-branch.ts";
import type { PullResult } from "../home-snapshot.ts";
import type { TeamSnapshotsHandle } from "../team-snapshots.ts";
import type { HandlerMap } from "./types.ts";

type PullReply = { ok: true; data: PullResult } | { ok: false; error: string; failure: { code: string; message: string } };

/**
 * The pull already ran the move under its own lock; a clone that is not on
 * the data branch afterwards gets one more try here, so the reply says why
 * it stayed.
 */
async function afterMovedHold(
  result: PullResult & { hold: { moved: string } },
  dir: string,
  probes: Probes,
  moveData: typeof convergeDataBranch,
): Promise<PullReply> {
  const branch = result.hold.moved;
  if ((await checkedOutBranch(probes, dir)) === branch) return { ok: true, data: { outcome: "moved", detail: MOVED_DONE(branch) } };
  const move = await moveData(probes, dir);
  if (move === null) return { ok: true, data: result };
  if (move.kind === "moved" || move.kind === "already") return { ok: true, data: { outcome: "moved", detail: MOVED_DONE(move.branch) } };
  if (move.kind === "held") {
    const { detail, remedy } = heldCopy(move);
    return { ok: true, data: { outcome: "skipped", detail: `${detail}. ${remedy}`, hold: result.hold } };
  }
  const message = `rt could not move your copy of the org to the ${branch} branch`;
  return { ok: false, error: `${message}: ${move.log}`, failure: { code: "data-branch-move-failed", message } };
}

export function createTeamSnapshotHandlers(
  teamSnapshots: TeamSnapshotsHandle,
  deps: { probes?: Probes; moveData?: typeof convergeDataBranch } = {},
): Record<"team:snapshot-status" | "team:pull", (payload: any) => Promise<any>> & HandlerMap {
  return {
    "team:snapshot-status": async () => {
      return { ok: true, data: teamSnapshots.status() };
    },

    "team:pull": async (payload: any) => {
      const slug = String(payload?.slug ?? "");
      try {
        const result = await teamSnapshots.pullNow(slug);
        const dir = teamSnapshots.status().find((e) => e.slug === slug)?.repoDir;
        if (result.hold && "moved" in result.hold && dir !== undefined) {
          return await afterMovedHold({ ...result, hold: result.hold }, dir, deps.probes ?? createRealProbes(), deps.moveData ?? convergeDataBranch);
        }
        return { ok: true, data: result };
      } catch (err) {
        // pullNow's only throw for an out-of-band slug is UserActionableError
        // ("no-team"); anything else is a real bug and must propagate.
        if (err instanceof UserActionableError) {
          return { ok: false, error: err.message, failure: { code: err.code, message: err.message } };
        }
        throw err;
      }
    },
  };
}
