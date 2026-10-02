/**
 * The CLI takes its local branch here. `daemonPresent()` reads
 * `DAEMON_PID_PATH`/`DAEMON_SOCK_PATH`, which are module-load constants bound
 * to the throwaway HOME the bunfig preload (test-setup.ts) sets before any
 * module loads — not to the per-test HOME below. That tree holds neither a pid
 * file nor a socket, so the apply happens in-process, which is exactly the
 * "no daemon, nothing to race" branch.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeStateDb, setKvValue } from "../../lib/state/index.ts";
import { loadRepoIndex } from "../../lib/repo-index.ts";
import { saveRegistry, loadRegistry } from "../../lib/worktree/registry.ts";
import { deriveRepoIdentity, serializeIdentity } from "../../lib/settings/identity.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { reposLocate, type RegisterDeps } from "../repos.ts";

function testDeps(): RegisterDeps & { lines: string[] } {
  const lines: string[] = [];
  return { print: (s) => lines.push(s), lines };
}

async function runExpectingProcessExit(fn: () => Promise<void>): Promise<number | undefined> {
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  try {
    await fn();
    return undefined;
  } catch {
    return exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
  } finally {
    exitSpy.mockRestore();
  }
}

/** Runs a verb with plain output captured: stdout by line, and stderr whole. */
async function human(fn: () => Promise<void>): Promise<{ lines: string[]; stderr: string; code: number | undefined }> {
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  try {
    const code = await runExpectingProcessExit(fn);
    return { lines: io.lines(), stderr: io.stderr(), code };
  } finally {
    io.restore();
  }
}

