import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { installCronTrigger, triageTrigger } from "../cron-install.ts";
import { boardPeerTriggerMigration } from "../migrations/board-peer-trigger.ts";
import type { ApplyContext } from "../apply.ts";

const ctx = {} as ApplyContext;
const triggers = () => getSetting<{ triggers: Array<{ name: string; run: string[] }> }>("rt.cron").value?.triggers ?? [];

describe("2026-10-01-board-peer-trigger", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mig-peer-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("adds board-peer beside an installed board-triage, reusing its run", async () => {
    installCronTrigger(triageTrigger(["/A/board", "triage"]));
    expect(await boardPeerTriggerMigration.run(ctx)).toEqual({ state: "done", detail: "Peer asks now start as soon as they arrive" });
    expect(triggers().map((t) => t.name)).toEqual(["board-triage", "board-peer"]);
    expect(triggers()[1]!.run).toEqual(["/A/board", "triage", "--peer"]);
  });

  test("running it twice leaves one board-peer", async () => {
    installCronTrigger(triageTrigger(["/A/board", "triage"]));
    await boardPeerTriggerMigration.run(ctx);
    await boardPeerTriggerMigration.run(ctx);
    expect(triggers().filter((t) => t.name === "board-peer")).toHaveLength(1);
  });

  test("skips a Mac with no board triage installed", async () => {
    expect(await boardPeerTriggerMigration.run(ctx)).toEqual({ state: "skipped", detail: "Board triage isn't installed on this Mac" });
    expect(triggers()).toEqual([]);
  });

  test("skips when peer asks are off", async () => {
    installCronTrigger(triageTrigger(["/A/board", "triage"]));
    setSetting("board.peerAsks", { enabled: false }, "user");
    expect(await boardPeerTriggerMigration.run(ctx)).toEqual({ state: "skipped", detail: "Automatic peer asks are off" });
    expect(triggers().map((t) => t.name)).toEqual(["board-triage"]);
  });
});
