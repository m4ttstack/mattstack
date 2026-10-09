import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeSessionRef, SessionBinding } from "../../packages/rt-client/src/agent-integrations.ts";
import { createSessionStore } from "../../lib/agent-integrations/session-store.ts";
import { claimWorktree, currentWorktree } from "../../lib/agent-integrations/worktrees.ts";
import { setSetting } from "../../lib/settings/write.ts";
import { closeStateDb, getStateDb } from "../../lib/state/db.ts";
import { getKvValue, setKvValue } from "../../lib/state/kv-blob.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import type { TreeRecord } from "../../lib/worktree/registry.ts";
import { holdForBoundCaller } from "../worktree.ts";
import { claudeHookCommand, relocationIsCallers } from "../worktree-hook.ts";

const REPO = "remote:example%2Fr";
let home = "";
let origHome: string | undefined;
let origSession: string | undefined;

function tree(name: string, state: TreeRecord["state"], claimedAt?: string): TreeRecord {
  return { name, path: `/pool/r/${name}`, kind: "ephemeral", state, branch: name, createdAt: "2026-10-09T00:00:00.000Z", ...(claimedAt && { claimedAt }) };
}

beforeEach(() => {
  origHome = process.env.HOME;
  origSession = process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  disposed = [];
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-wt-hook-")));
  process.env.HOME = home;
  setKvValue("worktree-registry", REPO, [
    tree("fred", "claimed", "2026-10-09T01:00:00.000Z"),
    tree("wilma", "claimed", "2026-10-09T01:05:00.000Z"),
  ], getStateDb());
});

afterEach(() => {
  closeStateDb();
  rmSync(home, { recursive: true, force: true });
  process.env.HOME = origHome;
  if (origSession === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = origSession;
});

const claude = (value: string): NativeSessionRef => ({ harness: "claude", profile: "default", kind: "id", value });

function bind(identity: string, value: string, attemptId?: string): SessionBinding {
  const store = createSessionStore(getStateDb());
  const r = store.bind(store.reserve({ identity, ...(attemptId && { attemptId }) }), claude(value), { mode: "herdr", pane: `w1:${identity}` });
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

let disposed: Array<Record<string, unknown>> = [];

const query = (async (cmd: string, payload?: Record<string, unknown>) => {
  if (cmd !== "worktree:dispose") return { ok: false, error: `unexpected ${cmd}` };
  disposed.push(payload ?? {});
  const db = getStateDb();
  const left = (getKvValue<TreeRecord[]>("worktree-registry", REPO, [], db)).filter((t) => t.name !== payload?.tree);
  setKvValue("worktree-registry", REPO, left, db);
  return { ok: true, data: { disposed: [payload?.tree], refused: [], recoverable: [] } };
}) as never;

const disposedTrees = () => disposed.map((p) => ({ repoName: p.repoName, tree: p.tree, force: p.force }));

async function runRemove(stdin: Record<string, unknown>): Promise<{ stdout: string; stderr: string; code: number | undefined }> {
  const input = spyOn(Bun.stdin, "text").mockResolvedValue(JSON.stringify({ hook_event_name: "WorktreeRemove", ...stdin }));
  const io = captureOut();
  out.__test__.setHuman(() => false);
  let code: number | undefined;
  const exit = spyOn(process, "exit").mockImplementation(((c?: number) => {
    code = c;
    throw new Error("exit");
  }) as unknown as typeof process.exit);
  try {
    await claudeHookCommand(["--remove"], undefined, { query }).catch((e: Error) => { if (e.message !== "exit") throw e; });
    return { stdout: io.stdout(), stderr: io.stderr(), code };
  } finally {
    exit.mockRestore();
    input.mockRestore();
    io.restore();
  }
}

describe("WorktreeRemove under agent.integrations.enabled", () => {
  test("a tree claimed before the switch went on still disposes on remove, the hook's own way", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    bind("remy.ab12", "s-bound", "att-1");
    const r = await runRemove({ session_id: "s-bound", worktree_path: "/pool/r/fred" });
    expect(r).toEqual({ stdout: "", stderr: "", code: 0 });
    expect(disposedTrees()).toEqual([{ repoName: REPO, tree: "fred", force: false }]);
  });

  test("a herd worker's remove of the tree its spawn provisioned still disposes it", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    bind("herd-worker.ef56", "s-worker", "att-herd-1");
    const r = await runRemove({ session_id: "s-worker", worktree_path: "/pool/r/wilma" });
    expect(r).toEqual({ stdout: "", stderr: "", code: 0 });
    expect(disposedTrees()).toEqual([{ repoName: REPO, tree: "wilma", force: false }]);
  });

  test("a holder's remove disposes its tree once", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    claimWorktree({ binding: bind("remy.ab12", "s-bound", "att-1") }, "/pool/r/fred");
    expect(await runRemove({ session_id: "s-bound", worktree_path: "/pool/r/fred" })).toEqual({ stdout: "", stderr: "", code: 0 });
    expect(await runRemove({ session_id: "s-bound", worktree_path: "/pool/r/fred" })).toEqual({ stdout: "", stderr: "", code: 0 });
    expect(disposedTrees()).toEqual([{ repoName: REPO, tree: "fred", force: false }]);
  });

  test("a bound session keeps a tree another session holds", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    claimWorktree({ binding: bind("ola.cd34", "s-other", "att-2") }, "/pool/r/wilma");
    bind("remy.ab12", "s-bound", "att-1");
    const r = await runRemove({ session_id: "s-bound", worktree_path: "/pool/r/wilma" });
    expect(r).toEqual({ stdout: "", stderr: "rt: tree kept: wilma is not held by this session\n", code: 0 });
    expect(disposed).toEqual([]);
  });

  test("with the switch off the hook keeps its old path and prints nothing for a path rt does not manage", async () => {
    bind("remy.ab12", "s-bound", "att-1");
    const r = await runRemove({ session_id: "s-bound", worktree_path: "/elsewhere/tree" });
    expect(r).toEqual({ stdout: "", stderr: "", code: 0 });
  });
});

