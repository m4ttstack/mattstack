import { describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import { insertAgent, openStateDb, signIn, signOut, type SlackConversation } from "../../../state/index.ts";
import type { Commands } from "../../../../packages/rt-client/src/commands.ts";
import { slackOpenSeams } from "../slack-open-seams.ts";

const log = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } as unknown as Logger;
const RECORD = { id: "ag-1", repo: "github.com/acme/app", cwd: "/work/app", provider: "claude", surface: "herdr", sessionId: "s1", createdAt: 1, handle: "support-1", paneId: "bg:w1:p9" };

function build(over: { start?: () => Promise<unknown>; exitCode?: number; db?: Database; throws?: boolean } = {}) {
  const startArgs: Array<Commands["agent:start"]["payload"]> = [];
  const runs: Array<{ socket: string | null; args: string[] }> = [];
  const seams = slackOpenSeams({
    db: over.db ?? (null as never),
    log,
    agentStart: (async (payload: Commands["agent:start"]["payload"]) => {
      startArgs.push(payload);
      return over.start ? over.start() : { ok: true, data: RECORD };
    }) as never,
    gateOpen: (async () => ({ ok: true, data: { id: "g", supersededId: null } })) as never,
    gateClose: (async () => ({ ok: true, data: { ok: true } })) as never,
    gatesList: () => [],
    gateAppendContext: () => {},
    herdrRunnerFor: (socket) => async (args) => {
      runs.push({ socket, args });
      if (over.throws) throw new Error("herdr is gone");
      return { exitCode: over.exitCode ?? 0, stdout: "", stderr: "" } as never;
    },
    repoIndex: () => ({ "github.com/acme/app": "/work/app" }),
  });
  return { seams, startArgs, runs };
}

describe("slackOpenSeams", () => {
  test("startAgent launches a claude agent on the bg server in the support workspace, in a tab named for the teammate", async () => {
    const { seams, startArgs } = build();
    const res = await seams.startAgent("github.com/acme/app", "Leath Cooper");
    expect(res).toEqual({ ok: true, agent: { id: "ag-1", handle: "support-1", sessionId: "s1", paneId: "bg:w1:p9" }, reused: false });
    expect(startArgs[0]).toMatchObject({ provider: "claude", repo: "github.com/acme/app", cwd: "/work/app", bg: true, label: "slack-support", workspace: "support", tab: "Leath Cooper" });
  });

  test("a repo rt has no folder for starts nothing", async () => {
    const { seams, startArgs } = build();
    expect((await seams.startAgent("github.com/other/repo", "Leath Cooper")).ok).toBe(false);
    expect(startArgs).toEqual([]);
  });

  test("an agent:start error comes back as the reason", async () => {
    const { seams } = build({ start: async () => ({ ok: false, error: "bg launches require the rt daemon" }) });
    expect(await seams.startAgent("github.com/acme/app", "Leath Cooper")).toEqual({ ok: false, error: "bg launches require the rt daemon" });
  });

  test("a teammate's tab still open from an earlier chat gets a second tab with a suffix", async () => {
    let calls = 0;
    const { seams, startArgs } = build({ start: async () => ({ ok: true, data: { ...RECORD, reused: ++calls === 1 } }) });
    const res = await seams.startAgent("github.com/acme/app", "Leath Cooper");
    expect(res).toMatchObject({ ok: true, reused: false });
    expect(startArgs.map((a) => a.tab)).toEqual(["Leath Cooper", expect.stringMatching(/^Leath Cooper [0-9a-f]{4}$/)]);
  });

  test("an agent that comes back already running twice is reported as reused", async () => {
    const { seams, runs } = build({ start: async () => ({ ok: true, data: { ...RECORD, reused: true } }) });
    const res = await seams.startAgent("github.com/acme/app", "Leath Cooper");
    expect(res).toMatchObject({ ok: true, reused: true });
    expect(runs).toEqual([]);
  });

  test("an agent with no chat handle is closed and reported as a failure", async () => {
    const { seams, runs } = build({ start: async () => ({ ok: true, data: { ...RECORD, handle: undefined } }) });
    expect((await seams.startAgent("github.com/acme/app", "Leath Cooper")).ok).toBe(false);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.args).toEqual(["pane", "close", "w1:p9"]);
  });

  test("stopAgent closes a bg pane on the bg server's socket and never throws", async () => {
    const { seams, runs } = build({ exitCode: 1 });
    await seams.stopAgent({ id: "ag-1", handle: "h", sessionId: "s", paneId: "bg:w1:p9" });
    expect(runs).toEqual([{ socket: expect.stringContaining("herdr"), args: ["pane", "close", "w1:p9"] }]);
  });
});

describe("slackOpenSeams: resuming", () => {
  const conversation = (over: Partial<SlackConversation> = {}) =>
    ({ agentHandle: "support.abcd", assignedAgent: "ag-1", assignedSession: "sess-old", assignedPane: "bg:w1:p3", ...over }) as SlackConversation;
  let n = 0;
  function world() {
    const db = openStateDb(join(tmpdir(), `slack-seams-${process.pid}-${n++}-${Date.now()}.db`));
    const signed = signIn({ sessionId: "sess-old", baseHandle: "support", pane: "bg:w1:p3" }, db);
    return { db, handle: signed!.handle };
  }

  test("an agent is alive when its pane answers and its session is signed in as the conversation's handle", async () => {
    const { db, handle } = world();
    const { seams, runs } = build({ db });
    expect(await seams.agentAlive(conversation({ agentHandle: handle }))).toBe(true);
    expect(runs).toEqual([{ socket: expect.stringContaining("herdr"), args: ["pane", "get", "w1:p3"] }]);
  });

  test("an agent whose pane is gone is not alive", async () => {
    const { db, handle } = world();
    expect(await build({ db, exitCode: 1 }).seams.agentAlive(conversation({ agentHandle: handle }))).toBe(false);
    expect(await build({ db, throws: true }).seams.agentAlive(conversation({ agentHandle: handle }))).toBe(false);
  });

  test("an agent signed out, or in under another session, is not alive and its pane is not asked", async () => {
    const { db, handle } = world();
    const { seams, runs } = build({ db });
    expect(await seams.agentAlive(conversation({ agentHandle: handle, assignedSession: "another" }))).toBe(false);
    expect(await seams.agentAlive(conversation({ agentHandle: "nobody.zzzz" }))).toBe(false);
    signOut("sess-old", Date.now(), db);
    expect(await seams.agentAlive(conversation({ agentHandle: handle }))).toBe(false);
    expect(runs).toEqual([]);
  });

  test("a conversation with no assignment has no live agent", async () => {
    const { db } = world();
    expect(await build({ db }).seams.agentAlive(conversation({ assignedPane: null }))).toBe(false);
  });

  test("repoOf reads the repo the agent was started for", () => {
    const { db } = world();
    insertAgent({ ...RECORD, id: "ag-1", createdAt: 1 } as never, db);
    const { seams } = build({ db });
    expect(seams.repoOf(conversation())).toBe("github.com/acme/app");
    expect(seams.repoOf(conversation({ assignedAgent: "ag-missing" }))).toBeNull();
    expect(seams.repoOf(conversation({ assignedAgent: null }))).toBeNull();
  });
});