describe("reposLocate", () => {
  const origHome = process.env.HOME;
  let home: string;
  let scratch: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-locate-cli-home-")));
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "rt-locate-cli-repos-")));
    process.env.HOME = home;
    closeStateDb();
  });

  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  async function movedRepo(name: string): Promise<{ identity: string; from: string; to: string }> {
    const dir = join(scratch, name);
    mkdirSync(dir, { recursive: true });
    execSync("git init -q -b main", { cwd: dir, stdio: "pipe" });
    execSync(`git remote add origin https://gitlab.com/g/${name}.git`, { cwd: dir, stdio: "pipe" });
    execSync("git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init", { cwd: dir, stdio: "pipe" });
    const from = realpathSync(dir);
    const identity = serializeIdentity(await deriveRepoIdentity(from));
    setKvValue("repo-index", identity, from);
    saveRegistry(identity, [{ name: "main", path: from, kind: "main", branch: "main", createdAt: "2026-01-01T00:00:00.000Z" }]);
    const to = join(scratch, `${name}-moved`);
    renameSync(from, to);
    return { identity, from, to };
  }

  test("locates a moved repo and says where it went", async () => {
    const { identity, from, to } = await movedRepo("alpha");
    const deps = testDeps();

    const { lines } = await human(() => reposLocate([to], {}, deps));

    expect(loadRepoIndex()[identity]).toBe(to);
    expect(loadRegistry(identity)[0]?.path).toBe(to);
    expect(lines[0]).toStartWith("[ok] Moved ");
    expect(lines[0]).toContain(`${from} → ${to}`);
  });

  test("--dry-run reports the plan and writes nothing", async () => {
    const { identity, from, to } = await movedRepo("beta");
    const deps = testDeps();

    const { lines } = await human(() => reposLocate([to, "--dry-run"], {}, deps));

    expect(loadRepoIndex()[identity]).toBe(from);
    expect(lines[0]).toStartWith("[not yet] Would move ");
  });

  test("--json emits a contract envelope", async () => {
    const { identity, to } = await movedRepo("gamma");
    const deps = testDeps();

    await reposLocate([to, "--json"], {}, deps);

    const parsed = JSON.parse(deps.lines[0]!);
    expect(parsed.contract).toBe(1);
    expect(parsed.located.identity).toBe(identity);
    expect(parsed.located.to).toBe(to);
  });

  test("--repo resolves to an identity and is honoured", async () => {
    const { identity, to } = await movedRepo("delta");
    const deps = testDeps();

    await human(() => reposLocate([to, "--repo", identity], {}, deps));

    expect(loadRepoIndex()[identity]).toBe(to);
  });

  test("the error envelopes the copy pass rewords keep their shape and codes", async () => {
    const plain = join(scratch, "plain");
    mkdirSync(plain);
    const { to } = await movedRepo("epsilon");
    const cases: Array<[string[], string, RegExp]> = [
      [[plain, "--json"], "refused", /^not-a-git-repo: /],
      [[to, "--repo", "no-such-repo", "--json"], "repo-unknown", /no-such-repo/],
    ];
    for (const [args, code, message] of cases) {
      const deps = testDeps();
      expect(await runExpectingProcessExit(() => reposLocate(args, {}, deps))).toBe(2);
      expect(deps.lines).toHaveLength(1);
      const body = JSON.parse(deps.lines[0]!);
      expect(Object.keys(body).sort()).toEqual(["at", "contract", "error"]);
      expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
      expect(body.error.code).toBe(code);
      expect(body.error.message).toMatch(message);
    }
  });

  test("a refusal from locate is a refused line on stderr, and its envelope keeps code refused", async () => {
    const plain = join(scratch, "plain");
    mkdirSync(plain);
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const forAPerson = testDeps();
      expect(await runExpectingProcessExit(() => reposLocate([plain], {}, forAPerson))).toBe(2);
      expect(forAPerson.lines).toEqual([]);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe(`[refused] ${plain} is not a git repo\n`);

      const forAProgram = testDeps();
      expect(await runExpectingProcessExit(() => reposLocate([plain, "--json"], {}, forAProgram))).toBe(2);
      expect(JSON.parse(forAProgram.lines[0]!).error).toEqual({ code: "refused", message: `not-a-git-repo: ${plain} is not a git repo` });
    } finally {
      io.restore();
    }
  });

  test("a repo name rt does not know is one failure in plain words", async () => {
    const { to } = await movedRepo("zeta");
    const { code, stderr } = await human(() => reposLocate([to, "--repo", "no-such-repo"], {}, testDeps()));
    expect(code).toBe(2);
    expect(stderr).toBe('rt does not know a repo called "no-such-repo"\n  why: Name a repo rt has registered, or run this from inside one.\n');
  });

  test("an unknown flag is a usage error", async () => {
    const deps = testDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => reposLocate(["--nope"], {}, deps));
      expect(code).toBe(2);
      expect(io.stderr()).toContain("  next: rt repos locate [<new-path>] [--repo <id|name>] [--dry-run] [--json]\n");
      expect(io.stderr()).toStartWith("This command has no option called ");
    } finally {
      io.restore();
    }
  });

  test("--repo without a value is a usage error", async () => {
    const deps = testDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => reposLocate(["--repo"], {}, deps));
      expect(code).toBe(2);
      expect(io.stderr()).toStartWith("Which repo moved?\n");
    } finally {
      io.restore();
    }
  });

  test("a second positional is a usage error, not a silently ignored path", async () => {
    const deps = testDeps();
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      const code = await runExpectingProcessExit(() => reposLocate([scratch, join(scratch, "other")], {}, deps));
      expect(code).toBe(2);
      expect(io.stderr()).toStartWith("One folder at a time\n  why: You passed 2: ");
    } finally {
      io.restore();
    }
  });

  test("no path and no lost rows exits 1 saying so", async () => {
    const deps = testDeps();
    const { code, stderr, lines } = await human(() => reposLocate([], {}, deps));
    expect(code).toBe(1);
    expect(stderr).toBe("No repo is missing\n  why: Every repo rt knows is where it should be.\n");
    expect(lines).toEqual([]);
  });

  test("no path, a lost row and no candidate lists the lost row and exits 1", async () => {
    setKvValue("repo-index", "remote:gitlab.com%2Fg%2Fghost", join(scratch, "ghost"));
    const deps = testDeps();

    const { code, stderr } = await human(() => reposLocate([], {}, deps));

    expect(code).toBe(1);
    expect(stderr).toStartWith("Which folder did it move to?\n");
    expect(stderr).toContain("Missing repos\n");
    // The serialized identity is decoded to a friendly label before display,
    // so the lost row lists the repo name, never the raw serialized identity.
    expect(stderr).toContain("ghost");
    expect(stderr).not.toContain("remote:gitlab.com");
  });
});
