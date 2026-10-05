/**
 * `materializeLogdyConfig` writes the logdy UI config that
 * `rt daemon logs --web` points `--config` at. It must not resurrect a
 * durable-looking file at the rt/ top level: RT-33's whole point is that
 * rt/ is either sqlite or an external tool's mandatory input, never a
 * scratch file a viewer regenerates on every launch.
 */

import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { materializeLogdyConfig } from "../daemon.ts";
import { restoreHome } from "../../lib/__tests__/home-env.ts";
import { tmpDir } from "../../lib/rt-paths.ts";

import { RT_DIR } from "../../lib/daemon-config.ts";

const legacyPath = () => join(RT_DIR, "logdy-pino-columns.json");
const newPath = () => join(tmpDir(), "logdy-pino-columns.json");

describe("materializeLogdyConfig", () => {
  beforeEach(() => {
    for (const path of [legacyPath(), newPath()]) {
      expect(path).toMatch(/^\/(?:private\/)?(?:tmp\/|var\/folders\/)/);
    }
  });
  afterEach(() => {
    rmSync(newPath(), { force: true });
    rmSync(legacyPath(), { force: true });
  });

  test("writes the config under rt/tmp, creating the dir if absent", () => {
    rmSync(tmpDir(), { recursive: true, force: true });
    expect(existsSync(tmpDir())).toBe(false);

    const path = materializeLogdyConfig();

    expect(path).toBe(newPath());
    expect(existsSync(newPath())).toBe(true);
    const parsed = JSON.parse(readFileSync(newPath(), "utf8"));
    expect(parsed.columns.map((c: { id: string }) => c.id)).toEqual(["time", "level", "module", "msg", "fields"]);
  });

  test("best-effort removes a lingering top-level rt/logdy-pino-columns.json", () => {
    mkdirSync(RT_DIR, { recursive: true });
    writeFileSync(legacyPath(), "{}");

    materializeLogdyConfig();

    expect(existsSync(legacyPath())).toBe(false);
  });

  test("removes the legacy config from the current HOME after the module was loaded", () => {
    const savedHome = process.env.HOME;
    const changedHome = mkdtempSync(join(tmpdir(), "rt-logdy-home-"));
    try {
      process.env.HOME = changedHome;
      const legacy = join(changedHome, ".mattstack", "rt", "logdy-pino-columns.json");
      mkdirSync(join(changedHome, ".mattstack", "rt"), { recursive: true });
      writeFileSync(legacy, "{}");

      expect(materializeLogdyConfig()).toBe(join(changedHome, ".mattstack", "rt", "tmp", "logdy-pino-columns.json"));
      expect(existsSync(legacy)).toBe(false);
    } finally {
      restoreHome(savedHome);
      rmSync(changedHome, { recursive: true, force: true });
    }
  });

  test("is a no-op removal when no legacy file exists", () => {
    rmSync(legacyPath(), { force: true });
    expect(() => materializeLogdyConfig()).not.toThrow();
    expect(existsSync(legacyPath())).toBe(false);
  });

  test("does not rewrite the file when content is already current", () => {
    const first = materializeLogdyConfig();
    const before = readFileSync(first, "utf8");
    materializeLogdyConfig();
    const after = readFileSync(first, "utf8");
    expect(after).toBe(before);
  });
});
