/**
 * team:snapshot-status / team:pull, a thin IPC surface over the
 * team-snapshot supervisor (lib/daemon/team-snapshots.ts). Same posture as
 * home.ts: no rt-client catalog entry, reached through the generic daemon
 * client.
 */

import { UserActionableError } from "../../errors.ts";
import { createRealProbes, type Probes } from "../../setup/probes.ts";
import { checkedOutBranch } from "../../team/org-branch.ts";
import { heldCopy, moveBlocker, MOVED_DONE, type ConvergeResult, type HeldMove } from "../../team/org-data-branch.ts";
import type { PullResult } from "../home-snapshot.ts";
import type { TeamSnapshotsHandle } from "../team-snapshots.ts";
import type { HandlerMap } from "./types.ts";

type PullReply = { ok: true; data: PullResult } | { ok: false; error: string; failure: { code: string; message: string } };

/**
 * The pull already ran the move under its own lock, so a clone that is not
 * on the data branch afterwards is first explained from a read-only check.
 * Only a clone nothing blocks gets one more try, under the same lock, which
 * also names a clash.
 */
async function afterMovedHold(
  result: PullResult & { hold: { moved: string } },
  dir: string,
  probes: Probes,
  moveNow: () => Promise<ConvergeResult | null>,
): Promise<PullReply> {
  const branch = result.hold.moved;
  const message = `rt could not move your copy of the org to the ${branch} branch`;
  const failed = (log: string): PullReply => ({ ok: false, error: `${message}: ${log}`, failure: { code: "data-branch-move-failed", message } });
  const held = (move: HeldMove): PullReply => {
    const { detail, remedy } = heldCopy(move);
    return { ok: true, data: { outcome: "skipped", detail: `${detail}. ${remedy}`, hold: result.hold, needsYou: true } };
  };
  if ((await checkedOutBranch(probes, dir)) === branch) return { ok: true, data: { outcome: "moved", detail: MOVED_DONE(branch) } };
  const blocker = await moveBlocker(probes, dir);
  if (blocker?.kind === "held") return held(blocker);
  if (blocker?.kind === "failed") return failed(blocker.log);
  const move = await moveNow();
  if (move === null || move.kind === "unchecked") return { ok: true, data: result };
  if (move.kind === "moved") return { ok: true, data: { outcome: "moved", detail: MOVED_DONE(move.branch, move.carried) } };
  if (move.kind === "already") return { ok: true, data: { outcome: "moved", detail: MOVED_DONE(move.branch) } };
  if (move.kind === "held") return held(move);
  return failed(move.log);
}

export function createTeamSnapshotHandlers(
  teamSnapshots: TeamSnapshotsHandle,
  deps: { probes?: Probes } = {},
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
          return await afterMovedHold({ ...result, hold: result.hold }, dir, deps.probes ?? createRealProbes(), () => teamSnapshots.moveNow(slug));
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
