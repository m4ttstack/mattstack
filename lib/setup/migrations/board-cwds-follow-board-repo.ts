import { restartAppWithDeck } from "../../deps/resolve.ts";
import { resolveIndexPathForIdentity } from "../../repo-index.ts";
import { serializeIdentity } from "../../settings/identity.ts";
import { storedValue } from "../../settings/presence.ts";
import { currentOrg } from "../../settings/stores.ts";
import type { StepOutcome } from "../apply.ts";
import { planBoardCwds, type BoardCwds } from "../board-folder.ts";
import type { Probes } from "../probes.ts";
import { tildify } from "../repo-placement.ts";
import { updateSetupState } from "../state.ts";
import { repoBasename } from "../steps/repos.ts";
import { writable, writeBoardCwds } from "../steps/skills.ts";
import { readTeamSnapshot } from "../team-settings.ts";
import { migrationEventId, type MigrationDef } from "./index.ts";

const ID = "2026-10-29-board-cwds-follow-board-repo";

export interface BoardCwdsFollowBoardRepoSeams {
  restartBoard(p: Probes): Promise<boolean>;
}

const realSeams: BoardCwdsFollowBoardRepoSeams = { restartBoard: (p) => restartAppWithDeck(p, "board") };

/**
 * The setup step before this one pointed all three of the board's folders at
 * the first tracked repo, or left them unset. This puts them on the board's
 * own repo once per Mac.
 */
export function makeBoardCwdsFollowBoardRepoMigration(seams: BoardCwdsFollowBoardRepoSeams = realSeams): MigrationDef {
  return {
    id: ID,
    title: "Point the board at its repo",
    async run(ctx): Promise<StepOutcome> {
      const p = ctx.p;
      const org = currentOrg();
      if (org === null) return { state: "skipped", detail: "This Mac has no team" };
      const snapshot = readTeamSnapshot(p, org);
      const identity = snapshot.boardRepo ?? null;
      if (identity === null) return { state: "skipped", detail: "None of the team's repos is the board's" };

      const indexed = new Map<string, string>();
      for (const tracked of snapshot.trackingIdentities) {
        const path = await resolveIndexPathForIdentity(serializeIdentity({ kind: "remote", id: tracked }));
        if (path !== null) indexed.set(tracked, path);
      }
      const target = indexed.get(identity) ?? null;
      if (target === null) return { state: "skipped", detail: `${repoBasename(identity)} is not on this Mac yet` };
      if (!writable(ctx, "board.cwds", migrationEventId(ID))) return { state: "skipped", detail: "This rt doesn't know the board.cwds setting" };

      const checkouts = new Set(indexed.values());
      const current = storedValue<Partial<BoardCwds>>("board.cwds");
      const plan = planBoardCwds({
        current,
        rtWrote: undefined,
        target,
        mode: "migration",
        exists: (path) => p.exists(path),
        isTrackedCheckout: (path) => checkouts.has(path),
      });
      const where = tildify(p.home, target);
      if ("leave" in plan) {
        if (plan.leave === "hand-set") return { state: "skipped", detail: "You set the board's folders yourself, so rt left them alone" };
        updateSetupState(p, (s) => ({ ...s, boardCwdsWritten: { review: target, respond: target, doctor: target } }));
        return { state: "skipped", detail: `The board already starts in ${where}` };
      }

      writeBoardCwds(ctx, plan.write);
      const detail = `The board's agents start in ${where}`;
      let restarted = false;
      try {
        restarted = await seams.restartBoard(p);
      } catch {
        restarted = false;
      }
      if (!restarted) return { state: "done", detail: `${detail}. Restart the board from deck to use it` };
      updateSetupState(p, ({ boardRestartPending: _, ...s }) => s);
      return { state: "done", detail };
    },
  };
}

export const boardCwdsFollowBoardRepoMigration: MigrationDef = makeBoardCwdsFollowBoardRepoMigration();
