import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { branchSyncPreflight, branchSyncSweep, gitChildEnv, gitPull, gitPush, gitRebase, gitToolDefs, realAuthoredOpenMrs, realGitRunner, realOpenMr, realRepoTrees, realResolveRepo, syncChildEnv, type BranchSyncResult, type GitRunner, type GitToolDeps, type SweepIo } from "../git-tools.ts";
import type { TreeGuardDeps } from "../tree-guard.ts";

const GIT_PATHS = "rev-parse --git-path rebase-merge --git-path rebase-apply";

type Script = Record<string, { code?: number; stdout?: string; stderr?: string }>;
// `git remote` answers "origin\nfork" unless the script overrides it, so the
// fetch-before-rebase branch has remotes to recognize.
function fakeGit(script: Script, calls: string[] = []): GitRunner {
  return async (args) => {
    const key = args.join(" ");
    calls.push(key);
    const hit = script[key] ?? (key === "remote" ? { stdout: "origin\nfork\n" } : { code: 1, stderr: `unscripted: ${key}` });
    return { code: hit.code ?? 0, stdout: hit.stdout ?? "", stderr: hit.stderr ?? "" };
  };
}
const FULL_HEAD = "symbolic-ref --quiet HEAD";
const SHORT_HEAD = "symbolic-ref --quiet --short HEAD";
const on = (branch: string): Script => ({ [FULL_HEAD]: { stdout: `refs/heads/${branch}\n` }, [SHORT_HEAD]: { stdout: `${branch}\n` } });
// What `git symbolic-ref` prints on feat/x when a tag feat/x also exists.
const onTagAmbiguous: Script = { [FULL_HEAD]: { stdout: "refs/heads/feat/x\n" }, [SHORT_HEAD]: { stdout: "heads/feat/x\n" } };
const onFeature: Script = {
  ...on("feat/x"),
  "symbolic-ref --quiet refs/remotes/origin/HEAD": { stdout: "refs/remotes/origin/develop\n" },
  "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/feat/x\n" },
  "rev-parse --verify HEAD": { stdout: "abc1234\n" },
};
/** No MR on any branch: what the git tools read when a test is not about the forge. */
const noForge: Pick<GitToolDeps, "openMr" | "resolveRepo" | "authoredOpenMrs" | "repoTrees"> = {
  openMr: async () => ({ ok: true, mr: null }),
  resolveRepo: async () => ({ ok: false, error: "no repo in this test" }),
  authoredOpenMrs: async () => ({ ok: true, mrs: [], complete: true }),
  repoTrees: async () => ({ ok: true, trees: [] }),
};

