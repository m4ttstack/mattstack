/** The real seams end to end: a temp HOME, a real user store, a real repo with a local bare origin. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setSetting } from "../../../packages/rt-client/src/settings/write.ts";
import { checkTree, realCheckDeps } from "../index.ts";
import { readConfig, runCheck } from "../run.ts";

const IDENTITY = "github.com/acme/widgets";
const GREEN = `printf '{"mode":"changed","selected":3,"passed":3,"failed":0}\\n'`;

const realHome = process.env.HOME;
let home: string;
let origin: string;
let tree: string;

const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: tree, stdio: "pipe" }).toString().trim();
const setCheck = (value: Record<string, unknown>) => setSetting("rt.check", value, "user", { repoIdentity: IDENTITY });

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-check-home-")));
  process.env.HOME = home;
  origin = realpathSync(mkdtempSync(join(tmpdir(), "rt-check-origin-")));
  tree = realpathSync(mkdtempSync(join(tmpdir(), "rt-check-tree-")));
  execFileSync("git", ["init", "--bare", "-b", "main", origin], { stdio: "pipe" });
  git("init", "-b", "main");
  git("commit", "--allow-empty", "-m", "one");
  git("remote", "add", "origin", origin);
  git("push", "-u", "origin", "main");
  git("fetch", "origin");
  git("checkout", "-b", "feat/x");
  git("commit", "--allow-empty", "-m", "two");
  setSetting("rt.repoIdentityOverrides", { [origin]: IDENTITY }, "machine");
});

afterEach(() => {
  process.env.HOME = realHome;
  for (const dir of [home, origin, tree]) rmSync(dir, { recursive: true, force: true });
});

describe("readConfig over the real settings seam", () => {
  test("reads a user-scope value and expands ${repoRoot} to the tree", () => {
    setCheck({ command: "${repoRoot}/check.sh", timeoutSeconds: 30 });
    expect(readConfig(tree, realCheckDeps)).toEqual({ command: `${tree}/check.sh`, timeoutSeconds: 30 });
  });

  test("an unset key is no check", () => {
    expect(readConfig(tree, realCheckDeps)).toBeNull();
  });
});

describe("runCheck over realCheckDeps", () => {
  test("a real command's summary and environment come back green", async () => {
    setCheck({ command: `echo "$RT_CHECK_TREE $RT_CHECK_BASE $RT_CHECK_HEAD" >&2; ${GREEN}` });
    const r = await runCheck(tree, {}, realCheckDeps);
    expect(r).toMatchObject({
      verdict: "green",
      sha: git("rev-parse", "HEAD"),
      base: git("rev-parse", "main"),
      dirty: false,
      summary: { mode: "changed", selected: 3 },
    });
    if (r.configured) expect(r.outputTail).toContain(tree);
  });

  test("a non-zero exit with no summary is red", async () => {
    setCheck({ command: "echo nope; exit 3" });
    expect(await runCheck(tree, {}, realCheckDeps)).toMatchObject({ verdict: "red", outputTail: "nope", summary: { mode: "exit" } });
  });

  test("real git refuses a base that is no commit, and takes one that is", async () => {
    setCheck({ command: GREEN });
    expect(await runCheck(tree, { base: "origin/nope" }, realCheckDeps)).toMatchObject({ verdict: "error", notRun: true });
    expect(await runCheck(tree, { base: "--all" }, realCheckDeps)).toMatchObject({ verdict: "error", notRun: true });
    expect(await runCheck(tree, { base: "main" }, realCheckDeps)).toMatchObject({ verdict: "green", base: "main" });
  });
});

describe("checkTree over realCheckDeps", () => {
  test("a value that cannot expand is an error verdict, never no check", async () => {
    setCheck({ command: "${worktree}/check.sh" });
    const run = await checkTree(tree, { post: false }, realCheckDeps);
    expect(run.result).toMatchObject({ configured: true, verdict: "error", sha: git("rev-parse", "HEAD") });
    if (run.result.configured) expect(run.result.reason).toContain("worktree");
  });

  test("a second clean run reuses the green from the real cache file", async () => {
    setCheck({ command: GREEN });
    expect((await checkTree(tree, { post: false }, realCheckDeps)).result).toMatchObject({ verdict: "green", fromCache: false });
    expect((await checkTree(tree, { post: false }, realCheckDeps)).result).toMatchObject({ verdict: "green", fromCache: true });
  });

  test("a command that leaves a file behind is dirty, so nothing is cached", async () => {
    setCheck({ command: `touch left-behind; ${GREEN}` });
    expect((await checkTree(tree, { post: false }, realCheckDeps)).result).toMatchObject({ verdict: "green", dirty: true });
    rmSync(join(tree, "left-behind"));
    expect((await checkTree(tree, { post: false }, realCheckDeps)).result).toMatchObject({ fromCache: false });
  });

  test("a tree that goes dirty between runs runs again", async () => {
    setCheck({ command: GREEN });
    await checkTree(tree, { post: false }, realCheckDeps);
    writeFileSync(join(tree, "scratch.txt"), "x");
    expect((await checkTree(tree, { post: false }, realCheckDeps)).result).toMatchObject({ fromCache: false, dirty: true });
  });
});
