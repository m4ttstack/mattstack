import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { enrichmentCmd } from "../../../commands/sdm.ts";
import { existsSync, mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../ui/out.ts";
import { captureOut } from "../../ui/__tests__/capture-out.ts";

describe("enrichmentCmd", () => {
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "enr-cmd-home-")));
    io = captureOut();
    out.__test__.setHuman(() => false);
  });
  afterEach(() => {
    io.restore();
    process.exitCode = 0;
  });

  test("an argument is refused, and no labels file is made", async () => {
    await enrichmentCmd(["init"]);
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("[refused] rt no longer makes a labels file  your team's labels live in your team's settings\n");
    expect(process.exitCode).toBe(1);
    expect(existsSync(join(process.env.HOME!, ".mattstack", "rt", "sdm", "enrichment.jsonc"))).toBe(false);
  });
});