describe("gitPush", () => {
  test("pushes HEAD to the upstream by explicit refspec, force only as --force-with-lease --force-if-includes", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", { forceWithLease: true }, fakeGit({ ...onFeature, "push --no-follow-tags --recurse-submodules=no --force-with-lease --force-if-includes --end-of-options origin HEAD:refs/heads/feat/x": {} }, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push --no-follow-tags --recurse-submodules=no --force-with-lease --force-if-includes --end-of-options origin HEAD:refs/heads/feat/x");
  });
  test("a forced setUpstream push carries both lease flags before -u", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", { forceWithLease: true, setUpstream: true }, fakeGit({ ...onFeature, "push --no-follow-tags --recurse-submodules=no --force-with-lease --force-if-includes -u --end-of-options origin HEAD:refs/heads/feat/x": {} }, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push --no-follow-tags --recurse-submodules=no --force-with-lease --force-if-includes -u --end-of-options origin HEAD:refs/heads/feat/x");
  });
  test("an upstream with a different branch name is refused, naming both and setUpstream", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/feat/parent\n" }, "push --no-follow-tags --recurse-submodules=no --end-of-options origin HEAD:refs/heads/feat/parent": {} };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("feat/x");
    expect(r.error).toContain("origin/feat/parent");
    expect(r.error).toContain("setUpstream");
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("setUpstream pushes as origin/<branch> whatever the existing upstream, without reading it", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/main\n" }, "push --no-follow-tags --recurse-submodules=no -u --end-of-options origin HEAD:refs/heads/feat/x": {} };
    const r = await gitPush("/t", { setUpstream: true }, fakeGit(script, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push --no-follow-tags --recurse-submodules=no -u --end-of-options origin HEAD:refs/heads/feat/x");
    expect(calls).not.toContain("rev-parse --abbrev-ref --symbolic-full-name @{u}");
    expect((r.body as { upstream: string }).upstream).toBe("origin/feat/x");
  });
  test("an upstream on another remote goes to that remote", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "fork/feat/x\n" }, "symbolic-ref --quiet refs/remotes/fork/HEAD": { code: 128 }, "ls-remote --symref --end-of-options fork HEAD": { stdout: "ref: refs/heads/main\tHEAD\n<sha>\tHEAD\n" }, "push --no-follow-tags --recurse-submodules=no --end-of-options fork HEAD:refs/heads/feat/x": {} };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push --no-follow-tags --recurse-submodules=no --end-of-options fork HEAD:refs/heads/feat/x");
  });
  describe("a same-named upstream that is its own remote's default", () => {
    const onTrunk = (upstream: string): Script => ({ ...onFeature, ...on("trunk"), "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: `${upstream}\n` }, "push --no-follow-tags --recurse-submodules=no --end-of-options fork HEAD:refs/heads/trunk": {}, "push --no-follow-tags --recurse-submodules=no --end-of-options fork+x HEAD:refs/heads/trunk": {} });
    const refusal = (remote: string) => `refusing to push trunk: its upstream ${remote}/trunk is ${remote}'s default branch; pass setUpstream: true to push it as origin/trunk`;
    test("is refused, read from that remote's local HEAD symref", async () => {
      const calls: string[] = [];
      const r = await gitPush("/t", {}, fakeGit({ ...onTrunk("fork/trunk"), "symbolic-ref --quiet refs/remotes/fork/HEAD": { stdout: "refs/remotes/fork/trunk\n" } }, calls));
      expect(r.error).toBe(refusal("fork"));
      expect(calls.some((c) => c.startsWith("push"))).toBe(false);
    });
    test("is refused, read from ls-remote when that remote's HEAD symref is missing", async () => {
      const calls: string[] = [];
      const r = await gitPush("/t", {}, fakeGit({ ...onTrunk("fork/trunk"), "symbolic-ref --quiet refs/remotes/fork/HEAD": { code: 128 }, "ls-remote --symref --end-of-options fork HEAD": { stdout: "ref: refs/heads/trunk\tHEAD\n<sha>\tHEAD\n" } }, calls));
      expect(r.error).toBe(refusal("fork"));
      expect(calls.some((c) => c.startsWith("push"))).toBe(false);
    });
    test("is refused when the remote name carries a regex metacharacter", async () => {
      const calls: string[] = [];
      const r = await gitPush("/t", {}, fakeGit({ ...onTrunk("fork+x/trunk"), "symbolic-ref --quiet refs/remotes/fork+x/HEAD": { stdout: "refs/remotes/fork+x/trunk\n" } }, calls));
      expect(r.error).toBe(refusal("fork+x"));
      expect(calls.some((c) => c.startsWith("push"))).toBe(false);
    });
    test("is pushed when that remote defaults to another branch", async () => {
      const calls: string[] = [];
      const r = await gitPush("/t", {}, fakeGit({ ...onTrunk("fork/trunk"), "symbolic-ref --quiet refs/remotes/fork/HEAD": { stdout: "refs/remotes/fork/main\n" } }, calls));
      expect(r.ok).toBe(true);
      expect(calls.at(-1)).toBe("push --no-follow-tags --recurse-submodules=no --end-of-options fork HEAD:refs/heads/trunk");
    });
  });
  test("origin's default resolved via ls-remote when its HEAD symref is missing refuses the current branch develop", async () => {
    const calls: string[] = [];
    const script: Script = {
      ...on("develop"),
      "symbolic-ref --quiet refs/remotes/origin/HEAD": { code: 128 },
      "ls-remote --symref --end-of-options origin HEAD": { stdout: "ref: refs/heads/develop\tHEAD\n<sha>\tHEAD\n" },
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/develop\n" },
      "push --no-follow-tags --recurse-submodules=no --end-of-options origin HEAD:refs/heads/develop": {},
    };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("origin's default unknown when both the symref and ls-remote fail refuses with a named error", async () => {
    const calls: string[] = [];
    const script: Script = {
      ...on("feat/x"),
      "symbolic-ref --quiet refs/remotes/origin/HEAD": { code: 128 },
      "ls-remote --symref --end-of-options origin HEAD": { code: 128 },
    };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("could not be determined");
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  describe("a local origin/HEAD that disagrees with the remote", () => {
    const LS_ORIGIN = "ls-remote --symref --end-of-options origin HEAD";
    const lsSays = (b: string) => ({ stdout: `ref: refs/heads/${b}\tHEAD\n<sha>\tHEAD\n` });
    const localSays = (b: string) => ({ stdout: `refs/remotes/origin/${b}\n` });
    const DEFAULT_REFUSAL = "the default branch and main/master are never pushed by a tool";
    test("a stale local main does not hide the develop the remote reports", async () => {
      const calls: string[] = [];
      const script: Script = { ...on("develop"), "symbolic-ref --quiet refs/remotes/origin/HEAD": localSays("main"), [LS_ORIGIN]: lsSays("develop"), "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/develop\n" }, "push --no-follow-tags --recurse-submodules=no --end-of-options origin HEAD:refs/heads/develop": {} };
      const r = await gitPush("/t", {}, fakeGit(script, calls));
      expect(r.ok).toBe(false);
      expect(r.error).toBe(`refusing to push develop: ${DEFAULT_REFUSAL}`);
      expect(calls.some((c) => c.startsWith("push"))).toBe(false);
    });
    test("the local answer stays protected when the remote reports another default", async () => {
      const calls: string[] = [];
      const script: Script = { ...on("develop"), "symbolic-ref --quiet refs/remotes/origin/HEAD": localSays("develop"), [LS_ORIGIN]: lsSays("trunk"), "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/develop\n" }, "push --no-follow-tags --recurse-submodules=no --end-of-options origin HEAD:refs/heads/develop": {} };
      const r = await gitPush("/t", {}, fakeGit(script, calls));
      expect(r.error).toBe(`refusing to push develop: ${DEFAULT_REFUSAL}`);
      expect(calls.some((c) => c.startsWith("push"))).toBe(false);
    });
    test("ls-remote failing still protects the local answer", async () => {
      const calls: string[] = [];
      const script: Script = { ...on("develop"), "symbolic-ref --quiet refs/remotes/origin/HEAD": localSays("develop"), [LS_ORIGIN]: { code: 128, stderr: "fatal: unreachable" }, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/develop\n" }, "push --no-follow-tags --recurse-submodules=no --end-of-options origin HEAD:refs/heads/develop": {} };
      const r = await gitPush("/t", {}, fakeGit(script, calls));
      expect(r.error).toBe(`refusing to push develop: ${DEFAULT_REFUSAL}`);
      expect(calls.some((c) => c.startsWith("push"))).toBe(false);
    });
    test("both answers known and equal lets a feature branch push", async () => {
      const calls: string[] = [];
      const script: Script = { ...onFeature, "symbolic-ref --quiet refs/remotes/origin/HEAD": localSays("develop"), [LS_ORIGIN]: lsSays("develop"), "push --no-follow-tags --recurse-submodules=no --end-of-options origin HEAD:refs/heads/feat/x": {} };
      const r = await gitPush("/t", {}, fakeGit(script, calls));
      expect(r.ok).toBe(true);
      expect(calls).toContain(LS_ORIGIN);
      expect(calls.at(-1)).toBe("push --no-follow-tags --recurse-submodules=no --end-of-options origin HEAD:refs/heads/feat/x");
    });
  });
  test("a feature branch whose upstream is origin/main (checkout -b feat/x origin/main) is refused as a different branch name", async () => {
    for (const up of ["origin/main", "origin/master", "origin/develop"]) {
      const calls: string[] = [];
      const r = await gitPush("/t", { forceWithLease: true }, fakeGit({ ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: `${up}\n` } }, calls));
      expect(r.ok, up).toBe(false);
      expect(r.error, up).toBe(`refusing to push feat/x: its upstream is ${up}, a different branch name; pass setUpstream: true to push it as origin/feat/x`);
      expect(calls.some((c) => c.startsWith("push")), up).toBe(false);
    }
  });
  test("setUpstream pushes -u origin HEAD:refs/heads/<branch>", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { code: 128 }, "push --no-follow-tags --recurse-submodules=no -u --end-of-options origin HEAD:refs/heads/feat/x": {} };
    const r = await gitPush("/t", { setUpstream: true }, fakeGit(script, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push --no-follow-tags --recurse-submodules=no -u --end-of-options origin HEAD:refs/heads/feat/x");
  });
  test("no upstream and no setUpstream is an error naming setUpstream", async () => {
    const r = await gitPush("/t", {}, fakeGit({ ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { code: 128 } }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("setUpstream");
  });
  test("a rejected push reports the rejection line, not git's trailing hints", async () => {
    const stderr = [
      "To example.com:acme/app.git",
      " ! [rejected]        feat/x -> feat/x (fetch first)",
      "error: failed to push some refs to 'example.com:acme/app.git'",
      "hint: Updates were rejected because the remote contains work that you do not",
      "hint: have locally.",
      "hint: See the 'Note about fast-forwards' in 'git push --help' for details.",
    ].join("\n");
    const r = await gitPush("/t", {}, fakeGit({ ...onFeature, "push --no-follow-tags --recurse-submodules=no --end-of-options origin HEAD:refs/heads/feat/x": { code: 1, stderr } }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("! [rejected]");
    expect(r.error).not.toContain("hint:");
  });
  test("refuses a detached HEAD", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", {}, fakeGit({ [FULL_HEAD]: { code: 1 } }, calls));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("detached");
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("refuses main, master and the remote default branch", async () => {
    for (const branch of ["main", "master", "develop"]) {
      const calls: string[] = [];
      const r = await gitPush("/t", { forceWithLease: true }, fakeGit({ ...onFeature, ...on(branch) }, calls));
      expect(r.ok, branch).toBe(false);
      expect(calls.some((c) => c.startsWith("push")), branch).toBe(false);
    }
  });
  test("reads the full HEAD ref, so main is refused whatever the short form prints", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", {}, fakeGit({ ...onFeature, [FULL_HEAD]: { stdout: "refs/heads/main\n" }, [SHORT_HEAD]: { stdout: "heads/main\n" } }, calls));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("refusing to push main:");
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("a HEAD outside refs/heads is refused like a detached HEAD", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", {}, fakeGit({ ...onFeature, [FULL_HEAD]: { stdout: "refs/remotes/origin/feat/x\n" } }, calls));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("detached");
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("a dash-leading remote name is passed after --end-of-options to both ls-remote and push", async () => {
    const calls: string[] = [];
    const script: Script = {
      ...onFeature,
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "-evil/feat/x\n" },
      "symbolic-ref --quiet refs/remotes/-evil/HEAD": { code: 128 },
      "ls-remote --symref --end-of-options -evil HEAD": { stdout: "ref: refs/heads/main\tHEAD\n" },
      "push --no-follow-tags --recurse-submodules=no --end-of-options -evil HEAD:refs/heads/feat/x": {},
    };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(true);
    expect(calls).toContain("ls-remote --symref --end-of-options -evil HEAD");
    expect(calls.at(-1)).toBe("push --no-follow-tags --recurse-submodules=no --end-of-options -evil HEAD:refs/heads/feat/x");
  });
  test("real git: push.followTags=true sends no tag along with the branch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "git-push-tags-"));
    try {
      const origin = join(dir, "origin.git");
      const work = join(dir, "work");
      const id = ["-c", "user.email=t@example.com", "-c", "user.name=t"];
      const steps: [string[], string][] = [
        [["init", "-q", "--bare", "-b", "develop", origin], dir],
        [["init", "-q", "-b", "develop", work], dir],
        [[...id, "commit", "-q", "--allow-empty", "-m", "a"], work],
        [["remote", "add", "origin", origin], work],
        [["push", "-q", "origin", "develop"], work],
        [["fetch", "-q", "origin"], work],
        [["remote", "set-head", "origin", "develop"], work],
        [["checkout", "-q", "-b", "feat/x"], work],
        [[...id, "tag", "-a", "-m", "t", "v1"], work],
        [["config", "push.followTags", "true"], work],
      ];
      for (const [args, cwd] of steps) expect((await realGitRunner(args, cwd)).code, args.join(" ")).toBe(0);
      const r = await gitPush(work, { setUpstream: true }, realGitRunner);
      expect(r.ok, r.error).toBe(true);
      const heads = await realGitRunner(["ls-remote", "--heads", origin], dir);
      expect(heads.stdout).toContain("refs/heads/feat/x");
      const tags = await realGitRunner(["ls-remote", "--tags", origin], dir);
      expect(tags.stdout).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("setUpstream on a branch that shares its name with a tag pushes the stripped branch name", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", { setUpstream: true }, fakeGit({ ...onFeature, ...onTagAmbiguous, "push --no-follow-tags --recurse-submodules=no -u --end-of-options origin HEAD:refs/heads/feat/x": {} }, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push --no-follow-tags --recurse-submodules=no -u --end-of-options origin HEAD:refs/heads/feat/x");
    expect((r.body as { upstream: string }).upstream).toBe("origin/feat/x");
  });
});

describe("git_push reports what it pushed", () => {
  const guard: TreeGuardDeps = { repoIndex: () => ({ r: "/t" }), treeByPath: () => null, realpath: (p) => p, worktreeRoots: () => [], hasGitEntry: () => false };
  const PUSH = "push --no-follow-tags --recurse-submodules=no --end-of-options origin HEAD:refs/heads/feat/x";
  const push = async (openMr: GitToolDeps["openMr"], script: Script = {}, calls: string[] = []) => {
    const tool = gitToolDefs({ ...noForge, git: fakeGit({ ...onFeature, [PUSH]: {}, ...script }, calls), guard, sync: async () => ({ code: 0, stdout: "", stderr: "" }), openMr }).find((t) => t.name === "git_push")!;
    return tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
  };

  test("the pushed sha, and the open MR's pipeline as it stood before the push", async () => {
    const calls: string[] = [];
    const asked: Array<[string, string]> = [];
    const r = await push(async (repoName, branch) => {
      asked.push([repoName, branch]);
      calls.push("<mr lookup>");
      return { ok: true, mr: { iid: 7, url: "https://forge/mr/7", pipelineId: 991 } };
    }, {}, calls);
    expect(r).toEqual({ ok: true, body: { pushed: true, branch: "feat/x", sha: "abc1234", forceWithLease: false, upstream: "origin/feat/x", mr: { iid: 7, url: "https://forge/mr/7" }, priorPipelineId: 991, mrLookup: "read", tree: "/t" } });
    expect(asked).toEqual([["r", "feat/x"]]);
    expect(calls.indexOf("<mr lookup>")).toBeLessThan(calls.indexOf(PUSH));
  });
  test("no open MR on the branch reads as no MR and no prior pipeline", async () => {
    const r = await push(async () => ({ ok: true, mr: null }));
    expect(r.body).toMatchObject({ pushed: true, sha: "abc1234", mr: null, priorPipelineId: null, mrLookup: "read" });
  });
  test("an MR with no pipeline yet has a null prior pipeline", async () => {
    const r = await push(async () => ({ ok: true, mr: { iid: 7, url: null, pipelineId: null } }));
    expect(r.body).toMatchObject({ mr: { iid: 7, url: null }, priorPipelineId: null, mrLookup: "read" });
  });
  test("a forge that cannot be read still pushes, and says the MR is unknown rather than absent", async () => {
    const calls: string[] = [];
    const r = await push(async () => ({ ok: false, error: "unsupported: mr:live-by-branch needs a GitLab repo" }), {}, calls);
    expect(r.body).toMatchObject({ pushed: true, sha: "abc1234", mr: null, priorPipelineId: null, mrLookup: "unavailable", mrLookupError: "unsupported: mr:live-by-branch needs a GitLab repo" });
    expect(calls).toContain(PUSH);
  });
  test("a refused push never asks the forge", async () => {
    let asked = false;
    const r = await push(async () => { asked = true; return { ok: true, mr: null }; }, { [FULL_HEAD]: { stdout: "refs/heads/main\n" } });
    expect(r.ok).toBe(false);
    expect(asked).toBe(false);
  });
  test("a HEAD that cannot be read refuses before the push", async () => {
    const calls: string[] = [];
    const r = await push(async () => ({ ok: true, mr: null }), { "rev-parse --verify HEAD": { code: 128, stderr: "fatal: bad HEAD" } }, calls);
    expect(r.ok).toBe(false);
    expect(calls).not.toContain(PUSH);
  });
});

describe("realOpenMr", () => {
  const answer = (r: { ok: boolean; data?: unknown; error?: string }) => {
    const sent: unknown[] = [];
    const command = (async (verb: string, payload: unknown) => { sent.push([verb, payload]); return r; }) as unknown as Parameters<typeof realOpenMr>[2];
    return { command, sent };
  };
  test("asks the daemon for the branch's live MR and keeps its iid, url and pipeline number", async () => {
    const { command, sent } = answer({ ok: true, data: { byBranch: { "feat/x": { iid: 7, webUrl: "https://forge/mr/7", pipeline: { id: "gitlab:pipeline:991" } } } } });
    expect(await realOpenMr("remote:gitlab.com%2Facme%2Fapp", "feat/x", command)).toEqual({ ok: true, mr: { iid: 7, url: "https://forge/mr/7", pipelineId: 991 } });
    expect(sent).toEqual([["mr:live-by-branch", { repoName: "remote:gitlab.com%2Facme%2Fapp", branches: ["feat/x"] }]]);
  });
  test("a branch with no open MR, and an MR with no pipeline", async () => {
    expect(await realOpenMr("r", "feat/x", answer({ ok: true, data: { byBranch: { "feat/x": null } } }).command)).toEqual({ ok: true, mr: null });
    expect(await realOpenMr("r", "feat/x", answer({ ok: true, data: { byBranch: { "feat/x": { iid: 7, webUrl: null, pipeline: null } } } }).command)).toEqual({ ok: true, mr: { iid: 7, url: null, pipelineId: null } });
  });
  test("a daemon refusal is a failed lookup carrying its reason", async () => {
    const r = await realOpenMr("r", "feat/x", answer({ ok: false, error: "unsupported: mr:live-by-branch needs a GitLab repo" }).command);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("GitLab");
  });
});

describe("realGitRunner", () => {
  test("runs git with terminal prompts disabled so a credential prompt fails instead of hanging", async () => {
    const dir = mkdtempSync(join(tmpdir(), "git-runner-"));
    try {
      const r = await realGitRunner(["-c", 'alias.envp=!printf %s "$GIT_TERMINAL_PROMPT"', "envp"], dir);
      expect(r.code).toBe(0);
      expect(r.stdout).toBe("0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("ignores a GIT_DIR in the caller's environment, so git answers for cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "git-runner-env-"));
    const saved = process.env.GIT_DIR;
    try {
      const here = join(dir, "here");
      const other = join(dir, "other");
      expect((await realGitRunner(["init", "-q", "-b", "here-branch", here], dir)).code).toBe(0);
      expect((await realGitRunner(["init", "-q", "-b", "other-branch", other], dir)).code).toBe(0);
      process.env.GIT_DIR = join(other, ".git");
      const r = await realGitRunner(["symbolic-ref", "--quiet", "HEAD"], here);
      expect(r.stdout.trim()).toBe("refs/heads/here-branch");
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("child environments", () => {
  const base = { PATH: "/bin", HOME: "/h", GIT_DIR: "/a", GIT_WORK_TREE: "/b", GIT_INDEX_FILE: "/c", GIT_COMMON_DIR: "/d", GIT_TERMINAL_PROMPT: "1" };
  test("gitChildEnv drops the variables that override cwd and applies the extras", () => {
    expect(gitChildEnv(base, { GIT_TERMINAL_PROMPT: "0" })).toEqual({ PATH: "/bin", HOME: "/h", GIT_TERMINAL_PROMPT: "0" });
  });
  test("gitChildEnv does not mutate its base", () => {
    const copy = { ...base };
    gitChildEnv(copy, {});
    expect(copy).toEqual(base);
  });
  test("the rt sync child runs batch, without setup, prompts or an overriding git dir", () => {
    expect(syncChildEnv(base)).toEqual({ PATH: "/bin", HOME: "/h", GIT_TERMINAL_PROMPT: "0", RT_BATCH: "1", RT_SKIP_SETUP: "1" });
  });
});

describe("gitPull", () => {
  test("is --ff-only and reports a diverged branch as an error", async () => {
    const calls: string[] = [];
    const ok = await gitPull("/t", fakeGit({ "pull --ff-only": { stdout: "Fast-forward" } }, calls));
    expect(ok.ok).toBe(true);
    expect(calls).toEqual(["pull --ff-only"]);
    const diverged = await gitPull("/t", fakeGit({ "pull --ff-only": { code: 128, stderr: "fatal: Not possible to fast-forward, aborting." } }));
    expect(diverged.ok).toBe(false);
    expect(diverged.error).toContain("fast-forward");
  });
});

describe("gitRebase", () => {
  test("rebases onto a remote-tracking ref after fetching its remote", async () => {
    const calls: string[] = [];
    const r = await gitRebase("/t", { onto: "origin/develop" }, fakeGit({ "fetch origin": {}, "rebase --end-of-options origin/develop": {} }, calls));
    expect(r).toEqual({ ok: true, body: { status: "ok", onto: "origin/develop", fetched: "origin" } });
    expect(calls).toEqual(["remote", "fetch origin", "rebase --end-of-options origin/develop"]);
  });
  test("git remote failing is an error, not a local ref", async () => {
    const calls: string[] = [];
    const r = await gitRebase("/t", { onto: "origin/develop" }, fakeGit({ remote: { code: 128, stderr: "fatal: bad config" }, "rebase --end-of-options origin/develop": {} }, calls));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("fatal: bad config");
    expect(calls.filter((c) => c.startsWith("rebase") || c.startsWith("fetch"))).toEqual([]);
  });
  test("a local ref is not fetched", async () => {
    const calls: string[] = [];
    const r = await gitRebase("/t", { onto: "develop" }, fakeGit({ "rebase --end-of-options develop": {} }, calls));
    expect(r).toEqual({ ok: true, body: { status: "ok", onto: "develop", fetched: null } });
    expect(calls).toEqual(["rebase --end-of-options develop"]);
  });
  test("an onto that starts with a dash is refused before git runs", async () => {
    for (const onto of ["--exec=touch /tmp/x", "-i", "--onto=x"]) {
      const calls: string[] = [];
      const r = await gitRebase("/t", { onto }, fakeGit({}, calls));
      expect(r.ok, onto).toBe(false);
      expect(calls.filter((c) => c.startsWith("rebase")), onto).toEqual([]);
    }
  });
  test("a conflict returns the conflicted files and leaves the tree mid-rebase", async () => {
    const calls: string[] = [];
    const r = await gitRebase("/t", { onto: "origin/develop" }, fakeGit({ "fetch origin": {}, "rebase --end-of-options origin/develop": { code: 1, stderr: "CONFLICT" }, "diff --name-only --diff-filter=U": { stdout: "a.ts\nb.ts\n" } }, calls));
    expect(r).toEqual({ ok: true, body: { status: "conflict", onto: "origin/develop", files: ["a.ts", "b.ts"] } });
    expect(calls).not.toContain("rebase --abort");
  });
  test("abort runs rebase --abort; onto and abort together are refused", async () => {
    const calls: string[] = [];
    const r = await gitRebase("/t", { abort: true }, fakeGit({ "rebase --abort": {} }, calls));
    expect(r).toEqual({ ok: true, body: { status: "aborted" } });
    const both = await gitRebase("/t", { abort: true, onto: "x" }, fakeGit({}));
    expect(both.ok).toBe(false);
    const neither = await gitRebase("/t", {}, fakeGit({}));
    expect(neither.ok).toBe(false);
  });
});

describe("gitToolDefs guard", () => {
  test("every git tool refuses an unregistered tree before running git", async () => {
    const calls: string[] = [];
    const guard: TreeGuardDeps = { repoIndex: () => ({}), treeByPath: () => null, realpath: (p) => p, worktreeRoots: () => [], hasGitEntry: () => false };
    let synced = false;
    for (const [name, input] of [["git_push", {}], ["git_pull", {}], ["git_rebase", { onto: "x" }], ["branch_sync", {}]] as const) {
      const tool = gitToolDefs({ ...noForge, git: fakeGit({}, calls), guard, sync: async () => { synced = true; return { code: 0, stdout: "", stderr: "" }; } }).find((t) => t.name === name)!;
      const r = await tool.handler({ tree: "/elsewhere", ...input }, {} as NodeJS.ProcessEnv);
      expect(r.ok, name).toBe(false);
      expect(r.error, name).toContain("registered");
    }
    expect(calls).toEqual([]);
    expect(synced).toBe(false);
  });
});

describe("gitToolDefs guard on a worktree nested in its checkout", () => {
  const guard: TreeGuardDeps = {
    repoIndex: () => ({ r: "/real/app" }),
    treeByPath: () => null,
    realpath: (p) => p.replace("/link/", "/real/"),
    worktreeRoots: (checkout) => (checkout === "/real/app" ? ["/real/app", "/real/app/.worktrees/nested"] : []),
    hasGitEntry: () => false,
  };
  const run = async (name: string, input: Record<string, unknown>, tree: string) => {
    const cwds: string[] = [];
    const synced: string[] = [];
    const inner = fakeGit({});
    const git: GitRunner = async (args, cwd) => { cwds.push(cwd); return inner(args, cwd); };
    const tool = gitToolDefs({ ...noForge, git, guard, sync: async (cwd) => { synced.push(cwd); return { code: 0, stdout: "", stderr: "" }; } }).find((t) => t.name === name)!;
    const r = await tool.handler({ tree, ...input }, {} as NodeJS.ProcessEnv);
    return { r, cwds, synced };
  };
  for (const [name, input] of [["git_push", {}], ["git_pull", {}], ["git_rebase", { onto: "x" }], ["branch_sync", {}]] as const) {
    test(`${name} runs git in the nested worktree, reached directly or through a symlink`, async () => {
      for (const tree of ["/real/app/.worktrees/nested", "/link/app/.worktrees/nested"]) {
        const { cwds } = await run(name, input, tree);
        expect(cwds.length, tree).toBeGreaterThan(0);
        expect([...new Set(cwds)], tree).toEqual(["/real/app/.worktrees/nested"]);
      }
    });
    test(`${name} runs a subdirectory of the nested worktree and of the checkout at that tree's own root`, async () => {
      for (const [tree, root] of [["/real/app/.worktrees/nested/src", "/real/app/.worktrees/nested"], ["/real/app/src", "/real/app"]] as const) {
        const { cwds } = await run(name, input, tree);
        expect([...new Set(cwds)], tree).toEqual([root]);
      }
    });
  }
  test("a result from a subdirectory names the root the tool ran in", async () => {
    const git = fakeGit({ "pull --ff-only": { stdout: "Already up to date.\n" } });
    const tool = gitToolDefs({ ...noForge, git, guard, sync: async () => ({ code: 0, stdout: "", stderr: "" }) }).find((t) => t.name === "git_pull")!;
    const r = await tool.handler({ tree: "/real/app/src" }, {} as NodeJS.ProcessEnv);
    expect(r).toEqual({ ok: true, body: { pulled: true, output: "Already up to date.", tree: "/real/app" } });
  });
});

describe("branchSyncPreflight", () => {
  const base: Script = {
    [GIT_PATHS]: { stdout: "/t/.git/rebase-merge\n/t/.git/rebase-apply\n" },
    ...on("feat/x"),
    "symbolic-ref --quiet refs/remotes/origin/HEAD": { stdout: "refs/remotes/origin/develop\n" },
    "config --get-all remote.origin.push": { code: 1 },
    "status --porcelain": {},
    "config --get push.default": { code: 1 },
    "fetch origin": {},
    "rev-parse --verify --quiet refs/remotes/origin/feat/x": {},
  };
  test("a tree with uncommitted or untracked changes is refused before the fetch, naming the paths", async () => {
    const calls: string[] = [];
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, "status --porcelain": { stdout: " M a.ts\nR  old.ts -> new.ts\n?? b.md\n" } }, calls));
    expect(r).toMatchObject({ ok: false, dirty: ["a.ts", "new.ts", "b.md"] });
    expect(calls).not.toContain("fetch origin");
  });
  test("a status that cannot be read refuses rather than passing as clean", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, "status --porcelain": { code: 128, stderr: "fatal: index file corrupt" } }));
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("dirty");
  });
  test("not diverged passes", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count refs/remotes/origin/feat/x...HEAD": { stdout: "0\t2\n" } }));
    expect(r).toEqual({ ok: true, diverged: false });
  });
  const COUNT = "rev-list --left-right --count refs/remotes/origin/feat/x...HEAD";
  const RIGHT_ONLY = "rev-list --cherry-pick --right-only --no-merges refs/remotes/origin/feat/x...HEAD ^refs/remotes/origin/develop";
  const LEFT_ONLY = "rev-list --cherry-pick --left-only --no-merges refs/remotes/origin/feat/x...HEAD ^refs/remotes/origin/develop";
  const LOCAL_BASE = "merge-base HEAD refs/remotes/origin/develop";
  const REMOTE_BASE = "merge-base refs/remotes/origin/feat/x refs/remotes/origin/develop";
  const localNewer: Script = {
    [COUNT]: { stdout: "2\t4\n" },
    [RIGHT_ONLY]: {},
    [LOCAL_BASE]: { stdout: "newbase\n" },
    [REMOTE_BASE]: { stdout: "oldbase\n" },
    "merge-base --is-ancestor oldbase newbase": {},
  };
  test("diverged with every local commit patch-equivalent on origin passes (the GitLab-rebased case)", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, [COUNT]: { stdout: "3\t2\n" }, [RIGHT_ONLY]: {}, [LOCAL_BASE]: { stdout: "b1\n" }, [REMOTE_BASE]: { stdout: "b1\n" } }));
    expect(r).toEqual({ ok: true, diverged: true });
  });
  test("behind origin with nothing local refuses and points at git_pull", async () => {
    const calls: string[] = [];
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, [COUNT]: { stdout: "2\t0\n" } }, calls));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toBe("origin/feat/x has commits this tree lacks; run git_pull first");
  });
  test("a local-newer rewrite with a commit only origin has refuses and names it", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...localNewer, [LEFT_ONLY]: { stdout: "abc1234\n" } }));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("origin/feat/x has commits this tree lacks");
    expect((r as { error: string }).error).toContain("abc1234");
  });
  test("a local-newer rewrite with nothing only on origin passes", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...localNewer, [LEFT_ONLY]: {} }));
    expect(r).toEqual({ ok: true, diverged: true });
  });
  test("a GitLab-rebased branch (remote base not older) with a remote-only suggestion commit passes without the remote-only check", async () => {
    const calls: string[] = [];
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, [COUNT]: { stdout: "4\t2\n" }, [RIGHT_ONLY]: {}, [LOCAL_BASE]: { stdout: "oldbase\n" }, [REMOTE_BASE]: { stdout: "newbase\n" }, "merge-base --is-ancestor newbase oldbase": { code: 1 } }, calls));
    expect(r).toEqual({ ok: true, diverged: true });
    expect(calls).not.toContain(LEFT_ONLY);
  });
  test("a failing local-newer probe refuses", async () => {
    const brokenProbes: Script[] = [{ [LOCAL_BASE]: { code: 128, stderr: "fatal: bad" } }, { [REMOTE_BASE]: { code: 1 } }, { "merge-base --is-ancestor oldbase newbase": { code: 128 } }, { [LEFT_ONLY]: { code: 128 } }];
    for (const broken of brokenProbes) {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...localNewer, [LEFT_ONLY]: {}, ...broken }));
      expect(r.ok, Object.keys(broken)[0]).toBe(false);
    }
  });
  describe("which default the reset exclusion uses", () => {
    const staleLocalMain: Script = { "symbolic-ref --quiet refs/remotes/origin/HEAD": { stdout: "refs/remotes/origin/main\n" }, [COUNT]: { stdout: "3\t2\n" } };
    const against = (def: string): Script => ({
      [`rev-list --cherry-pick --right-only --no-merges refs/remotes/origin/feat/x...HEAD ^refs/remotes/origin/${def}`]: {},
      [`merge-base HEAD refs/remotes/origin/${def}`]: { stdout: "b1\n" },
      [`merge-base refs/remotes/origin/feat/x refs/remotes/origin/${def}`]: { stdout: "b1\n" },
    });
    test("the remote's answer when it gave one, as rt sync does", async () => {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...staleLocalMain, "ls-remote --symref --end-of-options origin HEAD": { stdout: "ref: refs/heads/develop\tHEAD\n" }, ...against("develop") }, calls));
      expect(r).toEqual({ ok: true, diverged: true });
      expect(calls.some((c) => c.includes("^refs/remotes/origin/main") || c.endsWith(" refs/remotes/origin/main"))).toBe(false);
    });
    test("the local answer when ls-remote fails", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...staleLocalMain, "ls-remote --symref --end-of-options origin HEAD": { code: 128 }, ...against("main") }));
      expect(r).toEqual({ ok: true, diverged: true });
    });
  });
  test("diverged with an unpushed local commit refuses and names it", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count refs/remotes/origin/feat/x...HEAD": { stdout: "3\t2\n" }, "rev-list --cherry-pick --right-only --no-merges refs/remotes/origin/feat/x...HEAD ^refs/remotes/origin/develop": { stdout: "0123456\n" } }));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("0123456");
  });
  test("a local rebase onto a newer default does not read the rebase-carried commits as unpushed work", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...localNewer, [LEFT_ONLY]: {} }));
    expect(r).toEqual({ ok: true, diverged: true });
  });
  test("no remote branch yet passes; a detached HEAD refuses", async () => {
    expect(await branchSyncPreflight("/t", fakeGit({ ...base, "rev-parse --verify --quiet refs/remotes/origin/feat/x": { code: 1 } }))).toEqual({ ok: true, diverged: false });
    const broken = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-parse --verify --quiet refs/remotes/origin/feat/x": { code: 128, stderr: "fatal: bad object" }, "rev-list --left-right --count refs/remotes/origin/feat/x...HEAD": { stdout: "0\t1\n" } }));
    expect(broken.ok).toBe(false);
    expect((broken as { error: string }).error).toContain("fatal: bad object");
    const detached = await branchSyncPreflight("/t", fakeGit({ ...base, [FULL_HEAD]: { code: 1 } }));
    expect(detached.ok).toBe(false);
    expect((detached as { error: string }).error).toContain("detached");
  });
  test("a tree paused mid-rebase refuses with how to finish it, before the detached-HEAD refusal", async () => {
    for (const [gitPaths, present] of [
      [".git/rebase-merge\n.git/rebase-apply\n", "/t/.git/rebase-merge"],
      ["/repo/.git/worktrees/t/rebase-merge\n/repo/.git/worktrees/t/rebase-apply\n", "/repo/.git/worktrees/t/rebase-apply"],
    ] as const) {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, [GIT_PATHS]: { stdout: gitPaths }, [FULL_HEAD]: { code: 1 } }, calls), (p) => p === present);
      expect(r.ok, present).toBe(false);
      expect((r as { error: string }).error, present).toBe("a rebase is in progress; finish it with git rebase --continue or git_rebase {abort: true}");
      expect(calls, present).not.toContain("fetch origin");
    }
  });
  test("the rebase-in-progress probe failing refuses", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, [COUNT]: { stdout: "0\t1\n" }, [GIT_PATHS]: { code: 128, stderr: "fatal: not a git repository" } }), () => false);
    expect(r.ok).toBe(false);
  });
  test("main, master and the remote default branch refuse before any fetch (rt sync would force-push them)", async () => {
    for (const branch of ["main", "master", "develop"]) {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...on(branch), "symbolic-ref --quiet refs/remotes/origin/HEAD": { stdout: "refs/remotes/origin/develop\n" } }, calls));
      expect(r.ok, branch).toBe(false);
      expect(calls, branch).not.toContain("fetch origin");
    }
  });
  test("a full HEAD ref of refs/heads/main refuses whatever the short form prints", async () => {
    const calls: string[] = [];
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, [FULL_HEAD]: { stdout: "refs/heads/main\n" }, [SHORT_HEAD]: { stdout: "main\n" } }, calls));
    expect(r.ok).toBe(false);
    expect(calls).not.toContain("fetch origin");
  });

  describe("a branch name ambiguous with another ref", () => {
    test("a short HEAD that differs from the stripped full ref refuses before any fetch", async () => {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...onTagAmbiguous }, calls));
      expect(r.ok).toBe(false);
      expect((r as { error: string }).error).toContain("ambiguous");
      expect(calls).not.toContain("fetch origin");
    });
    test("the short HEAD read failing refuses", async () => {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, [SHORT_HEAD]: { code: 128, stderr: "fatal: bad" } }, calls));
      expect(r.ok).toBe(false);
      expect(calls).not.toContain("fetch origin");
    });
    test("real git: a branch sharing its name with a tag refuses before any fetch", async () => {
      const dir = mkdtempSync(join(tmpdir(), "git-ambiguous-"));
      try {
        const setup = [
          ["init", "-q", "-b", "develop"],
          ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "a"],
          ["checkout", "-q", "-b", "feat/x"],
          ["tag", "feat/x"],
        ];
        for (const args of setup) expect((await realGitRunner(args, dir)).code, args.join(" ")).toBe(0);
        const calls: string[] = [];
        const recording: GitRunner = (args, cwd) => { calls.push(args.join(" ")); return realGitRunner(args, cwd); };
        const r = await branchSyncPreflight(dir, recording);
        expect(r.ok).toBe(false);
        expect((r as { error: string }).error).toContain("ambiguous");
        expect(calls.some((c) => c.startsWith("fetch"))).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("a local ref shadowing a short remote-tracking name rt sync reads", () => {
    const probe = (ref: string) => `rev-parse --verify --quiet ${ref}`;
    const shadows = ["refs/heads/origin/feat/x", "refs/tags/origin/feat/x", "refs/origin/feat/x", "refs/heads/origin/develop", "refs/tags/origin/develop", "refs/origin/develop"];
    test("every shadowing ref refuses after the fetch and before the counts", async () => {
      for (const shadow of shadows) {
        const calls: string[] = [];
        const r = await branchSyncPreflight("/t", fakeGit({ ...base, [COUNT]: { stdout: "0\t1\n" }, [probe(shadow)]: { stdout: "abc\n" } }, calls));
        const shortName = shadow.replace(/^refs\/(heads\/|tags\/)?/, "");
        expect(r.ok, shadow).toBe(false);
        expect((r as { error: string }).error, shadow).toBe(`refusing to sync feat/x: a local ref named ${shortName} (${shadow}) shadows the remote-tracking ref, which rt sync cannot sync safely`);
        expect(calls.indexOf("fetch origin"), shadow).toBeLessThan(calls.indexOf(probe(shadow)));
        expect(calls, shadow).not.toContain(COUNT);
      }
    });
    test("a shadow probe error refuses", async () => {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, [COUNT]: { stdout: "0\t1\n" }, [probe("refs/tags/origin/develop")]: { code: 128, stderr: "fatal: bad ref" } }, calls));
      expect(r.ok).toBe(false);
      expect((r as { error: string }).error).toContain("fatal: bad ref");
      expect(calls).not.toContain(COUNT);
    });
    test("no shadowing ref probes all six and passes", async () => {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, [COUNT]: { stdout: "0\t1\n" } }, calls));
      expect(r).toEqual({ ok: true, diverged: false });
      for (const shadow of shadows) expect(calls, shadow).toContain(probe(shadow));
    });
    test("real git: a local branch named origin/amb refuses", async () => {
      const dir = mkdtempSync(join(tmpdir(), "git-shadow-"));
      try {
        const origin = join(dir, "origin.git");
        const work = join(dir, "work");
        const id = ["-c", "user.email=t@example.com", "-c", "user.name=t"];
        const steps: [string[], string][] = [
          [["init", "-q", "--bare", "-b", "develop", origin], dir],
          [["init", "-q", "-b", "develop", work], dir],
          [[...id, "commit", "-q", "--allow-empty", "-m", "a"], work],
          [["remote", "add", "origin", origin], work],
          [["push", "-q", "origin", "develop"], work],
          [["checkout", "-q", "-b", "amb"], work],
          [[...id, "commit", "-q", "--allow-empty", "-m", "b"], work],
          [["push", "-q", "origin", "amb"], work],
          [["fetch", "-q", "origin"], work],
          [["remote", "set-head", "origin", "develop"], work],
          [["branch", "origin/amb"], work],
        ];
        for (const [args, cwd] of steps) expect((await realGitRunner(args, cwd)).code, args.join(" ")).toBe(0);
        const r = await branchSyncPreflight(work, realGitRunner);
        expect(r.ok).toBe(false);
        expect((r as { error: string }).error).toContain("refs/heads/origin/amb");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("branch names rt sync cannot pass safely", () => {
    test("a branch with shell metacharacters, whitespace or a leading dash refuses before any config read or fetch", async () => {
      for (const branch of ["x$(touch${IFS}PWNED)", "a;id|sh", "a b", "--mirror", "--all", "-f"]) {
        const calls: string[] = [];
        const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...on(branch) }, calls));
        expect(r.ok, branch).toBe(false);
        expect((r as { error: string }).error, branch).toContain("cannot pass safely");
        expect(calls.filter((c) => c.startsWith("config") || c.startsWith("fetch")), branch).toEqual([]);
      }
    });
    test("a branch of letters, digits, dots, slashes, dashes and underscores passes", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, ...on("feat/x-1.2_y"), "rev-parse --verify --quiet refs/remotes/origin/feat/x-1.2_y": { code: 1 } }));
      expect(r).toEqual({ ok: true, diverged: false });
    });
  });

  describe("push redirection", () => {
    test("remote.origin.push set refuses, naming the setting, before any fetch", async () => {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "config --get-all remote.origin.push": { stdout: "+refs/heads/*:refs/heads/*\n" } }, calls));
      expect(r.ok).toBe(false);
      expect((r as { error: string }).error).toContain("remote.origin.push");
      expect(calls).not.toContain("fetch origin");
    });
    test("push.default upstream with branch.<b>.merge pointing elsewhere refuses", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "config --get push.default": { stdout: "upstream\n" }, "config --get branch.feat/x.merge": { stdout: "refs/heads/develop\n" } }));
      expect(r.ok).toBe(false);
    });
    test("push.default upstream with branch.<b>.merge unset refuses", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "config --get push.default": { stdout: "upstream\n" }, "config --get branch.feat/x.merge": { code: 1 } }));
      expect(r.ok).toBe(false);
    });
    test("push.default upstream with branch.<b>.merge matching the current branch passes the redirect check", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "config --get push.default": { stdout: "upstream\n" }, "config --get branch.feat/x.merge": { stdout: "refs/heads/feat/x\n" }, "rev-list --left-right --count refs/remotes/origin/feat/x...HEAD": { stdout: "0\t2\n" } }));
      expect(r).toEqual({ ok: true, diverged: false });
    });
    test("push.default tracking is treated the same as upstream", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "config --get push.default": { stdout: "tracking\n" }, "config --get branch.feat/x.merge": { stdout: "refs/heads/develop\n" } }));
      expect(r.ok).toBe(false);
    });
    test("a git config error other than unset refuses", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "config --get-all remote.origin.push": { code: 2, stderr: "fatal: bad config" } }));
      expect(r.ok).toBe(false);
    });
  });

  describe("failing closed on a git error", () => {
    test("rev-list --left-right --count failing refuses instead of reading as not diverged", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count refs/remotes/origin/feat/x...HEAD": { code: 128, stderr: "fatal: bad revision" } }));
      expect(r.ok).toBe(false);
    });
    test("a garbled count refuses instead of parsing as 0", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count refs/remotes/origin/feat/x...HEAD": { stdout: "not-a-number\n" } }));
      expect(r.ok).toBe(false);
    });
    test("the unpushed-commit check failing refuses instead of reading as nothing unpushed", async () => {
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count refs/remotes/origin/feat/x...HEAD": { stdout: "3\t2\n" }, "rev-list --cherry-pick --right-only --no-merges refs/remotes/origin/feat/x...HEAD ^refs/remotes/origin/develop": { code: 128, stderr: "fatal: bad revision" } }));
      expect(r.ok).toBe(false);
    });
  });
});

