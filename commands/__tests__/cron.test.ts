import { describe, expect, spyOn, test } from "bun:test";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setSetting } from "../../lib/settings/write.ts";
import { getSetting } from "../../lib/settings/resolve.ts";
import { cronRemove } from "../cron.ts";

describe("rt cron for a person", () => {
  test("an unknown trigger is a usage failure naming the one trigger", async () => {
    const io = captureOut({ console: true });
    ui.__test__.setHuman(() => false);
    const exit = spyOn(process, "exit").mockImplementation(((c?: number) => {
      throw new Error(`exit ${c}`);
    }) as unknown as typeof process.exit);
    try {
      await expect(cronRemove(["nightly"])).rejects.toThrow("exit 2");
      expect(io.stderr()).toBe("Which trigger?\n  why: The one trigger is board-triage.\n  next: rt cron <install|remove> <trigger>\n");
      expect(io.stdout()).toBe("");
    } finally {
      exit.mockRestore();
      io.restore();
    }
  });
});

test("removing an installed schedule gives a tip to apply its removal now", async () => {
  const savedHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), "rt-cron-removal-"));
  process.env.HOME = home;
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  try {
    setSetting("rt.cron", { triggers: [{ name: "board-triage", event: "project-mrs", run: ["board", "triage"] }] }, "machine");
    await cronRemove(["board-triage"]);
    expect(getSetting<{ triggers: unknown[] }>("rt.cron").value?.triggers).toEqual([]);
    expect(io.stdout()).toBe("[ok] Removed the board-triage schedule  the daemon drops it within 30 seconds\n  tip: To apply this now: rt daemon restart\n");
    expect(io.stderr()).toBe("");
  } finally {
    io.restore();
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  }
});
