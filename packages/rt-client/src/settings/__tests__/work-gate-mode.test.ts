import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getDef } from "../registry-machinery.ts";
import { getSetting } from "../resolve.ts";
import { validateWrite } from "../validate-write.ts";

describe("work gate mode settings", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-work-gate-mode-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("defaults to chatty with the shadow off", () => {
    expect(getSetting("rt.work.gateMode").value).toBe("chatty");
    expect(getSetting("rt.work.gateModeShadow").value).toBe(false);
  });

  test("the schema accepts each mode and refuses a misspelling", () => {
    const def = getDef("rt.work.gateMode")!;
    for (const mode of ["chatty", "normal", "quiet", "yolo"]) {
      expect(validateWrite(def, mode, { scope: "user" })).toEqual({ ok: true });
    }
    expect(validateWrite(def, "quite", { scope: "user" }).ok).toBe(false);
  });
});
