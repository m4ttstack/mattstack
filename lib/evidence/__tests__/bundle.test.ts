import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { workRoot } from "../../daemon/upload-guard.ts";
import { allowedSourceRoots, bundleMembers, bundleStem, copyIntoRun } from "../bundle.ts";

let base: string;
let src: string;
let dest: string;
const savedEnv = { HOME: process.env.HOME, RT_RUNS_ROOT: process.env.RT_RUNS_ROOT };

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "bundle-")));
  src = join(base, "src");
  dest = join(base, "run", "evidence", "retry-badge");
  mkdirSync(src, { recursive: true });
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(base, { recursive: true, force: true });
});

const put = (name: string, body = name) => {
  const p = join(src, name);
  writeFileSync(p, body);
  return p;
};
const opts = () => ({ allowedRoots: [src], referencedElsewhere: new Set<string>() });

describe("bundleStem", () => {
  test("strips a capture suffix and the extension", () => {
    expect(bundleStem("r1-badge-before.c1.png")).toBe("r1-badge-before");
    expect(bundleStem("shot.png")).toBe("shot");
    expect(bundleStem(".x.png")).toBeNull();
    expect(bundleStem("noext")).toBeNull();
  });
});

describe("bundleMembers", () => {
  test("keeps only bundle files, sorted", () => {
    const names = ["s.png", "s.c1.png", "s.c1.capture.json", "s.spec.json", "s.redactions.json", "s.redact-1.png", "s.c1.png.bak", "s-other.png", "app.ts"];
    expect(bundleMembers(src, "s.c1.png", () => names)).toEqual(
      ["s.c1.capture.json", "s.c1.png", "s.png", "s.redact-1.png", "s.redactions.json", "s.spec.json"].sort(),
    );
  });
  test("a dotfile has no bundle", () => {
    expect(bundleMembers(src, ".x.png", () => [".x.png"])).toEqual([]);
  });
});

describe("copyIntoRun", () => {
  test("copies the whole bundle and maps the requested file", () => {
    const board = put("s.png");
    put("s.c1.png");
    put("s.spec.json");
    put("other.png");
    const r = copyIntoRun([{ src: board, destDir: dest }], opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(readdirSync(dest).sort()).toEqual(["s.c1.png", "s.png", "s.spec.json"]);
    expect(r.mapped.get(board)).toBe(join(dest, "s.png"));
  });

  test("single copies only the file", () => {
    const t = put("transcript.log");
    put("transcript.png");
    const r = copyIntoRun([{ src: t, destDir: dest, single: true }], opts());
    expect(r.ok).toBe(true);
    expect(readdirSync(dest)).toEqual(["transcript.log"]);
  });

  test("refuses a source outside the roots and writes nothing", () => {
    const outside = join(base, "elsewhere.png");
    writeFileSync(outside, "x");
    const inside = put("a.png");
    const r = copyIntoRun([{ src: inside, destDir: dest }, { src: outside, destDir: dest }], opts());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("elsewhere.png");
    expect(() => statSync(dest)).toThrow();
  });

  test("refuses a symlink pointing outside the roots", () => {
    const outside = join(base, "target.png");
    writeFileSync(outside, "x");
    const link = join(src, "link.png");
    symlinkSync(outside, link);
    expect(copyIntoRun([{ src: link, destDir: dest }], opts()).ok).toBe(false);
  });

  test("refuses a file with two hard links", () => {
    const a = put("a.png");
    linkSync(a, join(base, "twin.png"));
    expect(copyIntoRun([{ src: a, destDir: dest }], opts()).ok).toBe(false);
  });

  test("identical bytes are not rewritten, different bytes are", () => {
    const a = put("a.png", "one");
    expect(copyIntoRun([{ src: a, destDir: dest }], opts()).ok).toBe(true);
    const target = join(dest, "a.png");
    utimesSync(target, 1000, 1000);
    expect(copyIntoRun([{ src: a, destDir: dest }], opts()).ok).toBe(true);
    expect(statSync(target).mtimeMs).toBe(1000 * 1000);
    writeFileSync(a, "two");
    expect(copyIntoRun([{ src: a, destDir: dest }], opts()).ok).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("two");
  });

  test("a differing destination referenced elsewhere is a collision", () => {
    const a = put("a.png", "one");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "a.png"), "other");
    put("a.spec.json");
    const r = copyIntoRun([{ src: a, destDir: dest }], { allowedRoots: [src], referencedElsewhere: new Set([join(dest, "a.png")]) });
    expect(r.ok).toBe(false);
    expect(readdirSync(dest)).toEqual(["a.png"]);
    expect(readFileSync(join(dest, "a.png"), "utf8")).toBe("other");
  });

  test("never copies a dotfile or a script", () => {
    const dot = put(".hidden.png");
    const sh = put("run.sh");
    expect(copyIntoRun([{ src: dot, destDir: dest }], opts()).ok).toBe(false);
    expect(copyIntoRun([{ src: sh, destDir: dest }], opts()).ok).toBe(false);
    expect(() => statSync(dest)).toThrow();
  });

  test("a source already in destDir maps to itself", () => {
    mkdirSync(dest, { recursive: true });
    const inPlace = join(dest, "a.png");
    writeFileSync(inPlace, "x");
    const r = copyIntoRun([{ src: inPlace, destDir: dest }], { allowedRoots: [dest], referencedElsewhere: new Set() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.copied).toEqual([]);
    expect(r.mapped.get(inPlace)).toBe(inPlace);
  });
});

