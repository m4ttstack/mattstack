import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createTestHome, rt, rtRaw } from "../harness.ts";

describe("first-run", () => {
  let home: string;
  let cleanup: () => void;

  beforeAll(() => {
    ({ path: home, cleanup } = createTestHome());
  });

  afterAll(() => cleanup());

  test("first run prints the not-set-up hint; the requested command still runs", async () => {
    expect(existsSync(join(home, ".mattstack", "rt", "daemon.json"))).toBe(false);

    // `daemon` isn't in the hint's skip list, so it triggers the hint; `daemon
    // install` itself (not the hook) is what then creates daemon.json.
    const result = await rtRaw(["daemon", "install"], { home });

    const combined = result.stdout + result.stderr;
    expect(combined).toContain("rt is not set up yet");
    expect(combined).toContain("rt setup");

    expect(existsSync(join(home, ".mattstack", "rt", "daemon.json"))).toBe(true);
  }, 30_000);

  test("subsequent run skips the hint", async () => {
    expect(existsSync(join(home, ".mattstack", "rt", "daemon.json"))).toBe(true);

    const result = await rtRaw(["daemon", "install"], { home });

    const combined = result.stdout + result.stderr;
    expect(combined).not.toContain("rt is not set up yet");
  }, 30_000);

  test("a setup-adjacent command (skip list) never sees the hint, even on a fresh HOME", async () => {
    const fresh = createTestHome();
    try {
      expect(existsSync(join(fresh.path, ".mattstack", "rt", "daemon.json"))).toBe(false);

      const result = await rtRaw(["setup", "plan", "--json"], { home: fresh.path });

      const combined = result.stdout + result.stderr;
      expect(combined).not.toContain("rt is not set up yet");
    } finally {
      fresh.cleanup();
    }
  }, 30_000);

  test("RT_APP_SOCKET set skips the hint for a non-skip command on a fresh HOME", async () => {
    const fresh = createTestHome();
    try {
      expect(existsSync(join(fresh.path, ".mattstack", "rt", "daemon.json"))).toBe(false);

      const result = await rtRaw(["daemon", "install"], { home: fresh.path, env: { RT_APP_SOCKET: "/tmp/rt-e2e-tray.sock" } });

      const combined = result.stdout + result.stderr;
      expect(combined).not.toContain("rt is not set up yet");
    } finally {
      fresh.cleanup();
    }
  }, 30_000);

  test("a legacy rt folder moved into place is reported once, on stderr", async () => {
    const fresh = createTestHome();
    try {
      mkdirSync(join(fresh.path, ".rt", "logs"), { recursive: true });
      const result = await rt(["--version"], { home: fresh.path });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^rt /);
      expect(result.stderr).toBe("[ok] Moved your rt data to its new folder  ~/.mattstack/rt\n");
    } finally {
      fresh.cleanup();
    }
  }, 30_000);

  test("rt data in two folders is one warning with the fix, and stdout stays the payload", async () => {
    const fresh = createTestHome();
    try {
      mkdirSync(join(fresh.path, ".rt", "logs"), { recursive: true });
      mkdirSync(join(fresh.path, ".mattstack", "rt"), { recursive: true });
      const result = await rt(["--version"], { home: fresh.path });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^rt /);
      expect(result.stderr).toBe(
        "[warning] Your rt data is in two folders\n  note: rt only reads ~/.mattstack/rt\n  fix: Merge ~/.rt into it by hand, then delete ~/.rt\n",
      );
    } finally {
      fresh.cleanup();
    }
  }, 30_000);
});
