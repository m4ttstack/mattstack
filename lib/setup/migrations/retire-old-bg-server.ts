import { join } from "path";
import { resolveHerdrBin } from "../../agent-herdr.ts";
import { herdrRequest, type HerdrResult } from "../../herdr/client.ts";
import type { MigrationDef } from "./index.ts";

/** The background server's name before it became `mattstack-bg`. */
export const OLD_BG_SESSION = "bg";

type Snapshot = HerdrResult<{ snapshot: { panes: unknown[] } }>;

interface Deps {
  snapshot(sockPath: string): Promise<Snapshot>;
  herdrBin(): string;
}

const defaults: Deps = {
  snapshot: (sockPath) => herdrRequest("session.snapshot", {}, { sockPath, timeoutMs: 3000 }),
  herdrBin: () => resolveHerdrBin(),
};

/**
 * `bg` is a generic session name a person may use for their own server, so
 * only an empty one is stopped, and the session folder is never deleted.
 * HERDR_SOCKET_PATH is pinned to that server: a run from inside a herdr pane
 * inherits the visible server's socket, which would otherwise win.
 */
export function retireOldBgServer(overrides: Partial<Deps> = {}): MigrationDef {
  const deps = { ...defaults, ...overrides };
  return {
    id: "2026-10-22-retire-old-bg-server",
    title: "Stop the old background herdr server",
    async run(ctx) {
      const sock = join(ctx.p.home, ".config", "herdr", "sessions", OLD_BG_SESSION, "herdr.sock");
      if (!ctx.p.exists(sock)) return { state: "skipped", detail: "There was no old background herdr server" };
      const snap = await deps.snapshot(sock);
      if (!snap.ok) return { state: "skipped", detail: "The old background herdr server was not running" };
      const open = snap.result.snapshot.panes.length;
      if (open > 0) {
        return {
          state: "needs-you",
          detail: `The old background herdr server still has ${open} pane${open === 1 ? "" : "s"} open`,
          remedy: `Finish or close the agents running there, then run \`herdr session stop ${OLD_BG_SESSION}\`. mattstack now runs its background panes in mattstack-bg.`,
        };
      }
      const stopped = await ctx.p.exec([deps.herdrBin(), "session", "stop", OLD_BG_SESSION], {
        timeoutMs: 15_000,
        env: { HERDR_SOCKET_PATH: sock },
      });
      if (stopped.code !== 0) {
        const why = (stopped.stdout || stopped.stderr).trim().slice(0, 200) || `exit ${stopped.code}`;
        return { state: "failed", detail: `herdr could not stop the old background server: ${why}` };
      }
      return { state: "done", detail: "Stopped the old background herdr server" };
    },
  };
}

export const retireOldBgServerMigration = retireOldBgServer();