describe("hardening", () => {
  test("work-root sources need a run", () => {
    process.env.HOME = base;
    process.env.RT_RUNS_ROOT = join(base, "runs");
    mkdirSync(join(base, "runs", "repo", "r1"), { recursive: true });
    writeFileSync(join(base, "runs", "repo", "r1", "state.db"), "");
    const ev1 = join(base, ".mattstack", "work", "r1", "evidence");
    const ev2 = join(base, ".mattstack", "work", "r2", "evidence");
    mkdirSync(ev1, { recursive: true });
    mkdirSync(ev2, { recursive: true });
    writeFileSync(join(ev1, "x.png"), "x");
    writeFileSync(join(ev2, "y.png"), "y");
    const o = { allowedRoots: [workRoot()], referencedElsewhere: new Set<string>() };
    expect(copyIntoRun([{ src: join(ev1, "x.png"), destDir: dest }], o).ok).toBe(true);
    expect(copyIntoRun([{ src: join(ev2, "y.png"), destDir: join(base, "d2") }], o).ok).toBe(false);
  });

  test("two different sources for one destination are refused", () => {
    mkdirSync(join(src, "a"));
    mkdirSync(join(src, "b"));
    writeFileSync(join(src, "a", "shot.png"), "one");
    writeFileSync(join(src, "b", "shot.png"), "two");
    const r = copyIntoRun(
      [{ src: join(src, "a", "shot.png"), destDir: dest }, { src: join(src, "b", "shot.png"), destDir: dest }],
      opts(),
    );
    expect(r.ok).toBe(false);
    expect(() => statSync(dest)).toThrow();
  });

  test("same bytes from two sources dedupe", () => {
    mkdirSync(join(src, "a"));
    mkdirSync(join(src, "b"));
    writeFileSync(join(src, "a", "shot.png"), "same");
    writeFileSync(join(src, "b", "shot.png"), "same");
    const r = copyIntoRun(
      [{ src: join(src, "a", "shot.png"), destDir: dest }, { src: join(src, "b", "shot.png"), destDir: dest }],
      opts(),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.copied.length).toBe(1);
  });

  test("empty and relative roots admit nothing", () => {
    const a = put("a.png");
    const r = copyIntoRun([{ src: a, destDir: dest }], { allowedRoots: ["", "rel"], referencedElsewhere: new Set() });
    expect(r.ok).toBe(false);
  });

  test("a markdown transcript copies as single", () => {
    const t = put("transcript.md");
    expect(copyIntoRun([{ src: t, destDir: dest, single: true }], opts()).ok).toBe(true);
    expect(readdirSync(dest)).toEqual(["transcript.md"]);
  });

  test("uppercase extensions join the bundle", () => {
    expect(bundleMembers(src, "S.PNG", () => ["S.PNG", "S.c1.PNG"])).toEqual(["S.PNG", "S.c1.PNG"]);
  });

  test("a symlinked destination is refused", () => {
    const a = put("a.png");
    mkdirSync(dest, { recursive: true });
    const victim = join(base, "victim.png");
    writeFileSync(victim, "v");
    symlinkSync(victim, join(dest, "a.png"));
    expect(copyIntoRun([{ src: a, destDir: dest }], opts()).ok).toBe(false);
    expect(readFileSync(victim, "utf8")).toBe("v");
  });
});

describe("allowedSourceRoots", () => {
  test("lists repo, upload, work and fast-browser roots", () => {
    const roots = allowedSourceRoots({ home: "/h", uid: 501, repoRoots: ["/repo"], uploadRoots: ["/up"] });
    expect(roots).toEqual(expect.arrayContaining(["/repo", "/up", "/h/.mattstack/work", "/h/.fast-browser/screenshots", "/private/tmp/claude-501", "/tmp/claude-501"]));
  });
});
