import { describe, expect, spyOn, test } from "bun:test";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
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
