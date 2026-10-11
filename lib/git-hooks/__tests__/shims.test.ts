import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { generateShims } from "../shims.ts";

describe("git hook shims", () => {
  let dir: string;
  let dataDir: string;
  let repoRoot: string;
  let marker: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rt-shims-"));
    dataDir = join(dir, "data");
    repoRoot = join(dir, "repo");
    mkdirSync(join(repoRoot, ".husky"), { recursive: true });
    Bun.spawnSync(["git", "init", "-q", repoRoot]);
    marker = join(dir, "ran");
    writeFileSync(join(repoRoot, ".husky", "pre-push"), `#!/bin/bash\ncat > ${JSON.stringify(marker)}\n`, { mode: 0o755 });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function fakeRt(body: string, at = join(dir, "fake-rt")): string {
    mkdirSync(join(at, ".."), { recursive: true });
    writeFileSync(at, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    return at;
  }
  function runShim(hook: string, stdin = ""): { code: number; stderr: string; ms: number } {
    const start = performance.now();
    const res = Bun.spawnSync(["bash", join(dataDir, "hooks", hook)], { cwd: repoRoot, stdin: Buffer.from(stdin), env: { PATH: "/usr/bin:/bin" } });
    return { code: res.exitCode, stderr: res.stderr.toString(), ms: performance.now() - start };
  }

  test("rt answers off: the hook is skipped with a note", () => {
    generateShims(dataDir, ["pre-push"], { rtArgv: [fakeRt('[ "$1 $2" = "hook-state pre-push" ] && echo off')] });
    const res = runShim("pre-push");
    expect(res.code).toBe(0);
    expect(res.stderr).toContain("rt: pre-push skipped (turned off with rt hooks)");
    expect(existsSync(marker)).toBe(false);
  });

  test("rt answers on: the real hook runs and gets the hook's stdin", () => {
    generateShims(dataDir, ["pre-push"], { rtArgv: [fakeRt("cat >/dev/null; echo on")] });
    expect(runShim("pre-push", "refs/heads/main abc\n").code).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("refs/heads/main abc\n");
  });

  test("rt fails: the real hook runs", () => {
    generateShims(dataDir, ["pre-push"], { rtArgv: [fakeRt("echo off >&2; exit 2")] });
    runShim("pre-push");
    expect(existsSync(marker)).toBe(true);
  });

  test("rt is missing: the real hook runs", () => {
    generateShims(dataDir, ["pre-push"], { rtArgv: [join(dir, "no-such-rt")] });
    runShim("pre-push");
    expect(existsSync(marker)).toBe(true);
  });

  test("rt is too slow: the real hook runs once the timeout passes", () => {
    generateShims(dataDir, ["pre-push"], { rtArgv: [fakeRt("sleep 5; echo off")], timeoutSecs: 1 });
    const res = runShim("pre-push");
    expect(existsSync(marker)).toBe(true);
    expect(res.ms).toBeLessThan(4000);
  });

  test("a child rt leaves holding stdout does not keep the shim waiting", () => {
    generateShims(dataDir, ["pre-push"], { rtArgv: [fakeRt("sleep 8 & echo off")], timeoutSecs: 10 });
    const res = runShim("pre-push");
    expect(res.stderr).toContain("skipped");
    expect(res.ms).toBeLessThan(4000);
  }, 20000);

  test("an rt path with spaces and a quote still reaches rt", () => {
    generateShims(dataDir, ["pre-push"], { rtArgv: [fakeRt("echo off", join(dir, "it's here", "rt"))] });
    expect(runShim("pre-push").stderr).toContain("skipped");
  });

  test("a shim reads no file of rt's, and pre-commit keeps the on-deck guard", () => {
    generateShims(dataDir, [], { rtArgv: ["/x/rt"] });
    const shim = readFileSync(join(dataDir, "hooks", "pre-commit"), "utf8");
    expect(shim).toContain("hook-state");
    expect(shim).not.toContain("hooks.json");
    expect(shim).toContain("on-deck/*");
    expect(shim).toContain("commits are not allowed on on-deck branches");
    expect(shim).toContain('exec "$REAL_HOOK" "$@"');
  });

  test("a non-pre-commit hook carries no on-deck guard", () => {
    generateShims(dataDir, ["pre-push"], { rtArgv: ["/x/rt"] });
    expect(readFileSync(join(dataDir, "hooks", "pre-push"), "utf8")).not.toContain("on-deck");
  });
});
