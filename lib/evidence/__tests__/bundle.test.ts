import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { constants as fsConstants, copyFileSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { workRoot } from "../../daemon/upload-guard.ts";
import { allowedSourceRoots, bundleMembers, bundleStem, CONTENT_DIR, copyIntoRun, mapKey } from "../bundle.ts";

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
const opts = () => ({ allowedRoots: [src], destRoot: base });

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
    expect(r.mapped.get(mapKey(board, dest))).toBe(join(dest, "s.png"));
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

  test("identical bytes are not rewritten, and different bytes never replace a file", () => {
    const a = put("a.png", "one");
    expect(copyIntoRun([{ src: a, destDir: dest }], opts()).ok).toBe(true);
    const target = join(dest, "a.png");
    utimesSync(target, 1000, 1000);
    expect(copyIntoRun([{ src: a, destDir: dest }], opts()).ok).toBe(true);
    expect(statSync(target).mtimeMs).toBe(1000 * 1000);
    writeFileSync(a, "two");
    const r = copyIntoRun([{ src: a, destDir: dest }], opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(readFileSync(target, "utf8")).toBe("one");
    const moved = r.mapped.get(mapKey(a, dest))!;
    expect(readFileSync(moved, "utf8")).toBe("two");
    expect(moved).not.toBe(target);
  });

  test("a bundle that would change a file lands whole in a content folder, names unchanged", () => {
    const a = put("a.png", "one");
    put("a.spec.json", "spec v2");
    put("a.redactions.json", "record v2");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "a.png"), "other");
    writeFileSync(join(dest, "a.spec.json"), "spec v1");
    const r = copyIntoRun([{ src: a, destDir: dest }], opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const to = r.mapped.get(mapKey(a, dest))!;
    const folder = basename(dirname(to));
    expect(dirname(dirname(to))).toBe(dest);
    expect(CONTENT_DIR.test(folder)).toBe(true);
    expect(readdirSync(join(dest, folder)).sort()).toEqual(["a.png", "a.redactions.json", "a.spec.json"]);
    expect(readFileSync(join(dest, "a.png"), "utf8")).toBe("other");
    expect(readFileSync(join(dest, "a.spec.json"), "utf8")).toBe("spec v1");
    const again = copyIntoRun([{ src: a, destDir: dest }], opts());
    expect(again.ok && again.mapped.get(mapKey(a, dest))).toBe(to);
  });

  test("copied lists only the files this call wrote", () => {
    const a = put("a.png", "one");
    put("a.spec.json", "spec");
    const first = copyIntoRun([{ src: a, destDir: dest }], opts());
    expect(first.ok && first.copied.map((c) => basename(c.to)).sort()).toEqual(["a.png", "a.spec.json"]);
    const again = copyIntoRun([{ src: a, destDir: dest }], opts());
    expect(again.ok && again.copied).toEqual([]);
    writeFileSync(join(src, "a.spec.json"), "spec v2");
    const moved = copyIntoRun([{ src: a, destDir: dest }], opts());
    expect(moved.ok && moved.copied.map((c) => basename(c.to)).sort()).toEqual(["a.png", "a.spec.json"]);
  });

  describe("a file another process lands mid-call", () => {
    const exclusive = (from: string, to: string) => copyFileSync(from, to, fsConstants.COPYFILE_EXCL);
    /** Runs land(other) during the first copy, where other is the bundle member that copy is not writing. */
    const landDuringFirstCopy = (names: string[], land: (other: string) => void) => {
      let first = true;
      return (from: string, to: string) => {
        if (first) {
          first = false;
          land(join(dirname(to), names.find((n) => n !== basename(to))!));
        }
        exclusive(from, to);
      };
    };

    test("other bytes landed after planning are refused, naming the files copied before them", () => {
      const a = put("a.png", "one");
      put("a.spec.json", "spec");
      let landed = "";
      const copyFile = landDuringFirstCopy(["a.png", "a.spec.json"], (other) => {
        landed = other;
        writeFileSync(other, "theirs");
      });
      const res = copyIntoRun([{ src: a, destDir: dest }], { ...opts(), copyFile });
      const first = join(dest, landed.endsWith("a.png") ? "a.spec.json" : "a.png");
      expect(res).toEqual({ ok: false, error: `${landed}: landed under this call with other bytes (copied before it: ${first})` });
      expect(readFileSync(landed, "utf8")).toBe("theirs");
    });

    test("a file landed between the check and the copy: other bytes are refused, the same bytes kept and not listed", () => {
      const a = put("a.png", "one");
      const theirs = (body: string) => (from: string, to: string) => {
        writeFileSync(to, body);
        exclusive(from, to);
      };
      expect(copyIntoRun([{ src: a, destDir: dest, single: true }], { ...opts(), copyFile: theirs("other") })).toEqual({
        ok: false,
        error: `${join(dest, "a.png")}: landed under this call with other bytes`,
      });
      expect(readFileSync(join(dest, "a.png"), "utf8")).toBe("other");
      rmSync(join(dest, "a.png"));
      const same = copyIntoRun([{ src: a, destDir: dest, single: true }], { ...opts(), copyFile: theirs("one") });
      expect(same.ok && same.copied).toEqual([]);
    });

    test("a symlink landed after planning is refused even when it points at the same bytes", () => {
      const a = put("a.png", "one");
      put("a.spec.json", "spec");
      const outside = join(base, "outside");
      mkdirSync(outside);
      let landed = "";
      const copyFile = landDuringFirstCopy(["a.png", "a.spec.json"], (other) => {
        landed = other;
        const twin = join(outside, basename(other));
        writeFileSync(twin, readFileSync(join(src, basename(other))));
        symlinkSync(twin, other);
      });
      const res = copyIntoRun([{ src: a, destDir: dest }], { ...opts(), copyFile });
      expect(!res.ok && res.error.startsWith(`${landed}: destination is a symlink`)).toBe(true);
      rmSync(dest, { recursive: true });
      const atCopy = (from: string, to: string) => {
        const twin = join(outside, `late-${basename(to)}`);
        writeFileSync(twin, readFileSync(from));
        symlinkSync(twin, to);
        exclusive(from, to);
      };
      expect(copyIntoRun([{ src: a, destDir: dest, single: true }], { ...opts(), copyFile: atCopy })).toEqual({
        ok: false,
        error: `${join(dest, "a.png")}: destination is a symlink`,
      });
    });

    test("a case folder that became a symlink after planning is refused and nothing lands where it points", () => {
      const a = put("a.png", "one");
      const b = put("b.png", "two");
      const second = join(base, "run", "evidence", "second-case");
      const outside = join(base, "outside");
      mkdirSync(outside);
      let first = true;
      const copyFile = (from: string, to: string) => {
        if (first) {
          first = false;
          symlinkSync(outside, dirname(to) === dest ? second : dest);
        }
        exclusive(from, to);
      };
      const res = copyIntoRun([{ src: a, destDir: dest, single: true }, { src: b, destDir: second, single: true }], { ...opts(), copyFile });
      expect(!res.ok && /: destination directory is a symlink \(copied before it: /.test(res.error)).toBe(true);
      expect(readdirSync(outside)).toEqual([]);
    });
  });

  test("a symlinked content folder, or a symlinked file inside one, is refused and nothing lands where it points", () => {
    const a = put("a.png", "one");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "a.png"), "other");
    const probe = copyIntoRun([{ src: a, destDir: dest }], opts());
    if (!probe.ok) throw new Error(probe.error);
    const folder = dirname(probe.mapped.get(mapKey(a, dest))!);
    rmSync(folder, { recursive: true });
    const elsewhere = join(base, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, folder);
    expect(copyIntoRun([{ src: a, destDir: dest }], opts())).toEqual({ ok: false, error: `${folder}: destination directory is a symlink` });
    expect(readdirSync(elsewhere)).toEqual([]);
    rmSync(folder);
    mkdirSync(folder);
    const victim = join(base, "victim.png");
    writeFileSync(victim, "v");
    symlinkSync(victim, join(folder, "a.png"));
    expect(copyIntoRun([{ src: a, destDir: dest }], opts())).toEqual({ ok: false, error: `${join(folder, "a.png")}: destination is a symlink` });
    expect(readFileSync(victim, "utf8")).toBe("v");
  });

  test("a source already in a content folder of destDir maps to itself", () => {
    const a = put("a.png", "one");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "a.png"), "other");
    const first = copyIntoRun([{ src: a, destDir: dest }], opts());
    if (!first.ok) throw new Error(first.error);
    const inFolder = first.mapped.get(mapKey(a, dest))!;
    const r = copyIntoRun([{ src: inFolder, destDir: dest }], { allowedRoots: [dest], destRoot: base });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.copied).toEqual([]);
    expect(r.mapped.get(mapKey(inFolder, dest))).toBe(inFolder);
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
    const r = copyIntoRun([{ src: inPlace, destDir: dest }], { allowedRoots: [dest], destRoot: base });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.copied).toEqual([]);
    expect(r.mapped.get(mapKey(inPlace, dest))).toBe(inPlace);
  });

  test("an in-place source maps to the destDir spelling, the same string a copy would get", () => {
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "a.png"), "x");
    const link = join(base, "link");
    symlinkSync(base, link);
    const linked = join(link, "run", "evidence", "retry-badge");
    const r = copyIntoRun([{ src: join(dest, "a.png"), destDir: linked }], { allowedRoots: [dest], destRoot: link });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mapped.get(mapKey(join(dest, "a.png"), linked))).toBe(join(linked, "a.png"));
  });

  test("one source requested into two folders maps into each", () => {
    const shot = put("shot.png");
    const other = join(base, "run", "evidence", "second");
    const r = copyIntoRun([{ src: shot, destDir: dest }, { src: shot, destDir: other }], opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mapped.get(mapKey(shot, dest))).toBe(join(dest, "shot.png"));
    expect(r.mapped.get(mapKey(shot, other))).toBe(join(other, "shot.png"));
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
    const o = { allowedRoots: [workRoot()], destRoot: base };
    expect(copyIntoRun([{ src: join(ev1, "x.png"), destDir: dest }], o).ok).toBe(true);
    expect(copyIntoRun([{ src: join(ev2, "y.png"), destDir: join(base, "d2") }], o).ok).toBe(false);
  });

  test("two different sources for one destination both land, the second in a content folder", () => {
    mkdirSync(join(src, "a"));
    mkdirSync(join(src, "b"));
    writeFileSync(join(src, "a", "shot.png"), "one");
    writeFileSync(join(src, "b", "shot.png"), "two");
    const r = copyIntoRun(
      [{ src: join(src, "a", "shot.png"), destDir: dest }, { src: join(src, "b", "shot.png"), destDir: dest }],
      opts(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(readFileSync(r.mapped.get(mapKey(join(src, "a", "shot.png"), dest))!, "utf8")).toBe("one");
    expect(readFileSync(r.mapped.get(mapKey(join(src, "b", "shot.png"), dest))!, "utf8")).toBe("two");
    expect(readFileSync(join(dest, "shot.png"), "utf8")).toBe("one");
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
    const r = copyIntoRun([{ src: a, destDir: dest }], { allowedRoots: ["", "rel"], destRoot: base });
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

  test("a symlinked evidence folder is refused and nothing lands where it points", () => {
    const a = put("a.png");
    const elsewhere = join(base, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(join(base, "run"));
    symlinkSync(elsewhere, join(base, "run", "evidence"));
    const r = copyIntoRun([{ src: a, destDir: dest }], opts());
    expect(r).toEqual({ ok: false, error: `${join(base, "run", "evidence")}: destination directory is a symlink` });
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  test("a symlinked case folder is refused", () => {
    const a = put("a.png");
    const elsewhere = join(base, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(join(base, "run", "evidence"), { recursive: true });
    symlinkSync(elsewhere, dest);
    expect(copyIntoRun([{ src: a, destDir: dest }], opts()).ok).toBe(false);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  test("a symlink above the destination root is followed", () => {
    const a = put("a.png");
    mkdirSync(join(base, "real-work"));
    symlinkSync(join(base, "real-work"), join(base, "work"));
    const to = join(base, "work", "run", "evidence", "c");
    const r = copyIntoRun([{ src: a, destDir: to }], { ...opts(), destRoot: join(base, "work") });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(base, "real-work", "run", "evidence", "c", "a.png"), "utf8")).toBe("a.png");
  });

  test("a destination outside the destination root is refused", () => {
    const a = put("a.png");
    const r = copyIntoRun([{ src: a, destDir: join(base, "run") }], { ...opts(), destRoot: join(base, "run", "evidence") });
    expect(r.ok).toBe(false);
  });
});

describe("allowedSourceRoots", () => {
  test("lists repo, upload, work and claude temp roots", () => {
    const roots = allowedSourceRoots({ home: "/h", uid: 501, repoRoots: ["/repo"], uploadRoots: ["/up"] });
    expect(roots).toEqual(expect.arrayContaining(["/repo", "/up", "/h/.mattstack/work", "/private/tmp/claude-501", "/tmp/claude-501"]));
  });

  test("the fast-browser folder is admitted only as a real directory the user owns", () => {
    const uid = process.getuid!();
    const shots = join(base, ".fast-browser", "screenshots");
    const has = (o: { uid: number | null }) => allowedSourceRoots({ home: base, uid: o.uid, repoRoots: [], uploadRoots: [] }).includes(shots);
    expect(has({ uid })).toBe(false);
    mkdirSync(shots, { recursive: true });
    expect(has({ uid })).toBe(true);
    expect(has({ uid: null })).toBe(false);
    expect(has({ uid: uid + 1 })).toBe(false);
    rmSync(shots, { recursive: true });
    mkdirSync(join(base, "elsewhere"));
    symlinkSync(join(base, "elsewhere"), shots);
    expect(has({ uid })).toBe(false);
  });
});
