import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createProjectMRsHandlers } from "../project-mrs.ts";
import { createProjectMRs } from "../../project-mrs-store.ts";
import { openStateDb } from "../../../state/index.ts";

const REPO = "remote:github.com%2Fo%2Fr";
const prOf = (iid: number, branch: string, author?: string) =>
  ({
    id: `github:o/r#${iid}`, iid, webUrl: `https://github.com/o/r/pull/${iid}`, title: "t",
    sourceBranch: branch, state: "opened", ...(author ? { author: { username: author } } : {}),
  }) as any;

const tmpStore = () => createProjectMRs(openStateDb(join(mkdtempSync(join(tmpdir(), "rt-prgh-")), "state.db"), "cli"));
const tracking = () => ({ [REPO]: { mode: "live" as const, caches: ["branches", "project-mrs"] as any } });

function handlers(store: ReturnType<typeof tmpStore>, over: Record<string, unknown>, debugs: string[] = []) {
  const log = { warn() {}, info() {}, error() {}, debug(_o: unknown, msg: string) { debugs.push(msg); } } as any;
  return createProjectMRsHandlers({ repoIndex: () => ({ [REPO]: "/tmp/repo" }), log }, () => {}, { store, tracking, ...over });
}

const batched = (found: Map<string, unknown>) => ({
  getContext: async () => ({
    forge: "github",
    provider: { fetchPullRequestsByBranches: async () => found },
    projectPath: "o/r",
  }),
});

describe("mr:by-branch on GitHub writes the project store", () => {
  test("mr:by-branch on GitHub stores a found PR on the batched path", async () => {
    const store = tmpStore();
    const pr = prOf(4, "feat");
    const h = handlers(store, batched(new Map([["feat", pr]])));
    const res = await h["mr:by-branch"]({ repoName: REPO, branches: ["feat"] }) as any;
    expect(res.ok).toBe(true);
    expect(res.data.byBranch.feat).toEqual({ pr, source: "forge" });
    expect(store.findBySourceBranch(REPO, "feat")?.iid).toBe(4);
  });

  test("mr:by-branch on GitHub respects scope, ignoring case", async () => {
    const store = tmpStore();
    store.fullSync(REPO, "o/r", [], Date.now());
    store.setScope(REPO, { authors: ["Octo"], windowDays: 30 });
    const mine = prOf(4, "mine", "octo");
    const theirs = prOf(5, "theirs", "stranger");
    const h = handlers(store, batched(new Map([["mine", mine], ["theirs", theirs]])));
    const res = await h["mr:by-branch"]({ repoName: REPO, branches: ["mine", "theirs"] }) as any;
    expect(res.data.byBranch.mine).toEqual({ pr: mine, source: "forge" });
    expect(res.data.byBranch.theirs).toEqual({ pr: theirs, source: "forge" });
    expect(store.findBySourceBranch(REPO, "mine")?.iid).toBe(4);
    expect(store.findBySourceBranch(REPO, "theirs")).toBeNull();
  });

  test("mr:by-branch on GitHub still errors when the branch lookup fails", async () => {
    const store = tmpStore();
    const h = handlers(store, {
      getContext: async () => ({
        forge: "github",
        provider: { fetchPullRequestsByBranches: async () => { throw new Error("socket hang up"); } },
        projectPath: "o/r",
      }),
    });
    const res = await h["mr:by-branch"]({ repoName: REPO, branches: ["feat"] }) as any;
    expect(res.ok).toBe(false);
    expect(store.read(REPO)).toBeUndefined();
  });

  test("mr:by-branch on GitHub stores a PR found on the per-branch path", async () => {
    const store = tmpStore();
    const debugs: string[] = [];
    const pr = prOf(6, "feat");
    const h = handlers(store, { fetchByBranch: async () => ({ pr, projectPath: "o/r" }) }, debugs);
    const res = await h["mr:by-branch"]({ repoName: REPO, branches: ["feat"] }) as any;
    expect(res.data.byBranch.feat).toEqual({ pr, source: "forge" });
    expect(store.findBySourceBranch(REPO, "feat")?.iid).toBe(6);
    expect(debugs).not.toContain("by-branch store upsert skipped for a GitHub repo");
  });
});
