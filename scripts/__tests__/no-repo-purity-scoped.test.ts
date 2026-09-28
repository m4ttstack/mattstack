import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const SCRIPT = join(import.meta.dir, "..", "repo-purity.sh");
const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const GIT_QUIET = ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];

function repoWith(files: Record<string, string>, prepare: (dir: string) => void = () => {}): string {
  const dir = mkdtempSync(join(tmpdir(), "rt-purity-scoped-"));
  made.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(dir, "scripts", "repo-purity.sh"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  prepare(dir);
  execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, ...GIT_QUIET, "commit", "-qm", "seed"]);
  return dir;
}

function run(dir: string, env: Record<string, string> = {}): { code: number; out: string } {
  const r = spawnSync("sh", [join(dir, "scripts", "repo-purity.sh")], {
    encoding: "utf8",
    env: { ...process.env, PURITY_BASE: "HEAD", ...env },
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe("scoped purity terms", () => {
  test("a scoped term inside its directory fails the gate", () => {
    const dir = repoWith({ "plugins/probe/README.md": "uses PROBE_SCOPED_TERM here\n" });
    const r = run(dir, { PURITY_SCOPED_EXTRA: "plugins/probe\tPROBE_SCOPED_TERM" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("FAIL repo-purity (plugins/probe)");
  });

  test("the same term outside the directory passes", () => {
    const dir = repoWith({ "lib/x.ts": "// PROBE_SCOPED_TERM is fine here\n" });
    const r = run(dir, { PURITY_SCOPED_EXTRA: "plugins/probe\tPROBE_SCOPED_TERM" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("ok   repo-purity");
  });

  test("a scoped term in a file name inside the directory fails", () => {
    const dir = repoWith({ "plugins/probe/probe_scoped_term.md": "clean\n" });
    const r = run(dir, { PURITY_SCOPED_EXTRA: "plugins/probe\tPROBE_SCOPED_TERM" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("FAIL repo-purity (plugins/probe)");
  });

  test("a pattern with alternation catches every alternative", () => {
    const dir = repoWith({ "plugins/probe/notes.md": "mentions BETA_TERM only\n" });
    const r = run(dir, { PURITY_SCOPED_EXTRA: "plugins/probe\tALPHA_TERM|BETA_TERM" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("BETA_TERM");
  });

  test("the built-in herdr-chat entry with an empty pattern is skipped", () => {
    const dir = repoWith({ "plugins/herdr-chat/x.md": "ordinary plugin notes\n" });
    const r = run(dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain("ok   repo-purity");
  });

  test("a hit in a single file names that file", () => {
    const dir = repoWith({ "plugins/probe/README.md": "uses PROBE_SCOPED_TERM here\n" });
    const r = run(dir, { PURITY_SCOPED_EXTRA: "plugins/probe\tPROBE_SCOPED_TERM" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("plugins/probe/README.md:");
  });

  test("a pattern starting with a dash is a pattern, not an option", () => {
    const dir = repoWith({ "plugins/probe/notes.md": "has -dashterm inside\n" });
    const r = run(dir, { PURITY_SCOPED_EXTRA: "plugins/probe\t-dashterm" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("FAIL repo-purity (plugins/probe)");
  });

  test("a malformed pattern fails closed", () => {
    const dir = repoWith({ "plugins/probe/notes.md": "clean\n" });
    const r = run(dir, { PURITY_SCOPED_EXTRA: "plugins/probe\t(unclosed" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("FAIL repo-purity (plugins/probe): grep error");
  });

  test("a dangling symlink in the directory is not a grep error", () => {
    const dir = repoWith({ "plugins/probe/notes.md": "clean\n" }, (d) =>
      symlinkSync("missing-target.md", join(d, "plugins/probe/dangling.md")),
    );
    const r = run(dir, { PURITY_SCOPED_EXTRA: "plugins/probe\tPROBE_SCOPED_TERM" });
    expect(r.out).toContain("ok   repo-purity");
    expect(r.code).toBe(0);
  });

  test("a directory operand (gitlink) is not a grep error", () => {
    const dir = repoWith({ "plugins/probe/notes.md": "clean\n" }, (d) => {
      const nested = join(d, "plugins/probe/vendored");
      mkdirSync(nested, { recursive: true });
      execFileSync("git", ["init", "-q", "-b", "main", nested]);
      writeFileSync(join(nested, "x.md"), "clean\n");
      execFileSync("git", ["-C", nested, "add", "-A"]);
      execFileSync("git", ["-C", nested, ...GIT_QUIET, "commit", "-qm", "inner"]);
    });
    const r = run(dir, { PURITY_SCOPED_EXTRA: "plugins/probe\tPROBE_SCOPED_TERM" });
    expect(r.out).toContain("ok   repo-purity");
    expect(r.code).toBe(0);
  });

  test("a tracked file deleted from the working tree is not a grep error", () => {
    const dir = repoWith({ "plugins/probe/notes.md": "clean\n", "plugins/probe/gone.md": "clean\n" });
    unlinkSync(join(dir, "plugins/probe/gone.md"));
    const r = run(dir, { PURITY_SCOPED_EXTRA: "plugins/probe\tPROBE_SCOPED_TERM" });
    expect(r.out).toContain("ok   repo-purity");
    expect(r.code).toBe(0);
  });
});
