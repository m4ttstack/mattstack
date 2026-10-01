/**
 * checkUploadPath: the network-free half of mr:upload. Every refusal the
 * spec lists is pinned here against real files under a temp root, so the
 * handler test can trust the guard and cover only the POST.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, relative } from "path";
import { UPLOAD_MAX_BYTES, builtInEvidenceRoot, checkUploadPath, claudeTempRoots, isInsideRoot, runEvidenceRoot, workRoot } from "../upload-guard.ts";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const GIF = Buffer.from("GIF89a\0\0\0\0\0\0\0\0\0\0", "latin1");
const WEBP = Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1");
const MP4 = Buffer.from("\0\0\0\x18ftypisom\0\0\0\0", "latin1");
const MOV = Buffer.from("\0\0\0\x14ftypqt  \0\0\0\0", "latin1");
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("checkUploadPath", () => {
  let root: string;
  let rootReal: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rt-upload-root-"));
    rootReal = realpathSync(root);
    outside = realpathSync(mkdtempSync(join(tmpdir(), "rt-upload-outside-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  function file(dir: string, name: string, bytes: Buffer): string {
    const p = join(dir, name);
    writeFileSync(p, bytes);
    return p;
  }

  test("a png under a root passes and reports its realpath, name, mime, size and bytes", () => {
    const p = file(root, "shot.png", PNG);
    expect(checkUploadPath(p, [root])).toEqual({ ok: true, realpath: join(rootReal, "shot.png"), filename: "shot.png", mime: "image/png", size: PNG.length, bytes: PNG });
  });

  test("a root given through a symlinked alias still contains the file (tmpdir is such an alias on macOS)", () => {
    const p = file(root, "shot.png", PNG);
    expect(checkUploadPath(join(rootReal, "shot.png"), [root]).ok).toBe(true);
    expect(checkUploadPath(p, [rootReal]).ok).toBe(true);
  });

  test("every allowed type passes when its bytes match, and .PNG is read case-insensitively", () => {
    for (const [name, bytes, mime] of [
      ["a.jpg", JPG, "image/jpeg"], ["a.jpeg", JPG, "image/jpeg"], ["a.gif", GIF, "image/gif"], ["a.webp", WEBP, "image/webp"],
      ["a.mp4", MP4, "video/mp4"], ["a.mov", MOV, "video/quicktime"], ["a.webm", WEBM, "video/webm"], ["a.PNG", PNG, "image/png"],
    ] as const) {
      const res = checkUploadPath(file(root, name, bytes), [root]);
      expect(res.ok, name).toBe(true);
      if (res.ok) expect(res.mime, name).toBe(mime);
    }
  });

  test("a relative path is refused", () => {
    expect(checkUploadPath("shot.png", [root])).toEqual({ ok: false, error: "path must be absolute" });
  });

  test("a non-string path is refused", () => {
    expect(checkUploadPath(5, [root])).toEqual({ ok: false, error: "path must be absolute" });
  });

  test("a missing file is refused", () => {
    const res = checkUploadPath(join(root, "nope.png"), [root]);
    expect(res).toEqual({ ok: false, error: "file not found" });
  });

  test("a directory is refused", () => {
    mkdirSync(join(root, "dir.png"));
    expect(checkUploadPath(join(root, "dir.png"), [root])).toEqual({ ok: false, error: "path is not a regular file" });
  });

  test("a symlink inside a root that points outside it is refused without reading the target", () => {
    const target = file(outside, "secret.png", PNG);
    symlinkSync(target, join(root, "link.png"));
    const res = checkUploadPath(join(root, "link.png"), [root]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("outside the allowed upload roots");
  });

  test("a file outside every root is refused naming the root classes", () => {
    const p = file(outside, "shot.png", PNG);
    expect(checkUploadPath(p, [root])).toEqual({
      ok: false,
      error: "path is outside the allowed upload roots (a worktree of the target repo, the Claude Code temp root, rt's evidence folder ~/.mattstack/evidence, a run's evidence folder, or an rt.mcp.uploadRoots entry)",
    });
  });

  test("an empty roots list refuses everything", () => {
    expect(checkUploadPath(file(root, "shot.png", PNG), []).ok).toBe(false);
  });

  test("a disallowed extension is refused before the bytes are read", () => {
    expect(checkUploadPath(file(root, "notes.txt", PNG), [root])).toEqual({
      ok: false,
      error: "extension must be one of png, jpg, jpeg, gif, webp, mp4, mov, webm",
    });
    expect(checkUploadPath(file(root, "noext", PNG), [root]).ok).toBe(false);
  });

  test("a file renamed to .png whose bytes are not a PNG is refused", () => {
    expect(checkUploadPath(file(root, "fake.png", Buffer.from("hello world, not a png")), [root])).toEqual({
      ok: false,
      error: "file bytes do not match a .png signature",
    });
    expect(checkUploadPath(file(root, "fake.mp4", PNG), [root])).toEqual({ ok: false, error: "file bytes do not match a .mp4 signature" });
  });

  test("a file over the cap is refused, and the cap defaults to 50 MB", () => {
    expect(UPLOAD_MAX_BYTES).toBe(50 * 1024 * 1024);
    const p = file(root, "big.png", Buffer.concat([PNG, Buffer.alloc(32)]));
    const res = checkUploadPath(p, [root], { maxBytes: 16 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("cap is 50 MB");
  });

  test("a root that does not exist on disk is skipped, not an error", () => {
    expect(checkUploadPath(file(root, "shot.png", PNG), ["/nonexistent/root", root]).ok).toBe(true);
  });

  test("a FIFO under a root with a .png name is refused and does not block", () => {
    const p = join(root, "pipe.png");
    execSync(`mkfifo "${p}"`);
    const res = checkUploadPath(p, [root]);
    expect(res).toEqual({ ok: false, error: "path is not a regular file" });
  });

  test("an empty, relative or non-string root is skipped, never resolved against the daemon's cwd", () => {
    const p = file(root, "shot.png", PNG);
    expect(checkUploadPath(p, [""]).ok).toBe(false);
    expect(checkUploadPath(p, ["."]).ok).toBe(false);
    expect(checkUploadPath(p, ["relative/dir"]).ok).toBe(false);
    expect(checkUploadPath(p, [5 as unknown as string]).ok).toBe(false);
  });

  test("a relative root that would resolve to the real root via cwd is still refused", () => {
    const p = file(root, "shot.png", PNG);
    const relRoot = relative(process.cwd(), rootReal);
    expect(checkUploadPath(p, [relRoot]).ok).toBe(false);
  });

  test("a bad root entry beside a valid one does not stop the valid root from admitting", () => {
    const p = file(root, "shot.png", PNG);
    expect(checkUploadPath(p, ["", ".", "relative/dir", root]).ok).toBe(true);
  });
});

describe("a run's evidence folder", () => {
  let base: string;
  let work: string;
  let workReal: string;
  let runs: string;
  let outside: string;
  const RUN = "20260928-100000-abcd-123";

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "rt-upload-evidence-"));
    work = join(base, "work");
    runs = join(base, "runs");
    outside = join(base, "outside");
    mkdirSync(work);
    mkdirSync(runs);
    mkdirSync(outside);
    workReal = realpathSync(work);
    addRun(RUN);
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function addRun(id: string, repo = "gitlab.com-acme-widgets"): void {
    mkdirSync(join(runs, repo, id), { recursive: true });
    writeFileSync(join(runs, repo, id, "state.db"), "");
  }

  function put(p: string, bytes: Buffer = PNG): string {
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, bytes);
    return p;
  }

  const opts = () => ({ workRoot: work, runsRoot: runs });

  test("a png in an existing run's evidence folder passes with its realpath", () => {
    const p = put(join(work, RUN, "evidence", "before.png"));
    const res = checkUploadPath(p, [], opts());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.realpath).toBe(join(workReal, RUN, "evidence", "before.png"));
  });

  test("a subfolder of the evidence folder passes", () => {
    expect(checkUploadPath(put(join(work, RUN, "evidence", "round-2", "after.png")), [], opts()).ok).toBe(true);
  });

  test("runEvidenceRoot names the evidence folder under the work root's realpath", () => {
    const p = put(join(work, RUN, "evidence", "before.png"));
    expect(runEvidenceRoot(realpathSync(p), opts())).toBe(join(workReal, RUN, "evidence"));
  });

  test("an evidence folder whose run does not exist is refused", () => {
    const p = put(join(work, "20260101-000000-ffff-1", "evidence", "shot.png"));
    const res = checkUploadPath(p, [], opts());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("outside the allowed upload roots");
  });

  test("a state.db that is a directory does not count as a run", () => {
    mkdirSync(join(runs, "gitlab.com-acme-widgets", "dir-run", "state.db"), { recursive: true });
    expect(checkUploadPath(put(join(work, "dir-run", "evidence", "shot.png")), [], opts()).ok).toBe(false);
  });

  test("sibling folders of the evidence folder are refused", () => {
    expect(checkUploadPath(put(join(work, RUN, "other", "shot.png")), [], opts()).ok).toBe(false);
    expect(checkUploadPath(put(join(work, RUN, "shot.png")), [], opts()).ok).toBe(false);
    expect(checkUploadPath(put(join(work, "scratch", "shot.png")), [], opts()).ok).toBe(false);
    expect(checkUploadPath(put(join(work, "shot.png")), [], opts()).ok).toBe(false);
  });

  test("a .. path out of the evidence folder is refused", () => {
    put(join(work, RUN, "secret.png"));
    mkdirSync(join(work, RUN, "evidence"), { recursive: true });
    expect(checkUploadPath(`${work}/${RUN}/evidence/../secret.png`, [], opts()).ok).toBe(false);
  });

  test("a file symlink out of the evidence folder is refused", () => {
    const target = put(join(outside, "secret.png"));
    mkdirSync(join(work, RUN, "evidence"), { recursive: true });
    symlinkSync(target, join(work, RUN, "evidence", "link.png"));
    expect(checkUploadPath(join(work, RUN, "evidence", "link.png"), [], opts()).ok).toBe(false);
  });

  test("an evidence folder that is a symlink out is refused", () => {
    put(join(outside, "shot.png"));
    mkdirSync(join(work, RUN), { recursive: true });
    symlinkSync(outside, join(work, RUN, "evidence"));
    expect(checkUploadPath(join(work, RUN, "evidence", "shot.png"), [], opts()).ok).toBe(false);
  });

  test("a run folder that is a symlink out is refused", () => {
    const other = "20260928-110000-beef-456";
    addRun(other);
    put(join(outside, "evidence", "shot.png"));
    symlinkSync(outside, join(work, other));
    expect(checkUploadPath(join(work, other, "evidence", "shot.png"), [], opts()).ok).toBe(false);
  });

  test("a work root given through a symlinked alias still admits", () => {
    const alias = join(base, "work-alias");
    symlinkSync(work, alias);
    const p = put(join(work, RUN, "evidence", "shot.png"));
    expect(checkUploadPath(p, [], { workRoot: alias, runsRoot: runs }).ok).toBe(true);
  });

  test("a non-png inside a valid evidence folder still fails the byte check", () => {
    const p = put(join(work, RUN, "evidence", "fake.png"), Buffer.from("hello world, not a png"));
    expect(checkUploadPath(p, [], opts())).toEqual({ ok: false, error: "file bytes do not match a .png signature" });
  });

  test("a missing work root or runs root refuses without throwing", () => {
    const p = put(join(work, RUN, "evidence", "shot.png"));
    expect(checkUploadPath(p, [], { workRoot: join(base, "nope"), runsRoot: runs }).ok).toBe(false);
    expect(checkUploadPath(p, [], { workRoot: work, runsRoot: join(base, "nope") }).ok).toBe(false);
  });

  test("a relative or empty work root or runs root is ignored", () => {
    const p = realpathSync(put(join(work, RUN, "evidence", "shot.png")));
    expect(runEvidenceRoot(p, { workRoot: "", runsRoot: runs })).toBeNull();
    expect(runEvidenceRoot(p, { workRoot: "work", runsRoot: runs })).toBeNull();
    expect(runEvidenceRoot(p, { workRoot: work, runsRoot: "runs" })).toBeNull();
  });

  test("default opts read HOME and RT_RUNS_ROOT at call time", () => {
    const saved = { HOME: process.env.HOME, RT_RUNS_ROOT: process.env.RT_RUNS_ROOT };
    try {
      process.env.HOME = base;
      process.env.RT_RUNS_ROOT = runs;
      expect(workRoot()).toBe(join(base, ".mattstack", "work"));
      const p = put(join(base, ".mattstack", "work", RUN, "evidence", "shot.png"));
      expect(checkUploadPath(p, []).ok).toBe(true);
    } finally {
      if (saved.HOME === undefined) delete process.env.HOME;
      else process.env.HOME = saved.HOME;
      if (saved.RT_RUNS_ROOT === undefined) delete process.env.RT_RUNS_ROOT;
      else process.env.RT_RUNS_ROOT = saved.RT_RUNS_ROOT;
    }
  });
});

describe("rt's built-in evidence root", () => {
  let base: string;
  let evidence: string;
  let evidenceReal: string;
  let outside: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "rt-upload-builtin-"));
    evidence = join(base, "evidence");
    outside = join(base, "outside");
    mkdirSync(evidence);
    mkdirSync(outside);
    evidenceReal = realpathSync(evidence);
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function put(p: string, bytes: Buffer = PNG): string {
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, bytes);
    return p;
  }

  const opts = () => ({ evidenceRoot: evidence });

  test("a png nested under the evidence root passes with no caller roots", () => {
    const p = put(join(evidence, "acme-widgets-tree", "case-42", "before.png"));
    const res = checkUploadPath(p, [], opts());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.realpath).toBe(join(evidenceReal, "acme-widgets-tree", "case-42", "before.png"));
  });

  test("a file symlink inside the evidence root that points outside it is refused", () => {
    const target = put(join(outside, "secret.png"));
    symlinkSync(target, join(evidence, "link.png"));
    const res = checkUploadPath(join(evidence, "link.png"), [], opts());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("outside the allowed upload roots");
  });

  test("a directory symlink inside the evidence root that points outside it is refused", () => {
    put(join(outside, "shot.png"));
    symlinkSync(outside, join(evidence, "case-dir"));
    expect(checkUploadPath(join(evidence, "case-dir", "shot.png"), [], opts()).ok).toBe(false);
  });

  test("a .. path out of the evidence root is refused", () => {
    put(join(outside, "secret.png"));
    expect(checkUploadPath(`${evidence}/../outside/secret.png`, [], opts()).ok).toBe(false);
    expect(checkUploadPath(`${evidence}/case-42/../../outside/secret.png`, [], opts()).ok).toBe(false);
  });

  test("a sibling whose name starts with the root's name is refused", () => {
    expect(checkUploadPath(put(join(base, "evidence-other", "shot.png")), [], opts()).ok).toBe(false);
  });

  test("an evidence root that is itself a symlink is refused, even to a real evidence dir", () => {
    const alias = join(base, "evidence-alias");
    symlinkSync(evidence, alias);
    expect(checkUploadPath(put(join(evidence, "shot.png")), [], { evidenceRoot: alias }).ok).toBe(false);
    expect(builtInEvidenceRoot(alias, process.getuid!())).toBeNull();
  });

  test("an evidence root symlinked to a broader folder does not admit that folder", () => {
    const home = join(base, "home");
    mkdirSync(join(home, ".mattstack"), { recursive: true });
    symlinkSync(home, join(home, ".mattstack", "evidence"));
    const p = put(join(home, "Pictures", "private.png"));
    expect(checkUploadPath(p, [], { evidenceRoot: join(home, ".mattstack", "evidence") }).ok).toBe(false);
  });

  test("an evidence root reached through a symlinked parent still admits", () => {
    const parentAlias = join(base, "base-alias");
    symlinkSync(base, parentAlias);
    expect(checkUploadPath(put(join(evidence, "shot.png")), [], { evidenceRoot: join(parentAlias, "evidence") }).ok).toBe(true);
    expect(builtInEvidenceRoot(join(parentAlias, "evidence"), process.getuid!())).toBe(evidenceReal);
  });

  test("an evidence root owned by another uid is refused", () => {
    const p = put(join(evidence, "shot.png"));
    expect(checkUploadPath(p, [], { evidenceRoot: evidence, uid: process.getuid!() + 1 }).ok).toBe(false);
    expect(checkUploadPath(p, [], { evidenceRoot: evidence, uid: null }).ok).toBe(false);
  });

  test("a hard link inside the evidence root to a file outside it is refused", () => {
    const target = put(join(outside, "secret.png"));
    linkSync(target, join(evidence, "hard.png"));
    expect(checkUploadPath(join(evidence, "hard.png"), [], opts())).toEqual({ ok: false, error: "file has other hard links" });
  });

  test("a non-png inside the evidence root still fails the byte check", () => {
    const p = put(join(evidence, "fake.png"), Buffer.from("hello world, not a png"));
    expect(checkUploadPath(p, [], opts())).toEqual({ ok: false, error: "file bytes do not match a .png signature" });
  });

  test("a missing or relative evidence root refuses without throwing", () => {
    const p = put(join(evidence, "shot.png"));
    expect(checkUploadPath(p, [], { evidenceRoot: join(base, "nope") }).ok).toBe(false);
    expect(checkUploadPath(p, [], { evidenceRoot: "evidence" }).ok).toBe(false);
  });

  test("the default evidence root is ~/.mattstack/evidence read from HOME at call time", () => {
    const saved = process.env.HOME;
    try {
      process.env.HOME = base;
      const p = put(join(base, ".mattstack", "evidence", "case-42", "shot.png"));
      expect(checkUploadPath(p, []).ok).toBe(true);
      expect(checkUploadPath(put(join(base, ".mattstack", "other", "shot.png")), []).ok).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.HOME;
      else process.env.HOME = saved;
    }
  });
});

describe("root helpers", () => {
  test("isInsideRoot needs a real descendant, not a prefix match or the root itself", () => {
    expect(isInsideRoot("/a/b/c.png", "/a/b")).toBe(true);
    expect(isInsideRoot("/a/bc/c.png", "/a/b")).toBe(false);
    expect(isInsideRoot("/a/b", "/a/b")).toBe(false);
    expect(isInsideRoot("/a/b/../c.png", "/a/b")).toBe(false);
  });

  test("claudeTempRoots names the private root and its /tmp alias, or nothing without a uid", () => {
    expect(claudeTempRoots(501)).toEqual(["/private/tmp/claude-501", "/tmp/claude-501"]);
    expect(claudeTempRoots(null)).toEqual([]);
  });
});
