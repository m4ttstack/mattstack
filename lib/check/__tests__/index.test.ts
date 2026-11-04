import { describe, expect, test } from "bun:test";
import { serializeIdentity } from "../../settings/identity.ts";
import type { GitRunner } from "../../mcp/git-tools.ts";
import type { RunResult } from "../../subprocess.ts";
import { checkTree, type CheckDeps } from "../index.ts";

const github = serializeIdentity({ kind: "remote", id: "github.com/acme/widgets" });

function harness(opts: { run?: Partial<RunResult>; dirty?: boolean; onRemote?: boolean; store?: Map<string, string> } = {}) {
  const store = opts.store ?? new Map<string, string>();
  const commands: string[] = [];
  const gh: string[][] = [];
  const git: GitRunner = async (args) => {
    const key = args.join(" ");
    const out: Record<string, string> = {
      "rev-parse --verify HEAD": "abc123\n",
      "status --porcelain": opts.dirty ? " M a.ts\n" : "",
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "merge-base HEAD origin/main": "base456\n",
      "rev-parse --verify --end-of-options origin/dev^{commit}": "dev789\n",
    };
    return key in out ? { code: 0, stdout: out[key]!, stderr: "" } : { code: 1, stdout: "", stderr: "" };
  };
  const deps: CheckDeps = {
    git,
    setting: () => ({ command: "bun x" }),
    now: () => 1_000_000,
    exec: async (argv) => {
      if (argv[0] === "gh") {
        gh.push(argv);
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      commands.push(argv.join(" "));
      return { stdout: '{"mode":"changed","selected":95,"passed":95,"failed":0}\n', stderr: "", exitCode: 0, ...opts.run };
    },
    read: (p) => store.get(p) ?? null,
    write: (p, body) => void store.set(p, body),
    hostname: () => "hilbert.local",
    identity: () => github,
    onRemote: async () => opts.onRemote ?? true,
  };
  return { deps, commands, gh, store };
}

describe("checkTree", () => {
  test("an unconfigured repo returns without running or posting", async () => {
    const h = harness();
    h.deps.setting = () => ({});
    expect(await checkTree("/tree", { post: true }, h.deps)).toEqual({ result: { configured: false }, status: null });
    expect(h.commands).toHaveLength(0);
    expect(h.gh).toHaveLength(0);
  });

  test("a green clean run posts the status when the sha is on the remote", async () => {
    const h = harness();
    const run = await checkTree("/tree", { post: true }, h.deps);
    expect(run.result).toMatchObject({ configured: true, verdict: "green", fromCache: false });
    expect(run.status).toMatchObject({ posted: true, state: "success" });
    expect(h.gh).toHaveLength(1);
  });

  test("a second call reuses the cached green and skips the run", async () => {
    const h = harness();
    await checkTree("/tree", { post: false }, h.deps);
    const again = await checkTree("/tree", { post: false }, h.deps);
    expect(h.commands).toHaveLength(1);
    expect(again.result).toMatchObject({ verdict: "green", fromCache: true });
  });

  test("a cached green still posts", async () => {
    const h = harness();
    await checkTree("/tree", { post: false }, h.deps);
    const again = await checkTree("/tree", { post: true }, h.deps);
    expect(again.result).toMatchObject({ fromCache: true });
    expect(again.status).toMatchObject({ posted: true });
    expect(h.gh).toHaveLength(1);
  });

  test("full skips the cache read and never writes", async () => {
    const h = harness();
    await checkTree("/tree", { post: false }, h.deps);
    const full = await checkTree("/tree", { post: false, full: true }, h.deps);
    expect(h.commands).toHaveLength(2);
    expect(full.result).toMatchObject({ fromCache: false });

    const fresh = harness();
    await checkTree("/tree", { post: false, full: true }, fresh.deps);
    expect(fresh.store.size).toBe(0);
  });

  test("a base override skips the cache read and never writes", async () => {
    const h = harness();
    await checkTree("/tree", { post: false }, h.deps);
    const based = await checkTree("/tree", { post: false, base: "origin/dev" }, h.deps);
    expect(h.commands).toHaveLength(2);
    expect(based.result).toMatchObject({ base: "origin/dev", fromCache: false });

    const fresh = harness();
    await checkTree("/tree", { post: false, base: "origin/dev" }, fresh.deps);
    expect(fresh.store.size).toBe(0);
  });

  test("a red result is never cached", async () => {
    const h = harness({ run: { exitCode: 1, stdout: '{"mode":"changed","selected":95,"passed":93,"failed":2,"failures":["a.test.ts"]}\n' } });
    const first = await checkTree("/tree", { post: false }, h.deps);
    expect(first.result).toMatchObject({ verdict: "red" });
    expect(h.store.size).toBe(0);
    await checkTree("/tree", { post: false }, h.deps);
    expect(h.commands).toHaveLength(2);
  });

  test("a dirty tree runs without the cache, is not cached and does not post", async () => {
    const h = harness({ dirty: true });
    const run = await checkTree("/tree", { post: true }, h.deps);
    expect(run.result).toMatchObject({ verdict: "green", dirty: true });
    expect(run.status).toEqual({ posted: false, reason: "dirty-tree" });
    expect(h.store.size).toBe(0);
    expect(h.gh).toHaveLength(0);
  });

  test("a bad base posts nothing and says the check did not run", async () => {
    const h = harness();
    const run = await checkTree("/tree", { post: true, base: "origin/nope" }, h.deps);
    expect(run.result).toMatchObject({ verdict: "error", reason: "origin/nope is not a commit" });
    expect(run.status).toEqual({ posted: false, reason: "not-run" });
    expect(h.commands).toHaveLength(0);
    expect(h.gh).toHaveLength(0);
  });

  test("a setting that throws is an error verdict, never no check", async () => {
    const h = harness();
    h.deps.setting = () => {
      throw new Error("rt: cannot expand ${worktree}");
    };
    const run = await checkTree("/tree", { post: false }, h.deps);
    expect(run.result).toMatchObject({ configured: true, verdict: "error", sha: "abc123", reason: "rt: cannot expand ${worktree}" });
    expect(run.status).toBeNull();
    expect(h.commands).toHaveLength(0);
  });

  test("a setting that throws posts rt's own error when posting was asked for", async () => {
    const h = harness();
    h.deps.setting = () => {
      throw new Error("Authorization: Bearer s3cr3t");
    };
    const run = await checkTree("/tree", { post: true }, h.deps);
    expect(run.status).toMatchObject({ posted: true, state: "error", description: "error: the check could not run" });
    expect(h.gh[0]!.join(" ")).not.toContain("s3cr3t");
  });

  test("post false leaves status null and posts nothing", async () => {
    const h = harness();
    const run = await checkTree("/tree", { post: false }, h.deps);
    expect(run.status).toBeNull();
    expect(h.gh).toHaveLength(0);
  });

  test("a sha not on the remote is not posted", async () => {
    const h = harness({ onRemote: false });
    const run = await checkTree("/tree", { post: true }, h.deps);
    expect(run.status).toEqual({ posted: false, reason: "not-on-remote" });
    expect(h.gh).toHaveLength(0);
  });

  test("a red result posts a failure status", async () => {
    const h = harness({ run: { exitCode: 1, stdout: '{"mode":"changed","selected":95,"passed":93,"failed":2}\n' } });
    const run = await checkTree("/tree", { post: true }, h.deps);
    expect(run.status).toMatchObject({ posted: true, state: "failure" });
  });
});
