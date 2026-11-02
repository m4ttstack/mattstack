import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { directOnlyConfigDirs, reconcileDirectOnly } from "../direct-only.ts";
import { DIRECT_ONLY_MARK } from "../direct-only-line.ts";

let tmp: string;
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "direct-only-")));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const KEY = "widgets@market";
const plain = (name: string) => `---\nname: ${name}\ndescription: d\n---\nbody\n`;

function versionDir(config: string, version = "1.0.0"): string {
  const dir = join(config, "plugins", "cache", "market", "widgets", version);
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  return dir;
}
function skill(dir: string, rel: string, text: string): string {
  const file = join(dir, rel, "SKILL.md");
  mkdirSync(join(dir, rel), { recursive: true });
  writeFileSync(file, text);
  return file;
}
const read = (f: string) => readFileSync(f, "utf8");

describe("reconcileDirectOnly", () => {
  test("a chosen skill gains the line in the newest version only", () => {
    const config = join(tmp, "c");
    const old = skill(versionDir(config, "1.0.0"), "skills/alpha", plain("alpha"));
    const cur = skill(versionDir(config, "1.10.0"), "skills/alpha", plain("alpha"));
    const r = reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(read(cur)).toContain(DIRECT_ONLY_MARK);
    expect(read(old)).toBe(plain("alpha"));
    expect(r).toEqual({ changed: [cur], warnings: [] });
  });

  test("a skill no longer chosen loses the line, and [] strips every marked line", () => {
    const config = join(tmp, "c");
    const dir = versionDir(config);
    const a = skill(dir, "skills/alpha", plain("alpha"));
    const b = skill(dir, "skills/beta", plain("beta"));
    reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: ["alpha", "beta"] } });
    reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(read(a)).toContain(DIRECT_ONLY_MARK);
    expect(read(b)).toBe(plain("beta"));
    reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: [] } });
    expect(read(a)).toBe(plain("alpha"));
  });

  test("a plugin absent from choices is not walked", () => {
    const config = join(tmp, "c");
    const a = skill(versionDir(config), "skills/alpha", plain("alpha"));
    reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    const r = reconcileDirectOnly({ configDirs: [config], choices: {} });
    expect(read(a)).toContain(DIRECT_ONLY_MARK);
    expect(r.changed).toEqual([]);
  });

  test("a skill under a manifest root is found", () => {
    const config = join(tmp, "c");
    const dir = versionDir(config);
    writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ skills: ["./plugin/skills"] }));
    const f = skill(dir, "plugin/skills/alpha", plain("alpha"));
    reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(read(f)).toContain(DIRECT_ONLY_MARK);
  });

  test("an unknown name and an uninstalled plugin are ignored with no warning", () => {
    const config = join(tmp, "c");
    const f = skill(versionDir(config), "skills/alpha", plain("alpha"));
    const r = reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: ["ghost"], "nope@market": ["x"] } });
    expect(r).toEqual({ changed: [], warnings: [] });
    expect(read(f)).toBe(plain("alpha"));
  });

  test("a second run reports nothing changed", () => {
    const config = join(tmp, "c");
    skill(versionDir(config), "skills/alpha", plain("alpha"));
    const first = reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(first.changed).toHaveLength(1);
    const second = reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(second).toEqual({ changed: [], warnings: [] });
  });

  test("a SKILL.md symlinked outside plugins/cache is not written and warns", () => {
    const config = join(tmp, "c");
    const dir = versionDir(config);
    const outside = join(tmp, "outside.md");
    writeFileSync(outside, plain("alpha"));
    mkdirSync(join(dir, "skills", "alpha"), { recursive: true });
    symlinkSync(outside, join(dir, "skills", "alpha", "SKILL.md"));
    const r = reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(read(outside)).toBe(plain("alpha"));
    expect(r.changed).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  test("a missing plugin folder does not throw", () => {
    const config = join(tmp, "c");
    mkdirSync(join(config, "plugins", "cache"), { recursive: true });
    expect(() => reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: ["alpha"] } })).not.toThrow();
  });

  test("two config dirs sharing one plugins folder are edited once", () => {
    const a = join(tmp, "a");
    const f = skill(versionDir(a), "skills/alpha", plain("alpha"));
    const b = join(tmp, "b");
    mkdirSync(b);
    symlinkSync(join(a, "plugins"), join(b, "plugins"));
    const r = reconcileDirectOnly({ configDirs: [a, b], choices: { [KEY]: ["alpha"] } });
    expect(r.changed).toEqual([f]);
    expect(directOnlyConfigDirs({ CLAUDE_CONFIG_DIR: a }, tmp)).toEqual([a]);
  });

  test("no frontmatter warns and names the file", () => {
    const config = join(tmp, "c");
    const f = skill(versionDir(config), "skills/alpha", "just text\n");
    const r = reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(r.changed).toEqual([]);
    expect(r.warnings[0]).toContain(f);
  });

  test("an unusual disable-model-invocation value warns and names the file", () => {
    const config = join(tmp, "c");
    const f = skill(versionDir(config), "skills/alpha", `---\nname: alpha\ndisable-model-invocation: "true"\n---\nb\n`);
    const r = reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(r.changed).toEqual([]);
    expect(r.warnings[0]).toContain(f);
  });

  test("a source value of true is left alone without a warning", () => {
    const config = join(tmp, "c");
    skill(versionDir(config), "skills/alpha", `---\nname: alpha\ndisable-model-invocation: true\n---\nb\n`);
    const r = reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(r).toEqual({ changed: [], warnings: [] });
  });

  test("a read-only SKILL.md warns and the other skills still apply", () => {
    const config = join(tmp, "c");
    const dir = versionDir(config);
    const locked = skill(dir, "skills/alpha", plain("alpha"));
    const other = skill(dir, "skills/beta", plain("beta"));
    chmodSync(join(dir, "skills", "alpha"), 0o500);
    try {
      const r = reconcileDirectOnly({ configDirs: [config], choices: { [KEY]: ["alpha", "beta"] } });
      expect(r.warnings.some((w) => w.includes(locked))).toBe(true);
      expect(read(other)).toContain(DIRECT_ONLY_MARK);
    } finally {
      chmodSync(join(dir, "skills", "alpha"), 0o700);
    }
  });
});

describe("directOnlyConfigDirs", () => {
  test("includes swap sessions that have plugins, skips ones that do not", () => {
    const home = join(tmp, "home");
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    mkdirSync(join(home, ".claude-swap-backup", "sessions", "s1", "plugins"), { recursive: true });
    mkdirSync(join(home, ".claude-swap-backup", "sessions", "s2"), { recursive: true });
    expect(directOnlyConfigDirs({}, home)).toEqual([
      join(home, ".claude"),
      join(home, ".claude-swap-backup", "sessions", "s1"),
    ]);
  });
});
