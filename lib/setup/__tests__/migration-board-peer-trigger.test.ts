import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { updateRepoIndex } from "../../repo-index.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { installCronTrigger, triageTrigger } from "../cron-install.ts";
import { boardPeerTriggerMigration } from "../migrations/board-peer-trigger.ts";
import type { ApplyContext } from "../apply.ts";
import { fakeProbes } from "./fakes.ts";

type Trigger = { name: string; event?: string; run: string[]; debounceMs?: number };
const ctxWith = (p: ApplyContext["p"]): ApplyContext => ({ p }) as Partial<ApplyContext> as ApplyContext;
const triggers = () => getSetting<{ triggers: Trigger[] }>("rt.cron").value?.triggers ?? [];

describe("2026-10-01-board-peer-trigger", () => {
  const origHome = process.env.HOME;
  let home: string;
  let script: string;
  let resolvable: ApplyContext;
  let unresolvable: ApplyContext;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mig-peer-")));
    process.env.HOME = home;
    const checkout = mkdtempSync(join(home, "board-"));
    mkdirSync(join(checkout, "bin"), { recursive: true });
    script = join(checkout, "bin", "triage.ts");
    writeFileSync(script, "// triage");
    updateRepoIndex("board", checkout);
    resolvable = ctxWith(fakeProbes({ home, files: { [script]: "// triage" } }));
    unresolvable = ctxWith(fakeProbes({ home, env: { PATH: "" } }));
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("a Mac with no board triage but a resolvable board gets board-peer", async () => {
    expect(await boardPeerTriggerMigration.run(resolvable)).toEqual({ state: "done", detail: "Peer asks now start as soon as they arrive" });
    expect(triggers()).toEqual([{ name: "board-peer", event: "peer-inbox", run: ["bun", "run", script, "--peer"], debounceMs: 300 }]);
  });

  test("adds board-peer beside an installed board-triage and leaves that one alone", async () => {
    installCronTrigger(triageTrigger(["bun", "run", script]));
    await boardPeerTriggerMigration.run(resolvable);
    expect(triggers().map((t) => t.name)).toEqual(["board-triage", "board-peer"]);
    expect(triggers()[0]!.run).toEqual(["bun", "run", script]);
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
