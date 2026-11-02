import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, statSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { disableModelInvocationConfigDirs, reconcileDisableModelInvocation } from "../disable-model-invocation.ts";
import { PERSONAL_MARK } from "../disable-model-invocation-line.ts";

let tmp: string;
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "disable-model-invocation-")));
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

describe("reconcileDisableModelInvocation", () => {
  test("a chosen skill gains the line in the newest version only", () => {
    const config = join(tmp, "c");
    const old = skill(versionDir(config, "1.0.0"), "skills/alpha", plain("alpha"));
    const cur = skill(versionDir(config, "1.10.0"), "skills/alpha", plain("alpha"));
    const r = reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(read(cur)).toContain(PERSONAL_MARK);
    expect(read(old)).toBe(plain("alpha"));
    expect(r).toEqual({ changed: [cur], warnings: [] });
  });

  test("a skill no longer chosen loses the line, and [] strips every marked line", () => {
    const config = join(tmp, "c");
    const dir = versionDir(config);
    const a = skill(dir, "skills/alpha", plain("alpha"));
    const b = skill(dir, "skills/beta", plain("beta"));
    reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha", "beta"] } });
    reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(read(a)).toContain(PERSONAL_MARK);
    expect(read(b)).toBe(plain("beta"));
    reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: [] } });
    expect(read(a)).toBe(plain("alpha"));
  });

  test("a plugin absent from choices is not walked", () => {
    const config = join(tmp, "c");
    const a = skill(versionDir(config), "skills/alpha", plain("alpha"));
    reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    const r = reconcileDisableModelInvocation({ configDirs: [config], choices: {} });
    expect(read(a)).toContain(PERSONAL_MARK);
    expect(r.changed).toEqual([]);
  });

  test("a skill under a manifest root is found", () => {
    const config = join(tmp, "c");
    const dir = versionDir(config);
    writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ skills: ["./plugin/skills"] }));
    const f = skill(dir, "plugin/skills/alpha", plain("alpha"));
    reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(read(f)).toContain(PERSONAL_MARK);
  });

  test("an unknown name and an uninstalled plugin are ignored with no warning", () => {
    const config = join(tmp, "c");
    const f = skill(versionDir(config), "skills/alpha", plain("alpha"));
    const r = reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["ghost"], "nope@market": ["x"] } });
    expect(r).toEqual({ changed: [], warnings: [] });
    expect(read(f)).toBe(plain("alpha"));
  });

  test("a second run reports nothing changed", () => {
    const config = join(tmp, "c");
    skill(versionDir(config), "skills/alpha", plain("alpha"));
    const first = reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(first.changed).toHaveLength(1);
    const second = reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(second).toEqual({ changed: [], warnings: [] });
  });

  test("a SKILL.md symlinked outside plugins/cache is not written and warns", () => {
    const config = join(tmp, "c");
    const dir = versionDir(config);
    const outside = join(tmp, "outside.md");
    writeFileSync(outside, plain("alpha"));
    mkdirSync(join(dir, "skills", "alpha"), { recursive: true });
    symlinkSync(outside, join(dir, "skills", "alpha", "SKILL.md"));
    const r = reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(read(outside)).toBe(plain("alpha"));
    expect(r.changed).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  test("two config dirs sharing one plugins folder are edited once", () => {
    const a = join(tmp, "a");
    const f = skill(versionDir(a), "skills/alpha", plain("alpha"));
    const b = join(tmp, "b");
    mkdirSync(b);
    symlinkSync(join(a, "plugins"), join(b, "plugins"));
    const r = reconcileDisableModelInvocation({ configDirs: [a, b], choices: { [KEY]: ["alpha"] } });
    expect(r).toEqual({ changed: [f], warnings: [] });
  });

  test("two config dirs sharing one plugins folder give one warning", () => {
    const a = join(tmp, "a");
    const f = skill(versionDir(a), "skills/alpha", "just text\n");
    const b = join(tmp, "b");
    mkdirSync(b);
    symlinkSync(join(a, "plugins"), join(b, "plugins"));
    const r = reconcileDisableModelInvocation({ configDirs: [a, b], choices: { [KEY]: ["alpha"] } });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain(f);
  });

  test("no frontmatter warns and names the file", () => {
    const config = join(tmp, "c");
    const f = skill(versionDir(config), "skills/alpha", "just text\n");
    const r = reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(r.changed).toEqual([]);
    expect(r.warnings[0]).toContain(f);
  });

  test("an unusual disable-model-invocation value warns and names the file", () => {
    const config = join(tmp, "c");
    const f = skill(versionDir(config), "skills/alpha", `---\nname: alpha\ndisable-model-invocation: "true"\n---\nb\n`);
    const r = reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(r.changed).toEqual([]);
    expect(r.warnings[0]).toContain(f);
  });

  test("a source value of true is left alone without a warning", () => {
    const config = join(tmp, "c");
    skill(versionDir(config), "skills/alpha", `---\nname: alpha\ndisable-model-invocation: true\n---\nb\n`);
    const r = reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(r).toEqual({ changed: [], warnings: [] });
  });

  test("a read-only SKILL.md warns, keeps its content and mode, and the other skills still apply", () => {
    const config = join(tmp, "c");
    const dir = versionDir(config);
    const locked = skill(dir, "skills/alpha", plain("alpha"));
    const other = skill(dir, "skills/beta", plain("beta"));
    chmodSync(locked, 0o444);
    try {
      const r = reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha", "beta"] } });
      expect(r.changed).toEqual([other]);
      expect(r.warnings.some((w) => w.includes(locked))).toBe(true);
      expect(read(locked)).toBe(plain("alpha"));
      expect(statSync(locked).mode & 0o777).toBe(0o444);
    } finally {
      chmodSync(locked, 0o644);
    }
  });

  test("a rewritten SKILL.md keeps its mode", () => {
    const config = join(tmp, "c");
    const f = skill(versionDir(config), "skills/alpha", plain("alpha"));
    chmodSync(f, 0o640);
    reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(read(f)).toContain(PERSONAL_MARK);
    expect(statSync(f).mode & 0o777).toBe(0o640);
  });

  test("a version folder removed mid-run stops that plugin with no warning", () => {
    const config = join(tmp, "c");
    const dir = versionDir(config);
    skill(dir, "skills/alpha", plain("alpha"));
    skill(dir, "skills/beta", plain("beta"));
    const r = reconcileDisableModelInvocation({
      configDirs: [config],
      choices: { [KEY]: ["alpha", "beta"] },
      beforeSkill: () => rmSync(dir, { recursive: true, force: true }),
    });
    expect(r).toEqual({ changed: [], warnings: [] });
  });

  test("an empty or multi-word disable-model-invocation value is left alone with a warning", () => {
    for (const line of ["disable-model-invocation:", "disable-model-invocation: not yet"]) {
      const config = join(tmp, `c${line.length}`);
      const text = `---\nname: alpha\n${line}\n---\nb\n`;
      const f = skill(versionDir(config), "skills/alpha", text);
      const r = reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
      expect(read(f)).toBe(text);
      expect(r.changed).toEqual([]);
      expect(r.warnings[0]).toContain(f);
    }
  });

  test("the unusual-value warning is not fooled by the mark in body text", () => {
    const config = join(tmp, "c");
    const text = `---\nname: alpha\ndisable-model-invocation: "true"\n---\n${PERSONAL_MARK}\n`;
    const f = skill(versionDir(config), "skills/alpha", text);
    const r = reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
    expect(r.warnings[0]).toContain(f);
  });

  describe("installed_plugins.json", () => {
    const registry = (config: string, text: string) => writeFileSync(join(config, "plugins", "installed_plugins.json"), text);
    const at = (config: string, v: string) => join(config, "plugins", "cache", "market", "widgets", v);

    test("installPath beats a higher semver folder", () => {
      const config = join(tmp, "c");
      const hashed = skill(versionDir(config, "abc123"), "skills/alpha", plain("alpha"));
      const higher = skill(versionDir(config, "9.0.0"), "skills/alpha", plain("alpha"));
      registry(config, JSON.stringify({ plugins: { [KEY]: [
        { scope: "project", installPath: at(config, "9.0.0") },
        { scope: "user", installPath: at(config, "abc123") },
      ] } }));
      reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
      expect(read(hashed)).toContain(PERSONAL_MARK);
      expect(read(higher)).toBe(plain("alpha"));
    });

    test("an installPath outside the cache is ignored", () => {
      const config = join(tmp, "c");
      const cur = skill(versionDir(config, "1.0.0"), "skills/alpha", plain("alpha"));
      const elsewhere = skill(join(tmp, "elsewhere"), "skills/alpha", plain("alpha"));
      registry(config, JSON.stringify({ plugins: { [KEY]: [{ scope: "user", installPath: join(tmp, "elsewhere") }] } }));
      reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
      expect(read(cur)).toContain(PERSONAL_MARK);
      expect(read(elsewhere)).toBe(plain("alpha"));
    });

    test("a missing or malformed file falls back to the newest folder with no warning", () => {
      const config = join(tmp, "c");
      const f = skill(versionDir(config, "1.0.0"), "skills/alpha", plain("alpha"));
      const missing = reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
      expect(missing.warnings).toEqual([]);
      expect(read(f)).toContain(PERSONAL_MARK);
      reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: [] } });
      registry(config, "{not json");
      const bad = reconcileDisableModelInvocation({ configDirs: [config], choices: { [KEY]: ["alpha"] } });
      expect(bad.warnings).toEqual([]);
      expect(read(f)).toContain(PERSONAL_MARK);
    });
  });
});

describe("disableModelInvocationConfigDirs", () => {
  test("dedupes by the realpath of plugins and skips sessions without one", () => {
    const home = join(tmp, "home");
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    const sessions = join(home, ".claude-swap-backup", "sessions");
    mkdirSync(join(sessions, "linked"), { recursive: true });
    symlinkSync(join(home, ".claude", "plugins"), join(sessions, "linked", "plugins"));
    mkdirSync(join(sessions, "own", "plugins"), { recursive: true });
    mkdirSync(join(sessions, "bare"), { recursive: true });
    expect(disableModelInvocationConfigDirs({}, home)).toEqual([join(home, ".claude"), join(sessions, "own")]);
  });

  test("CLAUDE_CONFIG_DIR replaces ~/.claude", () => {
    const home = join(tmp, "home");
    const custom = join(tmp, "custom");
    mkdirSync(join(custom, "plugins"), { recursive: true });
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    expect(disableModelInvocationConfigDirs({ CLAUDE_CONFIG_DIR: custom }, home)).toEqual([custom]);
  });
});