describe("relocation announcements", () => {
  const announce = (path?: string) => ({ sessionId: "s-bound", tool: "EnterWorktree" as const, cwd: "/checkout/r", ...(path !== undefined && { path }) });

  test("a bound session is announced only for a tree it holds, which becomes its current one", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    const binding = bind("remy.ab12", "s-bound", "att-1");
    claimWorktree({ binding }, "/pool/r/fred");
    claimWorktree({ binding }, "/pool/r/wilma");
    expect(await relocationIsCallers(announce("/pool/r/fred"), {})).toBe(true);
    expect(currentWorktree({ binding })?.path).toBe("/pool/r/fred");
    claimWorktree({ binding: bind("ola.cd34", "s-other", "att-2") }, "/pool/r/wilma");
    expect(await relocationIsCallers(announce("/pool/r/wilma"), {})).toBe(true);
  });

  test("a bound session is not announced for a tree another session holds", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    claimWorktree({ binding: bind("ola.cd34", "s-other", "att-2") }, "/pool/r/wilma");
    bind("remy.ab12", "s-bound", "att-1");
    expect(await relocationIsCallers(announce("/pool/r/wilma"), {})).toBe(false);
  });

  test("a tree nobody holds (claimed before the switch, or by a herd spawn) still announces", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    bind("remy.ab12", "s-bound", "att-1");
    expect(await relocationIsCallers(announce("/pool/r/fred"), {})).toBe(true);
  });

  test("switch off, an unbound session, or a name-mode announcement announces as before", async () => {
    bind("remy.ab12", "s-bound", "att-1");
    expect(await relocationIsCallers(announce("/pool/r/fred"), {})).toBe(true);
    setSetting("agent.integrations.enabled", true, "machine");
    expect(await relocationIsCallers({ ...announce("/pool/r/fred"), sessionId: "s-unbound" }, {})).toBe(true);
    expect(await relocationIsCallers(announce(), {})).toBe(true);
  });
});

describe("rt worktree provision from a bound session", () => {
  test("records the session as the tree's holder", async () => {
    const binding = bind("remy.ab12", "s-bound", "att-1");
    await holdForBoundCaller("/pool/r/fred", { enabled: () => true, env: { CLAUDE_CODE_SESSION_ID: "s-bound" } });
    expect(currentWorktree({ binding })?.path).toBe("/pool/r/fred");
  });

  test("switch off, or a shell with no bound session, records nothing", async () => {
    const binding = bind("remy.ab12", "s-bound", "att-1");
    await holdForBoundCaller("/pool/r/fred", { enabled: () => false, env: { CLAUDE_CODE_SESSION_ID: "s-bound" } });
    await holdForBoundCaller("/pool/r/fred", { enabled: () => true, env: {} });
    await holdForBoundCaller("/pool/r/fred", { enabled: () => true, env: { CLAUDE_CODE_SESSION_ID: "s-unbound" } });
    expect(currentWorktree({ binding })).toBeNull();
  });
});
