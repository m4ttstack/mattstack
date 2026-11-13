/**
 * GET /api/cache/:branch?repoIdentity=<wire>: the store already holds one
 * entry per (repo identity, branch), so two repos sharing a branch name must
 * each be readable over REST. A read with no identity keeps today's payload.
 */
import { describe, test, expect } from "bun:test";
import type { Server } from "bun";
import { startApiServer, type ApiServerDeps } from "../api-server.ts";
import { createCacheHandlers } from "../handlers/cache.ts";
import { composeKey } from "../../state/branch-cache.ts";
import { setSetting, unsetSetting } from "../../settings/write.ts";
import { fakeStore } from "./fake-cache-store.ts";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

const REPO_A = "remote:github.com%2Fo%2Fa";
const REPO_B = "remote:github.com%2Fo%2Fb";

async function ephemeralPort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  if (port === undefined) throw new Error("Bun.serve did not report a bound port");
  return port;
}

async function withApiServer(
  handleCommand: ApiServerDeps["handleCommand"],
  run: (port: number) => Promise<void>,
): Promise<void> {
  const port = await ephemeralPort();
  setSetting("rt.apiPort", port, "user");
  let server: Server<any> | undefined;
  try {
    server = await startApiServer({ handleCommand, log: noopLog });
    await run(port);
  } finally {
    server?.stop(true);
    unsetSetting("rt.apiPort", "user");
  }
}

/** The real cache:read handler over two repos that both have a `main` entry. */
function sharedBranchCache() {
  const calls: Array<{ cmd: string; payload: any }> = [];
  const handlers = createCacheHandlers({
    cache: fakeStore({
      [composeKey(REPO_A, "main")]: { linearId: "A", ticket: null, mr: null, fetchedAt: 1, repoName: REPO_A },
      [composeKey(REPO_B, "main")]: { linearId: "B", ticket: null, mr: null, fetchedAt: 2, repoName: REPO_B },
    }),
    refreshCache: async () => {},
  } as any);
  const handleCommand: ApiServerDeps["handleCommand"] = async (cmd, payload) => {
    calls.push({ cmd, payload });
    return (handlers as any)[cmd](payload);
  };
  return { calls, handleCommand };
}

describe("GET /api/cache/:branch with a repo identity", () => {
  test("each of two repos sharing a branch name reads its own entry", async () => {
    const { handleCommand } = sharedBranchCache();
    await withApiServer(handleCommand, async (port) => {
      for (const [repo, want] of [[REPO_A, "A"], [REPO_B, "B"]] as const) {
        const res = await fetch(`http://127.0.0.1:${port}/api/cache/main?repoIdentity=${encodeURIComponent(repo)}`);
        const body = await res.json() as any;
        expect(body.ok).toBe(true);
        expect(Object.keys(body.data)).toEqual(["main"]);
        expect(body.data.main.linearId).toBe(want);
      }
    });
  });

  test("a read with no identity sends cache:read exactly today's payload", async () => {
    const { calls, handleCommand } = sharedBranchCache();
    await withApiServer(handleCommand, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/cache/main`);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
      expect(Object.keys(body.data)).toEqual(["main"]);
      expect(calls).toEqual([{ cmd: "cache:read", payload: { branches: ["main"] } }]);
    });
  });

  test("an identity that is not a serialized wire resolves nothing, never another repo's entry", async () => {
    const { calls, handleCommand } = sharedBranchCache();
    await withApiServer(handleCommand, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/cache/main?repoIdentity=${encodeURIComponent("github.com/o/b")}`);
      expect(await res.json()).toEqual({ ok: true, data: {} });
      expect(calls).toEqual([]);
    });
  });
});
