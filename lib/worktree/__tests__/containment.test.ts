import { describe, test, expect, beforeEach, spyOn } from "bun:test";
import { execSync } from "child_process";
import { randomBytes } from "crypto";
import { mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { __test__, containmentOf, patchIdenticalToMr } from "../containment.ts";

const GIT_ID = "-c user.email=t@t -c user.name=t";
const sh = (cmd: string, cwd?: string) => execSync(cmd, { cwd, shell: "/bin/zsh", stdio: "pipe" }).toString().trim();

function repoWithOrigin(): { repo: string } {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "rtcontain-")));
  sh(`git init -q -b main ${repo}`);
  sh(`git ${GIT_ID} commit -q --allow-empty -m init`, repo);
  const bare = mkdtempSync(join(tmpdir(), "rtcontain-bare-"));
  sh(`git clone -q --bare ${repo} ${bare}/o.git && git -C ${repo} remote add origin ${bare}/o.git && git -C ${repo} fetch -q origin`);
  return { repo };
}

function commit(cwd: string, file: string, body: string): string {
  writeFileSync(join(cwd, file), body);
  sh(`git add -A && git ${GIT_ID} commit -q -m ${file}`, cwd);
  return sh("git rev-parse HEAD", cwd);
}

describe("containmentOf", () => {
  let repo: string;
  beforeEach(() => ({ repo } = repoWithOrigin()));

  test("a branch whose HEAD is in the default branch is in-default", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    sh("git push -q origin feat:main", repo);
    sh("git fetch -q origin", repo);
    expect(await containmentOf(repo, "feat", null)).toBe("in-default");
  });

  test("a pushed branch not in main is on-remote", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    sh("git push -q origin feat", repo);
    expect(await containmentOf(repo, "feat", null)).toBe("on-remote");
  });

  test("a branch rebased before merge is patch-identical to the merged MR", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    commit(repo, "b.txt", "b\n");
    const local = sh("git rev-parse HEAD", repo);
    // What the forge saw: the same two patches rebased onto a moved main.
    sh("git checkout -q main", repo);
    commit(repo, "other.txt", "o\n");
    sh("git checkout -q -b rebased", repo);
    sh(`git ${GIT_ID} cherry-pick feat~1 feat`, repo);
    const mrSha = sh("git rev-parse HEAD", repo);
    sh("git push -q origin main", repo);
    sh("git checkout -q feat", repo);
    expect(sh("git rev-parse HEAD", repo)).toBe(local);
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("patch-identical");
  });

  test("a local branch named origin/main never vouches for HEAD", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    sh("git branch origin/main feat", repo);
    expect(await containmentOf(repo, "feat", null)).toBe("none");
  });

  test("a squash-merged HEAD whose branch never reached the remote is in the merged MR", async () => {
    sh("git checkout -q -b feat", repo);
    const mrSha = commit(repo, "a.txt", "a\n");
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("in-merged-mr");
  });

  test("a tip inside a merged MR sha that had to be fetched is in the merged MR", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    const mrSha = commit(repo, "b.txt", "b\n");
    sh("git push -q origin HEAD:refs/merge-requests/1/head", repo);
    sh("git reset -q --hard HEAD~1 && git reflog expire --expire=now --all && git gc -q --prune=now", repo);
    expect(() => sh(`git cat-file -e ${mrSha}`, repo)).toThrow();
    const fetch = async () => {
      sh("git fetch -q origin refs/merge-requests/1/head", repo);
      return true;
    };
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha }, fetch)).toBe("in-merged-mr");
  });

  test("a branch holding a commit the merged MR lacks is none even when HEAD is in the MR", async () => {
    sh("git checkout -q -b feat", repo);
    const mrSha = commit(repo, "a.txt", "a\n");
    commit(repo, "later.txt", "never merged\n");
    sh(`git checkout -q --detach ${mrSha}`, repo);
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("none");
  });

  test("one extra local commit beyond the merged MR is none", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    const mrSha = sh("git rev-parse HEAD", repo);
    commit(repo, "extra.txt", "x\n");
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("none");
  });

  test("an MR sha that is not local and cannot be fetched fails closed", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    const missing = "0123456789abcdef0123456789abcdef01234567";
    expect(await patchIdenticalToMr(repo, missing, "origin/main", async () => false)).toBe(false);
    expect(await containmentOf(repo, "feat", { state: "merged", sha: missing }, async () => false)).toBe("none");
  });

  test("a rebase merged into main via an explicit merge commit is patch-identical", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    const local = sh("git rev-parse HEAD", repo);
    // What the forge saw: the same patch rebased onto a moved main, landed
    // with a real merge commit (GitLab's semi-linear merge method).
    sh("git checkout -q main", repo);
    commit(repo, "other.txt", "o\n");
    sh("git checkout -q -b rebased", repo);
    sh(`git ${GIT_ID} cherry-pick feat`, repo);
    const mrSha = sh("git rev-parse HEAD", repo);
    sh("git checkout -q main", repo);
    sh(`git ${GIT_ID} merge --no-ff -m merge rebased`, repo);
    sh("git push -q origin main", repo);
    sh("git fetch -q origin", repo);
    sh("git checkout -q feat", repo);
    expect(sh("git rev-parse HEAD", repo)).toBe(local);
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("patch-identical");
  });

  test("a rebase merged into main by fast-forward is patch-identical", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    const local = sh("git rev-parse HEAD", repo);
    // A moved main (so the rebased commit's parent differs from feat's own
    // parent) landed by fast-forward: mrSha becomes main's tip verbatim.
    sh("git checkout -q main", repo);
    commit(repo, "other.txt", "o\n");
    sh("git checkout -q -b rebased", repo);
    sh(`git ${GIT_ID} cherry-pick feat`, repo);
    const mrSha = sh("git rev-parse HEAD", repo);
    sh("git checkout -q main", repo);
    sh("git merge -q --ff-only rebased", repo);
    sh("git push -q origin main", repo);
    sh("git fetch -q origin", repo);
    sh("git checkout -q feat", repo);
    expect(sh("git rev-parse HEAD", repo)).toBe(local);
    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("patch-identical");
  });

  test("a local merge commit that adds content the MR lacks fails closed", async () => {
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    sh("git checkout -q -b side", repo);
    sh(`git ${GIT_ID} commit -q --allow-empty -m empty`, repo);
    sh("git checkout -q feat", repo);
    sh(`git ${GIT_ID} merge --no-ff --no-commit side`, repo);
    writeFileSync(join(repo, "sneaky.txt"), "s\n");
    sh("git add -A", repo);
    sh(`git ${GIT_ID} commit -q -m merge`, repo);

    // What the forge saw: only the a.txt patch, rebased onto main.
    sh("git checkout -q -b rebased main", repo);
    sh(`git ${GIT_ID} cherry-pick feat~1`, repo);
    const mrSha = sh("git rev-parse HEAD", repo);
    sh("git push -q origin rebased:main", repo);
    sh("git fetch -q origin", repo);
    sh("git checkout -q feat", repo);

    expect(await containmentOf(repo, "feat", { state: "merged", sha: mrSha })).toBe("none");
  });
});