describe("branch_sync tool", () => {
  const guard: TreeGuardDeps = { repoIndex: () => ({ r: "/t" }), treeByPath: () => null, realpath: (p) => p, worktreeRoots: () => [], hasGitEntry: () => false };
  const BRANCH_HEAD = "rev-parse --verify --quiet refs/heads/feat/x";
  const ORIGIN_HEAD = "rev-parse --verify --quiet refs/remotes/origin/feat/x";
  const clean: Script = {
    [GIT_PATHS]: { stdout: "/t/.git/rebase-merge\n/t/.git/rebase-apply\n" },
    ...on("feat/x"), "symbolic-ref --quiet refs/remotes/origin/HEAD": { stdout: "refs/remotes/origin/develop\n" },
    "status --porcelain": {},
    "config --get-all remote.origin.push": { code: 1 }, "config --get push.default": { code: 1 },
    "fetch origin": {}, [ORIGIN_HEAD]: {},
    "rev-list --left-right --count refs/remotes/origin/feat/x...HEAD": { stdout: "0\t1\n" },
  };
  /** A repo whose branch and origin refs move when rt sync runs, the way a real sync moves them. */
  function repo(script: Script, refs: { head: string; origin: string }, calls: string[] = []): GitRunner {
    const inner = fakeGit(script, calls);
    return async (args, cwd) => {
      const key = args.join(" ");
      if (key === BRANCH_HEAD) { calls.push(key); return { code: 0, stdout: `${refs.head}\n`, stderr: "" }; }
      if (key === ORIGIN_HEAD && !(key in script)) { calls.push(key); return { code: 0, stdout: `${refs.origin}\n`, stderr: "" }; }
      return inner(args, cwd);
    };
  }
  const branchSync = (git: GitRunner, sync: GitToolDeps["sync"]) => gitToolDefs({ ...noForge, git, guard, sync }).find((t) => t.name === "branch_sync")!;
  const runSync = async (code: number, stdout: string, stderr = "", moves?: { head?: string; origin?: string }) => {
    const refs = { head: "aaa", origin: "aaa" };
    const { [ORIGIN_HEAD]: _answeredByRefs, ...script } = clean;
    const tool = branchSync(repo(script, refs), async () => {
      Object.assign(refs, moves ?? {});
      return { code, stdout, stderr };
    });
    return tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
  };

  test("a sync that moved and pushed the branch is synced, with both heads", async () => {
    const r = await runSync(0, "", "", { head: "bbb", origin: "bbb" });
    expect(r).toEqual({ ok: true, body: { kind: "synced", branch: "feat/x", oldHead: "aaa", newHead: "bbb", pushed: true, refusal: null, divergedFromOrigin: false, status: "synced", tree: "/t" } });
  });
  test("a sync that moved nothing is up-to-date and pushed nothing", async () => {
    const r = await runSync(0, "");
    expect(r).toEqual({ ok: true, body: { kind: "up-to-date", branch: "feat/x", oldHead: "aaa", newHead: "aaa", pushed: false, refusal: null, divergedFromOrigin: false, status: "synced", tree: "/t" } });
  });
  test("a dirty tree is dirty-tree, naming the paths, and never fetches or runs rt sync", async () => {
    let ran = false;
    const calls: string[] = [];
    const tool = branchSync(repo({ ...clean, "status --porcelain": { stdout: " M a.ts\n?? notes/b.md\n" } }, { head: "aaa", origin: "aaa" }, calls), async () => { ran = true; return { code: 0, stdout: "", stderr: "" }; });
    const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
    expect(r.body).toMatchObject({ kind: "dirty-tree", branch: "feat/x", oldHead: "aaa", newHead: "aaa", pushed: false, paths: ["a.ts", "notes/b.md"] });
    expect((r.body as { refusal: string }).refusal).toContain("uncommitted changes");
    expect(ran).toBe(false);
    expect(calls).not.toContain("fetch origin");
  });
  // commands/__tests__/sync-output.test.ts pins that rt sync --json writes
  // exactly this text for the same guard; change one and the other must follow.
  const REFUSED_STDERR =
    "[refused] You have uncommitted changes\n" +
    "  why: Syncing rewrites the branch, and a conflict would lose them.\n" +
    "  next: Commit them, or set them aside with rt git stash push\n";
  test("rt sync's own uncommitted-changes refusal is dirty-tree too, never an error", async () => {
    const r = await runSync(1, "", REFUSED_STDERR);
    expect(r.body).toMatchObject({ kind: "dirty-tree", pushed: false, refusal: "[refused] You have uncommitted changes   why: Syncing rewrites the branch, and a conflict would lose them.   next: Commit them, or set them aside with rt git stash push" });
  });
  test("a warning printed before rt sync's three-line ending stays out of the refusal", async () => {
    const warning = "[warning] Your repo folders setting could not be read  rt is looking in its usual places only\n  next: rt settings check\n";
    const r = await runSync(1, "", warning + REFUSED_STDERR);
    expect((r.body as { refusal: string }).refusal).toStartWith("[refused] You have uncommitted changes");
  });
  test("a conflict carries rt sync's bundle, the branch unmoved, nothing pushed", async () => {
    const bundle = { kind: "rebase-conflict", state: "mid-rebase", branch: "feat/x", target: "origin/develop", commitsBehind: 2, unresolvedFiles: ["a.ts"], autoResolvedFiles: [], backupBranch: null, branchCommits: [], targetCommits: [], hint: "resolve and continue" };
    const r = await runSync(3, JSON.stringify(bundle, null, 2));
    expect(r.ok).toBe(true);
    expect(r.body).toMatchObject({ kind: "conflict", status: "conflict", oldHead: "aaa", newHead: "aaa", pushed: false, unresolvedFiles: ["a.ts"], state: "mid-rebase" });
  });
  test("a stack refusal is stacked-refused, with the refusal text and the stack check", async () => {
    const refusal = { kind: "stack-refusal", branch: "feat/x", source: "gitq", stack: null, mrs: null, tool: "/gitq:sync", hint: "feat/x is a member of stack s; sync the stack instead" };
    const r = await runSync(4, JSON.stringify(refusal, null, 2));
    expect(r.ok).toBe(true);
    expect(r.body).toMatchObject({ kind: "stacked-refused", pushed: false, refusal: "feat/x is a member of stack s; sync the stack instead. Run: /gitq:sync", stackCheck: refusal });
  });
  test("a rejected push is push-refused: the branch moved locally, origin did not", async () => {
    const r = await runSync(1, "", "Could not push feat/x  ! [rejected] feat/x -> feat/x (stale info)\n", { head: "bbb" });
    expect(r.body).toMatchObject({ kind: "push-refused", oldHead: "aaa", newHead: "bbb", pushed: false, refusal: "Could not push feat/x  ! [rejected] feat/x -> feat/x (stale info)" });
  });
  test("any other rt sync failure is error, carrying what rt sync said", async () => {
    const r = await runSync(1, "", "Could not fetch from origin  fatal: unable to access\n");
    expect(r.body).toMatchObject({ kind: "error", pushed: false, refusal: "rt sync refused (exit 1): Could not fetch from origin  fatal: unable to access" });
  });
  test("rt sync that could not be started says so, and a timeout stays a timeout", async () => {
    expect((await runSync(-1, "")).body).toMatchObject({ kind: "error", refusal: "could not start rt sync" });
    expect((await runSync(124, "")).body).toMatchObject({ kind: "error", refusal: "rt sync timed out after 300s" });
  });
  test("a failed preflight is error, carrying its reason, and never runs rt sync", async () => {
    let ran = false;
    const tool = branchSync(repo({ ...clean, "rev-list --left-right --count refs/remotes/origin/feat/x...HEAD": { stdout: "1\t1\n" }, "rev-list --cherry-pick --right-only --no-merges refs/remotes/origin/feat/x...HEAD ^refs/remotes/origin/develop": { stdout: "9999\n" } }, { head: "aaa", origin: "aaa" }), async () => { ran = true; return { code: 0, stdout: "{}", stderr: "" }; });
    const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect(r.body).toMatchObject({ kind: "error", oldHead: "aaa", newHead: "aaa", pushed: false });
    expect((r.body as { refusal: string }).refusal).toContain("9999");
    expect(ran).toBe(false);
  });
  test("a detached HEAD is error with no branch and no heads", async () => {
    const tool = branchSync(fakeGit({ ...clean, [FULL_HEAD]: { code: 1 } }), async () => ({ code: 0, stdout: "", stderr: "" }));
    const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect(r.body).toMatchObject({ kind: "error", branch: null, oldHead: null, newHead: null, pushed: false });
  });
  test("a branch name carrying shell or a git option never reaches rt sync", async () => {
    for (const branch of ["x$(touch${IFS}PWNED)", "--mirror", "--all", "-f"]) {
      let ran = false;
      const calls: string[] = [];
      const tool = branchSync(fakeGit({ ...clean, ...on(branch) }, calls), async () => { ran = true; return { code: 0, stdout: "", stderr: "" }; });
      const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
      expect((r.body as { kind: string }).kind, branch).toBe("error");
      expect(ran, branch).toBe(false);
      expect(calls, branch).not.toContain("fetch origin");
    }
  });
  test("a branch name ambiguous with a tag never reaches rt sync", async () => {
    let ran = false;
    const calls: string[] = [];
    const tool = branchSync(fakeGit({ ...clean, ...onTagAmbiguous }, calls), async () => { ran = true; return { code: 0, stdout: "", stderr: "" }; });
    const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect((r.body as { kind: string; refusal: string }).refusal).toContain("ambiguous");
    expect(ran).toBe(false);
    expect(calls).not.toContain("fetch origin");
  });
  test("a push redirect never runs rt sync", async () => {
    let ran = false;
    const tool = branchSync(fakeGit({ ...clean, "config --get-all remote.origin.push": { stdout: "+refs/heads/*:refs/heads/*\n" } }), async () => { ran = true; return { code: 0, stdout: "{}", stderr: "" }; });
    const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect((r.body as { kind: string }).kind).toBe("error");
    expect(ran).toBe(false);
  });
});

