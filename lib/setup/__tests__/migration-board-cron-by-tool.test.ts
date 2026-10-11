import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { peerTrigger, triageTrigger } from "../cron-install.ts";
import { boardCronByToolMigration } from "../migrations/board-cron-by-tool.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import type { ApplyContext } from "../apply.ts";
import { fakeProbes } from "./fakes.ts";

const ctx = (): ApplyContext => ({ p: fakeProbes({ env: { PATH: "" } }) }) as Partial<ApplyContext> as ApplyContext;
const triggers = () => getSetting<{ triggers: unknown[] }>("rt.cron").value?.triggers;
const seed = (list: unknown[]) => setSetting("rt.cron", { triggers: list }, "machine");

const OTHER = { name: "sync", event: "branches", repoName: "app", run: ["rt", "sync"] };

describe("2026-10-10-board-cron-by-tool", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mig-cron-tool-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("runs after the migration that adds board-peer", () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(ids).toContain("2026-10-10-board-cron-by-tool");
    expect(ids.indexOf("2026-10-01-board-peer-trigger")).toBeLessThan(ids.indexOf("2026-10-10-board-cron-by-tool"));
  });

  test("rewrites path-baked board triggers to tool form and leaves every other trigger alone", async () => {
    seed([
      { name: "board-triage", event: "project-mrs", run: ["bun", "run", "/repos/board/bin/triage.ts"], debounceMs: 7000 },
      OTHER,
      { name: "board-peer", event: "peer-inbox", run: ["/Applications/mattstack-dev.app/Contents/Helpers/board", "triage", "--peer"], debounceMs: 250 },
    ]);

    expect(await boardCronByToolMigration.run(ctx())).toEqual({ state: "done", detail: "The board's schedules now run the board in the app that is running" });
    expect(triggers()).toEqual([
      { name: "board-triage", event: "project-mrs", tool: "board", run: ["triage"], debounceMs: 7000 },
      OTHER,
      { name: "board-peer", event: "peer-inbox", tool: "board", run: ["triage", "--peer"], debounceMs: 250 },
    ]);
  });

  test("rewrites the one board trigger a Mac has", async () => {
    seed([{ name: "board-triage", event: "project-mrs", run: ["/opt/board", "triage"], debounceMs: 5000 }]);
    expect((await boardCronByToolMigration.run(ctx())).state).toBe("done");
    expect(triggers()).toEqual([triageTrigger()]);
  });

  test("skips a Mac with no board triggers", async () => {
    seed([OTHER]);
    expect(await boardCronByToolMigration.run(ctx())).toEqual({ state: "skipped", detail: "There were no board schedules to move" });
    expect(triggers()).toEqual([OTHER]);
  });

  test("skips a Mac with no cron setting at all and writes nothing", async () => {
    expect((await boardCronByToolMigration.run(ctx())).state).toBe("skipped");
    expect(triggers()).toBeUndefined();
  });

  test("skips when both board triggers are already in tool form", async () => {
    seed([triageTrigger(), peerTrigger()]);
    expect(await boardCronByToolMigration.run(ctx())).toEqual({ state: "skipped", detail: "There were no board schedules to move" });
    expect(triggers()).toEqual([triageTrigger(), peerTrigger()]);
  });
});