describe("patchIdenticalToMr over an MR range that carries other history", () => {
  let repo: string;
  let mrSha: string;
  beforeEach(() => {
    __test__.clearMemo();
    ({ repo } = repoWithOrigin());
    sh("git checkout -q -b feat", repo);
    commit(repo, "a.txt", "a\n");
    // What the forge saw: other history merged into the MR branch first,
    // then the same a.txt patch on top.
    sh("git checkout -q -b big main", repo);
    commit(repo, "big.txt", randomBytes(64 << 10).toString("hex").replace(/(.{80})/g, "$1\n"));
    sh("git checkout -q -b mr big", repo);
    sh(`git ${GIT_ID} cherry-pick feat`, repo);
    mrSha = sh("git rev-parse HEAD", repo);
    sh("git checkout -q feat", repo);
  });

  test("git's patches go straight from git log into patch-id, never through a string", async () => {
    const realSpawn = Bun.spawn;
    const patchIdStdin: unknown[] = [];
    const spy = spyOn(Bun, "spawn").mockImplementation(((cmd: string[], opts: any) => {
      if (cmd[1] === "patch-id") patchIdStdin.push(opts?.stdin);
      return realSpawn(cmd, opts);
    }) as typeof Bun.spawn);
    try {
      expect(await patchIdenticalToMr(repo, mrSha, "origin/main", async () => false)).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(patchIdStdin).toHaveLength(2);
    for (const stdin of patchIdStdin) expect(stdin).toBeInstanceOf(ReadableStream);
  });

  test("a repeated question about the same commits is answered from memory", async () => {
    expect(await patchIdenticalToMr(repo, mrSha, "origin/main", async () => false)).toBe(true);
    expect(__test__.memoSize()).toBe(1);
    expect(await patchIdenticalToMr(repo, mrSha, "origin/main", async () => false)).toBe(true);
    expect(__test__.memoSize()).toBe(1);

    // A new local commit is a new question.
    commit(repo, "b.txt", "b\n");
    expect(await patchIdenticalToMr(repo, mrSha, "origin/main", async () => false)).toBe(false);
    expect(__test__.memoSize()).toBe(2);
  });
});

test("the patch-id memo never grows past its cap", () => {
  __test__.clearMemo();
  for (let i = 0; i < __test__.PATCH_MEMO_MAX + 10; i++) __test__.remember(`k${i}`, true);
  expect(__test__.memoSize()).toBe(__test__.PATCH_MEMO_MAX);
  __test__.clearMemo();
});