describe("branch_sync_sweep", () => {
  const guard: TreeGuardDeps = {
    repoIndex: () => ({ r: "/t/main" }),
    treeByPath: (p) => (p.startsWith("/t/") && p !== "/t/stray" ? { repoName: "r", tree: p.slice(3) } : null),
    realpath: (p) => p,
    worktreeRoots: () => [],
    hasGitEntry: () => false,
  };
  const mrs = [
    { iid: 1, branch: "feat/a", url: "https://forge/mr/1" },
    { iid: 2, branch: "feat/b", url: "https://forge/mr/2" },
    { iid: 3, branch: "feat/c", url: "https://forge/mr/3" },
  ];
  const trees = [
    { path: "/t/main", branch: "main" },
    { path: "/t/a", branch: "feat/a" },
    { path: "/t/b", branch: "feat/b" },
  ];
  const deps = (over: Partial<GitToolDeps> = {}): GitToolDeps => ({
    ...noForge,
    git: fakeGit({}),
    guard,
    sync: async () => ({ code: 0, stdout: "", stderr: "" }),
    resolveRepo: async (repoName) => (repoName === "app" ? { ok: true, identity: "r" } : { ok: false, error: `no repo ${String(repoName)}` }),
    authoredOpenMrs: async () => ({ ok: true, mrs, complete: true }),
    repoTrees: async () => ({ ok: true, trees }),
    ...over,
  });
  const outcome = (kind: BranchSyncResult["kind"], branch: string): BranchSyncResult => ({ kind, branch, oldHead: "o", newHead: kind === "synced" ? "n" : "o", pushed: kind === "synced", refusal: null });

  test("syncs each of your open-MR branches that has a tree, in turn, and lists the ones that have none", async () => {
    const synced: string[] = [];
    const r = await branchSyncSweep("app", deps(), undefined, async (tree) => { synced.push(tree); return outcome("synced", tree === "/t/a" ? "feat/a" : "feat/b"); });
    expect(synced).toEqual(["/t/a", "/t/b"]);
    expect(r).toEqual({
      ok: true,
      body: {
        repoName: "r",
        results: [
          { ...outcome("synced", "feat/a"), tree: "/t/a", mr: { iid: 1, url: "https://forge/mr/1" } },
          { ...outcome("synced", "feat/b"), tree: "/t/b", mr: { iid: 2, url: "https://forge/mr/2" } },
        ],
        noTree: [{ branch: "feat/c", mr: { iid: 3, url: "https://forge/mr/3" } }],
        complete: true,
      },
    });
  });
  test("a conflict on one branch is reported and the sweep carries on to the next", async () => {
    const r = await branchSyncSweep("app", deps(), undefined, async (tree) => (tree === "/t/a" ? { ...outcome("conflict", "feat/a"), unresolvedFiles: ["x.ts"] } : outcome("synced", "feat/b")));
    const results = (r.body as { results: BranchSyncResult[] }).results;
    expect(results.map((x) => [x.branch, x.kind])).toEqual([["feat/a", "conflict"], ["feat/b", "synced"]]);
    expect(results[0]).toMatchObject({ unresolvedFiles: ["x.ts"] });
  });
  test("a conflict is left paused: the sweep runs rt sync, which pauses, and never aborts the rebase", async () => {
    const calls: string[] = [];
    const r = await branchSyncSweep("app", deps({ git: fakeGit({}, calls), sync: async (cwd) => (cwd === "/t/a" ? { code: 3, stdout: "{}", stderr: "" } : { code: 0, stdout: "", stderr: "" }) }));
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.startsWith("rebase"))).toBe(false);
  });
  test("a tree the guard will not admit is that branch's error, and the sweep carries on", async () => {
    const r = await branchSyncSweep("app", deps({ repoTrees: async () => ({ ok: true, trees: [{ path: "/t/stray", branch: "feat/a" }, trees[2]!] }) }), undefined, async () => outcome("up-to-date", "feat/b"));
    const results = (r.body as { results: Array<BranchSyncResult & { tree: string }> }).results;
    expect(results[0]).toMatchObject({ kind: "error", branch: "feat/a", tree: "/t/stray", pushed: false });
    expect(results[0]!.refusal).toContain("registered");
    expect(results[1]).toMatchObject({ kind: "up-to-date", branch: "feat/b" });
  });
  test("a cut-short MR listing still sweeps what it read, and says it is incomplete", async () => {
    const r = await branchSyncSweep("app", deps({ authoredOpenMrs: async () => ({ ok: true, mrs: mrs.slice(0, 1), complete: false }) }), undefined, async () => outcome("up-to-date", "feat/a"));
    expect(r.body).toMatchObject({ complete: false, results: [{ branch: "feat/a" }] });
  });
  test("an MR listing or worktree listing that fails syncs nothing", async () => {
    let ran = false;
    const syncTree = async () => { ran = true; return outcome("synced", "x"); };
    const noMrs = await branchSyncSweep("app", deps({ authoredOpenMrs: async () => ({ ok: false, error: "gh: not logged in" }) }), undefined, syncTree);
    const noTrees = await branchSyncSweep("app", deps({ repoTrees: async () => ({ ok: false, error: "daemon down" }) }), undefined, syncTree);
    expect(noMrs.ok).toBe(false);
    expect(noMrs.error).toContain("gh: not logged in");
    expect(noTrees.ok).toBe(false);
    expect(noTrees.error).toContain("daemon down");
    expect(ran).toBe(false);
  });
  test("an unknown repo is refused before anything is listed", async () => {
    let listed = false;
    const r = await branchSyncSweep("nope", deps({ authoredOpenMrs: async () => { listed = true; return { ok: true, mrs: [], complete: true }; } }));
    expect(r).toEqual({ ok: false, body: undefined, error: "no repo nope" });
    expect(listed).toBe(false);
  });
  test("reports progress before each branch it syncs, so a long sweep keeps the call alive", async () => {
    let ticks = 0;
    await branchSyncSweep("app", deps(), () => { ticks++; }, async () => outcome("up-to-date", "x"));
    expect(ticks).toBe(2);
  });
  test("the tool takes repoName and runs the sweep", async () => {
    const tool = gitToolDefs(deps()).find((t) => t.name === "branch_sync_sweep")!;
    expect(tool.inputSchema).toMatchObject({ required: ["repoName"] });
    const r = await tool.handler({ repoName: "nope" }, {} as NodeJS.ProcessEnv);
    expect(r.error).toBe("no repo nope");
  });
});

