import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { codexConfigPath, codexFolderTrust } from "../codex/trust.ts";

let dir: string;
let config: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-codex-trust-")));
  config = join(dir, "config.toml");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The shape Codex 0.160 wrote for a folder it trusts (live-01 evidence). */
const trusted = (path: string) => `[projects."${path}"]\ntrust_level = "trusted"\n`;

describe("where the active Codex profile records trust", () => {
  test("the ambient profile is the home folder's .codex", () => {
    expect(codexConfigPath("default", { HOME: "/home/remy" })).toBe("/home/remy/.codex/config.toml");
  });

  test("a profile that is a Codex home holds its own config", () => {
    expect(codexConfigPath("/srv/codex-home", { HOME: "/home/remy" })).toBe("/srv/codex-home/config.toml");
  });

  test("a bare profile name locates no config", () => {
    expect(codexConfigPath("work", { HOME: "/home/remy" })).toBeUndefined();
  });
});

describe("whether Codex already trusts a folder", () => {
  test("a trusted entry for the exact folder is trust", () => {
    writeFileSync(config, `model = "o3"\n\n${trusted("/work/a")}\n[tui]\nscreen_reader_detection_done = true\n`);
    expect(codexFolderTrust(config, "/work/a")).toEqual({ ok: true, data: undefined });
  });

  test("no entry for the folder is not trust, and the message says to trust it in Codex first", () => {
    writeFileSync(config, trusted("/work/b"));
    const outcome = codexFolderTrust(config, "/work/a");
    expect(outcome).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(outcome.ok || outcome.error.message).toContain("/work/a");
    expect(outcome.ok || outcome.error.message).toContain("trust it");
  });

  test("an untrusted entry, a trust level of another type, or an entry that is not a table is not trust", () => {
    for (const body of [
      `[projects."/work/a"]\ntrust_level = "untrusted"\n`,
      `[projects."/work/a"]\ntrust_level = true\n`,
      `[projects."/work/a"]\n`,
      `projects = { "/work/a" = "trusted" }\n`,
      `projects = ["/work/a"]\n`,
    ]) {
      writeFileSync(config, body);
      expect(codexFolderTrust(config, "/work/a")).toMatchObject({ ok: false, error: { code: "not-ready" } });
    }
  });

  test("a trusted parent folder does not trust the folders inside it", () => {
    writeFileSync(config, trusted("/work"));
    expect(codexFolderTrust(config, "/work/a")).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("a trusted folder whose name only starts the same does not count", () => {
    writeFileSync(config, trusted("/work/a"));
    expect(codexFolderTrust(config, "/work/ab")).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("the inline-table spelling of the same entry is trust", () => {
    writeFileSync(config, `projects = { "/work/a" = { trust_level = "trusted" } }\n`);
    expect(codexFolderTrust(config, "/work/a").ok).toBe(true);
  });

  test("a folder reached through a link counts when Codex trusts its real path", () => {
    const real = join(dir, "real");
    const link = join(dir, "link");
    mkdirSync(real);
    symlinkSync(real, link);
    writeFileSync(config, trusted(real));
    expect(codexFolderTrust(config, link).ok).toBe(true);
  });

  test("any spelling of the folder that Codex marks untrusted refuses", () => {
    const real = join(dir, "real");
    const link = join(dir, "link");
    mkdirSync(real);
    symlinkSync(real, link);
    writeFileSync(config, `${trusted(real)}\n[projects."${link}"]\ntrust_level = "untrusted"\n`);
    expect(codexFolderTrust(config, link)).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("a profile with no config has trusted nothing", () => {
    const outcome = codexFolderTrust(config, "/work/a");
    expect(outcome).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(outcome.ok || outcome.error.message).toContain("trust it");
  });

  test("a config rt cannot parse or open refuses", () => {
    writeFileSync(config, `[projects."/work/a"\ntrust_level = "trusted"\n`);
    const broken = codexFolderTrust(config, "/work/a");
    expect(broken).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(broken.ok || broken.error.message).toContain("could not read");

    rmSync(config);
    mkdirSync(config);
    expect(codexFolderTrust(config, "/work/a")).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("a profile whose config cannot be located refuses", () => {
    expect(codexFolderTrust(undefined, "/work/a")).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("reading trust never changes the config", () => {
    const body = `${trusted("/work/b")}# keep me\n`;
    writeFileSync(config, body);
    const before = statSync(config).mtimeMs;
    codexFolderTrust(config, "/work/a");
    codexFolderTrust(config, "/work/b");
    expect(readFileSync(config, "utf8")).toBe(body);
    expect(statSync(config).mtimeMs).toBe(before);
  });
});
