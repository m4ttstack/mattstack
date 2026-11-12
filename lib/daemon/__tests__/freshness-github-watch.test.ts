import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GitHubProvider, type EventCursor, type InvalidationBatch, type WatchEventsOptions } from "@mattstack/glance";
import * as githubTokenModule from "../../github-token.ts";
import * as linearModule from "../../linear.ts";
import * as repoTrackingModule from "../../repo-tracking.ts";
import type { RepoTracking } from "../../repo-tracking.ts";
import type { CacheEntry } from "../../state/index.ts";
import { composeKey } from "../../state/branch-cache.ts";
import { __test__ as freshnessTest, createFreshness, type FreshnessEnv, type FreshnessUnit } from "../freshness.ts";
import { fakeStore } from "./fake-cache-store.ts";

const REPO = "gh-watch-repo";
const PROJECT_PATH = "acme/watched";

interface WatchCall {
  projectPath: string;
  options: WatchEventsOptions;
  onInvalidations: (batch: InvalidationBatch) => void;
  disposed: number;
  provider: GitHubProvider;
}

let repoPath: string;
let token: string | null;
let tracking: RepoTracking;
let watchCalls: WatchCall[];
let infos: string[];
let statuses: string[];
let entries: Record<string, CacheEntry>;
let spies: { mockRestore(): void }[];
let restoreLog: () => void;
let unit: FreshnessUnit | null;
let env: FreshnessEnv;

beforeEach(() => {
  repoPath = realpathSync(mkdtempSync(join(tmpdir(), "rt-gh-watch-")));
  execFileSync("git", ["init", "-q"], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["remote", "add", "origin", `git@github.com:${PROJECT_PATH}.git`], { cwd: repoPath, stdio: "pipe" });
  token = "ghp_a";
  tracking = { [REPO]: { mode: "live", caches: ["branches"] } };
  watchCalls = [];
  infos = [];
  statuses = [];
  entries = {};
  restoreLog = freshnessTest.swapLog({
    info: (...args: unknown[]) => {
      const msg = args.find((a): a is string => typeof a === "string");
      if (msg !== undefined) infos.push(msg);
    },
    warn: () => {},
    debug: () => {},
    error: () => {},
  } as never);
  spies = [
    spyOn(linearModule, "loadSecrets").mockImplementation((async () => ({})) as never),
    spyOn(githubTokenModule, "resolveGithubToken").mockImplementation((async () =>
      token === null ? null : { token, source: "stored" }) as never),
    spyOn(repoTrackingModule, "loadRepoTracking").mockImplementation(() => tracking),
    spyOn(GitHubProvider.prototype, "watchEvents").mockImplementation(function (
      this: GitHubProvider,
      projectPath: string,
      options: WatchEventsOptions,
      onInvalidations: (batch: InvalidationBatch) => void,
    ) {
      const call: WatchCall = { projectPath, options, onInvalidations, disposed: 0, provider: this };
      watchCalls.push(call);
      return () => { call.disposed++; };
    }),
    spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://api.github.com/user") {
        return new Response(JSON.stringify({ id: 9, login: "octo" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not stubbed", { status: 500 });
    }) as typeof fetch),
  ];
  env = {
    ctx: {
      cache: fakeStore(entries),
      repoIndex: () => ({ [REPO]: repoPath }),
    } as unknown as FreshnessEnv["ctx"],
    broadcast: (type: string, data: { connection?: string }) => {
      if (type === "mr:status" && data.connection) statuses.push(data.connection);
    },
  };
  unit = createFreshness(env);
});

afterEach(() => {
  unit?.dispose();
  for (const spy of spies) spy.mockRestore();
  restoreLog();
  rmSync(repoPath, { recursive: true, force: true });
});

describe("live watch on a GitHub repo", () => {
  test("reconcile starts a GitHub watch for a live GitHub repo", async () => {
    await unit!.reconcile();
    expect(watchCalls).toHaveLength(1);
    expect(watchCalls[0]!.projectPath).toBe(PROJECT_PATH);
    expect("intervalMs" in watchCalls[0]!.options).toBe(false);
    expect(unit!.getSnapshot()[REPO]?.state).toBe("live");
    expect(statuses.at(-1)).toBe("connected");
  });

  test("no GitHub token, no watch, one info line", async () => {
    token = null;
    await unit!.reconcile();
    await unit!.reconcile();
    expect(watchCalls).toHaveLength(0);
    expect(infos.filter((m) => m.includes(REPO))).toHaveLength(1);
  });

  test("a token change restarts the GitHub watch", async () => {
    await unit!.reconcile();
    token = "ghp_b";
    await unit!.reconcile();
    expect(watchCalls).toHaveLength(2);
    expect(watchCalls[0]!.disposed).toBe(1);
    expect(watchCalls[1]!.disposed).toBe(0);
    expect(watchCalls[1]!.provider).not.toBe(watchCalls[0]!.provider);
  });

  test("two reconciles with the same token keep one watch", async () => {
    await unit!.reconcile();
    await unit!.reconcile();
    expect(watchCalls).toHaveLength(1);
    expect(watchCalls[0]!.disposed).toBe(0);
  });

  test("a removed token stops the watch and a returning token starts a new one", async () => {
    await unit!.reconcile();
    expect(watchCalls).toHaveLength(1);
    token = null;
    await unit!.reconcile();
    expect(watchCalls[0]!.disposed).toBe(1);
    expect(unit!.getSnapshot()).toEqual({});
    expect(statuses.at(-1)).toBe("disconnected");
    token = "ghp_a";
    await unit!.reconcile();
    expect(watchCalls).toHaveLength(2);
    expect(watchCalls[1]!.disposed).toBe(0);
    expect(unit!.getSnapshot()[REPO]?.state).toBe("live");
  });

  test("a watch on a repo no longer live is disposed", async () => {
    await unit!.reconcile();
    tracking = { [REPO]: { mode: "poll", caches: ["branches"] } };
    await unit!.reconcile();
    expect(watchCalls[0]!.disposed).toBe(1);
    expect(unit!.getSnapshot()).toEqual({});
    expect(statuses.at(-1)).toBe("disconnected");
  });

  test("a GitHub batch reaches the mapping with forge github", async () => {
    entries[composeKey(REPO, "feat")] = {
      repoName: REPO,
      mr: { iid: 3 },
      fetchedAt: 0,
    } as unknown as CacheEntry;
    const fetchSingle = spyOn(GitHubProvider.prototype, "fetchSingleMR").mockResolvedValue(null);
    spies.push(fetchSingle);
    await unit!.reconcile();
    const cursor: EventCursor = { since: null, lastEventId: "1", seenIds: ["1"] };
    watchCalls[0]!.onInvalidations({ invalidations: [{ kind: "mr", ref: "3", cause: "PullRequestEvent" }], syncedAt: new Date().toISOString(), cursor });
    for (let i = 0; i < 20 && fetchSingle.mock.calls.length === 0; i++) await Bun.sleep(5);
    expect(fetchSingle).toHaveBeenCalledWith(PROJECT_PATH, 3, null, expect.any(Function));
  });

  test("a GitHub cursor's string id reports as a number", async () => {
    await unit!.reconcile();
    watchCalls[0]!.options.onCursor!({ since: null, lastEventId: "41234567890", seenIds: ["41234567890"] });
    expect(unit!.getSnapshot()[REPO]?.lastEventId).toBe(41234567890);
  });
});