describe("the sweep's real seams", () => {
  const daemon = (r: { ok: boolean; data?: unknown; error?: string }, sent: unknown[] = []) =>
    (async (verb: string, payload: unknown) => { sent.push([verb, payload]); return r; }) as unknown as SweepIo["command"];
  const io = (over: Partial<SweepIo>): SweepIo => ({
    checkout: () => "/t/main",
    originOf: async () => "git@github.com:acme/widgets.git",
    gh: async () => ({ code: 0, stdout: "[]", stderr: "" }),
    command: daemon({ ok: false, error: "the daemon is not asked in this test" }),
    ...over,
  });

  test("GitHub: asks gh in the checkout for your open PRs, and keeps number, head branch and url", async () => {
    const asked: Array<[string[], string]> = [];
    const r = await realAuthoredOpenMrs("remote:github.com%2Facme%2Fwidgets", io({
      gh: async (args, cwd) => { asked.push([args, cwd]); return { code: 0, stdout: JSON.stringify([{ number: 5, headRefName: "feat/a", url: "https://github.com/acme/widgets/pull/5" }]), stderr: "" }; },
    }));
    expect(r).toEqual({ ok: true, mrs: [{ iid: 5, branch: "feat/a", url: "https://github.com/acme/widgets/pull/5" }], complete: true });
    expect(asked).toEqual([[["pr", "list", "--state", "open", "--author", "@me", "--limit", "200", "--json", "number,headRefName,url"], "/t/main"]]);
  });
  test("GitHub: a page as long as the limit may be cut short", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ number: i + 1, headRefName: `b${i}`, url: "u" }));
    const r = await realAuthoredOpenMrs("r", io({ gh: async () => ({ code: 0, stdout: JSON.stringify(rows), stderr: "" }) }));
    expect(r).toMatchObject({ ok: true, complete: false });
  });
  test("GitHub: a gh failure or an unreadable answer is a failed listing, never an empty one", async () => {
    expect((await realAuthoredOpenMrs("r", io({ gh: async () => ({ code: 4, stdout: "", stderr: "gh: not logged in" }) }))).ok).toBe(false);
    expect((await realAuthoredOpenMrs("r", io({ gh: async () => ({ code: 0, stdout: "null", stderr: "" }) }))).ok).toBe(false);
    expect((await realAuthoredOpenMrs("r", io({ gh: async () => ({ code: 0, stdout: JSON.stringify([{ number: 5 }]), stderr: "" }) }))).ok).toBe(false);
  });
  test("GitLab: asks the daemon for the signed-in user's open MRs and keeps iid, source branch and url", async () => {
    const sent: unknown[] = [];
    const r = await realAuthoredOpenMrs("remote:gitlab.acme.internal%2Fx%2Fy", io({
      originOf: async () => "https://gitlab.acme.internal/x/y.git",
      command: daemon({ ok: true, data: { mrs: [{ iid: 9, sourceBranch: "feat/b", webUrl: "https://gitlab.acme.internal/x/y/-/merge_requests/9" }], truncated: true } }, sent),
    }));
    expect(r).toEqual({ ok: true, mrs: [{ iid: 9, branch: "feat/b", url: "https://gitlab.acme.internal/x/y/-/merge_requests/9" }], complete: false });
    expect(sent).toEqual([["mr:list-live", { repoName: "remote:gitlab.acme.internal%2Fx%2Fy", author: "me", state: "opened", limit: 200 }]]);
  });
  test("a repo with no checkout, no origin, or an origin that is no known forge cannot be listed", async () => {
    expect((await realAuthoredOpenMrs("r", io({ checkout: () => undefined }))).ok).toBe(false);
    expect((await realAuthoredOpenMrs("r", io({ originOf: async () => null }))).ok).toBe(false);
    expect((await realAuthoredOpenMrs("r", io({ originOf: async () => "ssh://git.example.org/x/y.git" }))).ok).toBe(false);
  });
  test("worktrees come from the daemon's list for the repo", async () => {
    const sent: unknown[] = [];
    const command = daemon({ ok: true, data: { trees: [{ path: "/t/a", branch: "feat/a", name: "a" }, { path: "/t/d", branch: null }] } }, sent);
    expect(await realRepoTrees("r", command)).toEqual({ ok: true, trees: [{ path: "/t/a", branch: "feat/a" }, { path: "/t/d", branch: null }] });
    expect(sent).toEqual([["worktree:list", { repoName: "r" }]]);
    expect((await realRepoTrees("r", daemon({ ok: false, error: "daemon down" }))).ok).toBe(false);
  });
  test("repoName must be a string", async () => {
    expect(await realResolveRepo(3)).toEqual({ ok: false, error: '"repoName" must be a string' });
  });
});
