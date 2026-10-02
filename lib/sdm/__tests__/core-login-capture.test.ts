import { describe, test, expect, afterEach } from "bun:test";
import { join } from "path";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { startLoginCapture } from "../core.ts";
import { __test__ as sdmCmd } from "../../../commands/sdm.ts";

const FAKE = join(import.meta.dir, "fixtures", "fake-sdm-login.sh");
const SPLIT = join(import.meta.dir, "fixtures", "fake-sdm-login-split.sh");
let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
  delete process.env.RT_SDM_BIN;
  delete process.env.SDM_LOGIN_SENTINEL;
});

describe("startLoginCapture", () => {
  test("captures the auth URL, then completes when the browser leg finishes", async () => {
    process.env.RT_SDM_BIN = FAKE;
    const dir = mkdtempSync(join(tmpdir(), "rt-login-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const sentinel = join(dir, "done");
    process.env.SDM_LOGIN_SENTINEL = sentinel;

    const lines: string[] = [];
    const cap = startLoginCapture("nobody@example.test", l => lines.push(l));
    const url = await cap.urlPromise;
    expect(url).toBe("https://app.strongdm.com/auth-confirm-native/fixture123");

    // Simulate the browser reaching auth/complete.
    writeFileSync(sentinel, "");
    const done = await cap.donePromise;
    expect(done.ok).toBe(true);
    // The `open` shim swallowed sdm's browser launch (no crash, no stray output).
    expect(lines.some(l => l.includes("should-be-swallowed"))).toBe(false);
  });

  test("cancel kills a login that never completes", async () => {
    process.env.RT_SDM_BIN = FAKE;
    process.env.SDM_LOGIN_SENTINEL = join(tmpdir(), "never-created-" + Math.random().toString(36).slice(2));
    const cap = startLoginCapture(null, () => {});
    await cap.urlPromise;
    cap.cancel();
    const done = await cap.donePromise;
    expect(done.ok).toBe(false);
  });

  test("an auth url split across two pipe chunks comes out as one whole line", async () => {
    process.env.RT_SDM_BIN = SPLIT;
    const lines: string[] = [];
    const cap = startLoginCapture(null, l => lines.push(l));
    expect(await cap.urlPromise).toBe("https://app.strongdm.com/auth-confirm-native/split456secret");
    expect((await cap.donePromise).ok).toBe(true);
    expect(lines).toEqual(["Please complete logging in at: https://app.strongdm.com/auth-confirm-native/split456secret", "authentication successful \u2713"]);
  });

  test("through the sdm command's progress, the split token is redacted whole", async () => {
    process.env.RT_SDM_BIN = SPLIT;
    const r = await sdmCmd.withProgress("Logging in to StrongDM", false, async onLine => {
      const cap = startLoginCapture(null, onLine);
      await cap.urlPromise;
      return cap.donePromise;
    });
    expect(r.tail).toEqual(["Please complete logging in at: https://app.strongdm.com/auth-confirm-native/<redacted>", "authentication successful \u2713"]);
    expect(r.tail.join("\n")).not.toContain("secret");
  });
});
