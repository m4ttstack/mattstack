import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { installCronTrigger, triageTrigger } from "../cron-install.ts";
import { boardPeerTriggerMigration } from "../migrations/board-peer-trigger.ts";
import type { ApplyContext } from "../apply.ts";
import { fakeProbes } from "./fakes.ts";

type Trigger = { name: string; event?: string; tool?: string; run: string[]; debounceMs?: number };
const ctxWith = (p: ApplyContext["p"]): ApplyContext => ({ p }) as Partial<ApplyContext> as ApplyContext;
const triggers = () => getSetting<{ triggers: Trigger[] }>("rt.cron").value?.triggers ?? [];

describe("2026-10-01-board-peer-trigger", () => {
  const origHome = process.env.HOME;
  let home: string;
  let resolvable: ApplyContext;
  let unresolvable: ApplyContext;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mig-peer-")));
    process.env.HOME = home;
    resolvable = ctxWith(fakeProbes({ home, env: { PATH: "/tools" }, files: { "/tools/board": "board-binary" } }));
    unresolvable = ctxWith(fakeProbes({ home, env: { PATH: "" } }));
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("a Mac with no board triage but a resolvable board gets board-peer in tool form", async () => {
    expect(await boardPeerTriggerMigration.run(resolvable)).toEqual({ state: "done", detail: "Peer asks now start as soon as they arrive" });
    expect(triggers()).toEqual([{ name: "board-peer", event: "peer-inbox", tool: "board", run: ["triage", "--peer"], debounceMs: 300 }]);
  });

  test("adds board-peer beside an installed board-triage and leaves that one alone", async () => {
    installCronTrigger(triageTrigger());
    await boardPeerTriggerMigration.run(resolvable);
    expect(triggers().map((t) => t.name)).toEqual(["board-triage", "board-peer"]);
    expect(triggers()[0]).toEqual(triageTrigger());
  });

  test("running it twice leaves one board-peer", async () => {
    await boardPeerTriggerMigration.run(resolvable);
    await boardPeerTriggerMigration.run(resolvable);
    expect(triggers().filter((t) => t.name === "board-peer")).toHaveLength(1);
  });

  test("skips a Mac whose board cannot be found", async () => {
    expect(await boardPeerTriggerMigration.run(unresolvable)).toEqual({ state: "skipped", detail: "Board isn't installed on this Mac" });
    expect(triggers()).toEqual([]);
  });

  test("skips when peer asks are off", async () => {
    setSetting("board.peerAsks", { enabled: false }, "user");
    expect(await boardPeerTriggerMigration.run(resolvable)).toEqual({ state: "skipped", detail: "Automatic peer asks are off" });
    expect(triggers()).toEqual([]);
  });
});
