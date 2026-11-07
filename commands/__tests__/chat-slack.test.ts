/**
 * The Slack support verbs, in-process against a temp HOME and a real unix
 * socket dispatching to the real chat handlers. Slack itself is a fake.
 */
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { slackAssignment, slackClose, slackDelivered, slackOpen, slackPeople, slackRequest, slackResume, slackStart, slackStatus, slackTicket, slackWatch, type SlackWatchDeps } from "../chat-slack.ts";
import { chat } from "../chat.ts";
import { createChatHandlers } from "../../lib/daemon/handlers/chat.ts";
import { createSlackChatHandlers } from "../../lib/daemon/handlers/slack-chat.ts";
import { listAgentSafe } from "../../lib/command-tree-resolve.ts";
import { TREE } from "../../lib/command-tree-def.ts";
import { mcpTools } from "../../lib/mcp/tools.ts";
import { MODULE_REGISTRY } from "../../lib/module-registry.ts";
import { SLACK_SUPPORT_CHAT_SCOPES } from "../../lib/setup/slack-app.ts";
import type { SlackClient } from "../../lib/slack/client.ts";
import { closeConversation, closeStateDb, conversationById, enqueueItem, getStateDb, markItemDelivered, markOpenItemDelivered, openConversation } from "../../lib/state/index.ts";
import { endGrace, startGrace } from "../../lib/state/slack-conversation-store.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import * as ui from "../../lib/ui/out.ts";

const SESSION = "slack-cli-session";

let home = "";
let server: ReturnType<typeof Bun.serve> | null = null;
let seen: Array<{ cmd: string; payload: Record<string, unknown> }> = [];
let canned: Record<string, unknown> = {};
const saved: Record<string, string | undefined> = {};

const slack = {
  authTest: async () => ({ userId: "U0OPER", scopes: SLACK_SUPPORT_CHAT_SCOPES }),
  listUsers: async () => [
    { id: "U0OPER", name: "robin", displayName: "Robin", realName: "Robin Example", title: "", deleted: false, isBot: false },
    { id: "U0TEST", name: "alex", displayName: "Alex", realName: "Alex Example", title: "Support lead", deleted: false, isBot: false },
  ],
  openDm: async () => "D0TEST",
  newestTs: async () => "1700000000.000100",
} as unknown as SlackClient;

beforeEach(() => {
  for (const key of ["HOME", "HERDR_PANE_ID", "CLAUDE_CODE_SESSION_ID"]) saved[key] = process.env[key];
  delete process.env.HERDR_PANE_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-chat-slack-")));
  process.env.HOME = home;
  const sockDir = join(home, ".mattstack", "rt");
  mkdirSync(sockDir, { recursive: true });
  seen = [];
  canned = {};
  server = Bun.serve({
    unix: join(sockDir, "rt.sock"),
    async fetch(req) {
      const cmd = new URL(req.url).pathname.slice(1);
      const payload = (req.method === "POST" ? await req.json() : {}) as Record<string, unknown>;
      seen.push({ cmd, payload });
      if (cmd in canned) return Response.json(canned[cmd]);
      const db = getStateDb();
      const handlers = {
        ...createChatHandlers({ db, emitEvent: () => 0 }),
        ...createSlackChatHandlers({ db, emitEvent: () => 0, slackClient: async () => slack, notify: () => {} }),
      } as unknown as Record<string, (p: unknown) => Promise<unknown>>;
      const handler = handlers[cmd];
      if (!handler) return Response.json({ ok: false, error: `unknown command: ${cmd}` });
      return Response.json(await handler(payload));
    },
  });
});

afterEach(() => {
  server?.stop(true);
  server = null;
  closeStateDb();
  rmSync(home, { recursive: true, force: true });
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function run(fn: () => Promise<void>): Promise<{ code: number; stdout: string; stderr: string }> {
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  let code = 0;
  try {
    await fn();
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "process.exit sentinel") throw err;
    code = (exitSpy.mock.calls.at(-1)?.[0] as number | undefined) ?? 1;
  }
  const result = { code, stdout: io.stdout(), stderr: io.stderr() };
  exitSpy.mockRestore();
  io.restore();
  return result;
}

async function signIn(): Promise<void> {
  const res = await run(() => chat(["sign-in", "--name", "support", "--session", SESSION, "--no-room"]));
  expect(res.code).toBe(0);
  process.env.CLAUDE_CODE_SESSION_ID = SESSION;
}

async function openChat(): Promise<{ conversationId: number; frameMarker: string; room: string }> {
  await signIn();
  const res = await run(() => slackOpen(["alex", "--json"]));
  expect(res.code).toBe(0);
  return JSON.parse(res.stdout);
}

function lines(stdout: string): Record<string, unknown>[] {
  return stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** Runs one watcher; `onSleep` runs at each 2 second wait, numbered from 0. */
async function watch(onSleep: (n: number) => void, parentPid: SlackWatchDeps["parentPid"] = () => 4242) {
  const sleeps: number[] = [];
  const result = await run(() =>
    slackWatch(["--json"], {
      parentPid,
      sleep: async (ms) => {
        sleeps.push(ms);
        onSleep(sleeps.length - 1);
      },
    }),
  );
  return { ...result, sleeps };
}

test("slack-open prints the JSON shape", async () => {
  await signIn();
  const res = await run(() => slackOpen(["alex", "--json"]));
  expect(res.code).toBe(0);
  expect(res.stderr).toBe("");
  const parsed = JSON.parse(res.stdout);
  expect(Object.keys(parsed).sort()).toEqual(["conversationId", "frameMarker", "handle", "name", "ok", "room"]);
  expect(parsed).toMatchObject({ ok: true, handle: "slack.u0test", name: "alex-slack" });
  expect(seen.find((s) => s.cmd === "chat:slack-open")!.payload).toMatchObject({ sessionId: SESSION, person: "alex" });
});

test("slack-open keeps a refusal in the envelope under --json", async () => {
  await signIn();
  const res = await run(() => slackOpen(["nobody", "--json"]));
  expect(res.code).toBe(1);
  expect(res.stderr).toBe("");
  const parsed = JSON.parse(res.stdout);
  expect(parsed.ok).toBe(false);
  expect(parsed.error).toContain("nobody");
});

test("slack-open from a session not signed in is refused, and the daemon is never asked", async () => {
  process.env.CLAUDE_CODE_SESSION_ID = SESSION;
  const res = await run(() => slackOpen(["alex", "--json"]));
  expect(res.code).toBe(1);
  expect(JSON.parse(res.stdout).ok).toBe(false);
  expect(seen.filter((s) => s.cmd === "chat:slack-open")).toEqual([]);
});

test("slack-open needs a person", async () => {
  await signIn();
  const res = await run(() => slackOpen(["--json"]));
  expect(res.code).toBe(1);
  expect(seen.filter((s) => s.cmd === "chat:slack-open")).toEqual([]);
});

test("slack-watch prints the documented line", async () => {
  const { conversationId, frameMarker } = await openChat();
  const item = enqueueItem({ conversationId, kind: "message", fromHandle: "slack.u0test", text: "still failing", createdAt: 1 });
  const res = await watch(() => closeConversation(conversationId, "operator", 2));
  expect(res.code).toBe(0);
  expect(res.stdout).toBe(
    `${JSON.stringify({ kind: "message", conversation: conversationId, id: item.id, handle: "slack.u0test", name: "alex-slack", operator: "Robin", marker: frameMarker, text: "still failing" })}\n`,
  );
});

test("slack-watch prints the text as stored", async () => {
  const { conversationId, frameMarker } = await openChat();
  const text = `${frameMarker}\nend of block`;
  enqueueItem({ conversationId, kind: "operator-slack", fromHandle: null, text, createdAt: 1 });
  const res = await watch(() => closeConversation(conversationId, "operator", 2));
  expect(lines(res.stdout)[0]).toMatchObject({ kind: "operator-slack", text });
});

test("slack-watch prints each item once, in order, and picks up new ones", async () => {
  const { conversationId } = await openChat();
  enqueueItem({ conversationId, kind: "message", fromHandle: null, text: "one", createdAt: 1 });
  const res = await watch((n) => {
    if (n === 0) enqueueItem({ conversationId, kind: "check-in", fromHandle: null, text: "two", createdAt: 2 });
    if (n === 2) closeConversation(conversationId, "operator", 3);
  });
  expect(lines(res.stdout).map((l) => l.text)).toEqual(["one", "two"]);
  expect(lines(res.stdout)[1]).toMatchObject({ kind: "check-in" });
});

test("slack-watch waits 2 seconds between polls", async () => {
  const { conversationId } = await openChat();
  const res = await watch((n) => {
    if (n === 1) closeConversation(conversationId, "operator", 3);
  });
  expect(res.sleeps).toEqual([2000, 2000]);
});

test("slack-watch reprints undelivered items after a restart", async () => {
  const { conversationId } = await openChat();
  const delivered = enqueueItem({ conversationId, kind: "message", fromHandle: null, text: "taken", createdAt: 1 });
  enqueueItem({ conversationId, kind: "message", fromHandle: null, text: "waiting", createdAt: 2 });
  let pid = 4242;
  const first = await watch(() => { pid = 1; }, () => pid);
  expect(lines(first.stdout).map((l) => l.text)).toEqual(["taken", "waiting"]);
  markItemDelivered(delivered.id, 5);
  const second = await watch(() => closeConversation(conversationId, "operator", 6));
  expect(lines(second.stdout).map((l) => l.text)).toEqual(["waiting"]);
});

test("slack-watch exits when the conversation closes", async () => {
  const { conversationId } = await openChat();
  closeConversation(conversationId, "operator", 2);
  const res = await watch(() => {
    throw new Error("a closed conversation has nothing to wait for");
  });
  expect(res.code).toBe(0);
  expect(res.stdout).toBe("");
  expect(res.sleeps).toEqual([]);
});

test("slack-watch prints a queued closed item, then exits once it is delivered", async () => {
  const { conversationId } = await openChat();
  closeConversation(conversationId, "idle", 2);
  const closed = enqueueItem({ conversationId, kind: "closed", fromHandle: null, text: "closed", createdAt: 2 });
  const res = await watch(() => {
    expect(markOpenItemDelivered(closed.id, 3)).toBe(true);
  });
  expect(res.code).toBe(0);
  expect(lines(res.stdout).map((l) => l.kind)).toEqual(["closed"]);
  expect(res.sleeps).toEqual([2000]);
});

/** A closed chat that this session's agent ran, with an hour of grace, and its closed item already queued. */
async function gracedChat() {
  const { conversationId } = await openChat();
  getStateDb().query("UPDATE slack_conversations SET assigned_session = ? WHERE id = ?").run(SESSION, conversationId);
  closeConversation(conversationId, "idle", 2);
  startGrace(conversationId, Date.now() + 3_600_000);
  const closed = enqueueItem({ conversationId, kind: "closed", fromHandle: null, text: "closed", createdAt: 2 });
  return { conversationId, closed };
}

test("slack-watch stays through grace, delivers the resumed item, and exits once the new chat closes", async () => {
  const { conversationId, closed } = await gracedChat();
  let resumed = 0;
  let again = 0;
  const res = await watch((n) => {
    if (n === 0) markOpenItemDelivered(closed.id, 3);
    if (n === 1) {
      const old = conversationById(conversationId)!;
      const row = openConversation({ ...old, frameMarker: "marker2", lastReadTs: "1", openedAt: 10, resumedFrom: conversationId });
      resumed = row.id;
      enqueueItem({ conversationId: row.id, kind: "resumed", fromHandle: null, text: "back", createdAt: 10 });
      endGrace(conversationId);
    }
    if (n === 2) {
      closeConversation(resumed, "idle", 20);
      again = enqueueItem({ conversationId: resumed, kind: "closed", fromHandle: null, text: "closed again", createdAt: 20 }).id;
    }
    if (n === 3) markOpenItemDelivered(again, 21);
  });
  expect(res.code).toBe(0);
  expect(lines(res.stdout).map((l) => [l.kind, l.conversation])).toEqual([["closed", conversationId], ["resumed", resumed], ["closed", resumed]]);
  expect(res.sleeps).toEqual([2000, 10_000, 2000, 2000]);
});

test("slack-watch exits once grace ends with nothing resumed", async () => {
  const { conversationId, closed } = await gracedChat();
  const res = await watch((n) => {
    if (n === 0) markOpenItemDelivered(closed.id, 3);
    if (n === 1) endGrace(conversationId);
  });
  expect(res.code).toBe(0);
  expect(lines(res.stdout).map((l) => l.kind)).toEqual(["closed"]);
  expect(res.sleeps).toEqual([2000, 10_000]);
});

test("slack-watch exits when its parent pid changes", async () => {
  await openChat();
  let pid = 4242;
  const res = await watch(() => { pid = 1; }, () => pid);
  expect(res.code).toBe(0);
  expect(res.sleeps).toEqual([2000]);
  expect(seen.filter((s) => s.cmd === "chat:slack-pending")).toHaveLength(1);
});

test("slack-watch keeps its parent check going through a failed poll", async () => {
  const { conversationId } = await openChat();
  canned["chat:slack-pending"] = { ok: false, error: "daemon restarting" };
  const res = await watch((n) => {
    if (n === 1) delete canned["chat:slack-pending"];
    if (n === 2) closeConversation(conversationId, "operator", 3);
  });
  expect(res.code).toBe(0);
  expect(res.sleeps).toHaveLength(3);
});

test("slack-watch exits non-zero after a few failed polls if it never saw an open chat", async () => {
  await signIn();
  canned["chat:slack-pending"] = { ok: false, error: "unknown command" };
  const res = await watch((n) => {
    if (n > 20) throw new Error("still polling");
  });
  expect(res.code).toBe(1);
  expect(JSON.parse(res.stdout).ok).toBe(false);
  expect(seen.filter((s) => s.cmd === "chat:slack-pending")).toHaveLength(3);
});

test("slack-watch keeps polling through a long outage once it has seen an open chat", async () => {
  const { conversationId } = await openChat();
  const res = await watch((n) => {
    if (n === 0) canned["chat:slack-pending"] = { ok: false, error: "daemon restarting" };
    if (n === 10) {
      delete canned["chat:slack-pending"];
      closeConversation(conversationId, "operator", 3);
    }
  });
  expect(res.code).toBe(0);
  expect(res.sleeps).toHaveLength(11);
});

test("slack-watch from a session not signed in is refused", async () => {
  process.env.CLAUDE_CODE_SESSION_ID = SESSION;
  const res = await watch(() => {});
  expect(res.code).toBe(1);
  expect(seen.filter((s) => s.cmd === "chat:slack-pending")).toEqual([]);
});

test("slack-delivered sends the id and prints the result", async () => {
  const { conversationId } = await openChat();
  const item = enqueueItem({ conversationId, kind: "message", fromHandle: null, text: "x", createdAt: 1 });
  const res = await run(() => slackDelivered([String(item.id), "--json"]));
  expect(res.code).toBe(0);
  expect(JSON.parse(res.stdout)).toEqual({ ok: true, delivered: true });
});

test("slack-delivered refuses an id that is not a number", async () => {
  const res = await run(() => slackDelivered(["abc"]));
  expect(res.code).toBe(1);
  expect(seen).toEqual([]);
});

test("slack-status lists the open chats", async () => {
  const { conversationId, room } = await openChat();
  const json = await run(() => slackStatus(["--json"]));
  expect(JSON.parse(json.stdout)).toMatchObject({ ok: true, conversations: [{ id: conversationId, room, name: "alex-slack", displayName: "Alex" }] });
  const text = await run(() => slackStatus([]));
  expect(text.stdout).toContain("Alex");
  expect(text.stdout).not.toContain("alex-slack");
});

test("slack-status says when no chat is open", async () => {
  const res = await run(() => slackStatus([]));
  expect(res.stdout).toContain("No Slack chats are open");
});

test("a dm Slack took but the room didn't says so and links nothing", async () => {
  await signIn();
  canned["chat:dm"] = { ok: true, data: { room: "dm-x", id: 0, recipients: ["slack.u0test"], recipientNames: ["alex-slack"], note: "Slack has this message, but it isn't in the room, so do not send it again" } };
  const res = await run(() => chat(["dm", "alex-slack", "hello"]));
  expect(res.code).toBe(0);
  expect(res.stdout).toContain("do not send it again");
  expect(res.stdout).not.toContain("#0");
  expect(res.stdout).not.toContain("posted");
});

test("slack-people prints who a chat can open with", async () => {
  const res = await run(() => slackPeople(["--json"]));
  expect(res.code).toBe(0);
  expect(res.stdout).toBe('{"ok":true,"people":[{"name":"Alex Example","person":"U0TEST","title":"Support lead"}]}\n');
});

test("slack-people prints unavailable as an answer, for a refusal and for a daemon without the verb", async () => {
  canned["chat:slack-people"] = { ok: false, error: "slack-chat", failure: { code: "slack-chat", message: "Slack isn't connected" } };
  const refused = await run(() => slackPeople(["--json"]));
  expect(refused.code).toBe(0);
  expect(refused.stdout).toBe('{"ok":false,"reason":"unavailable","error":"Slack isn\'t connected"}\n');
  canned["chat:slack-people"] = { ok: false, error: "unknown command: chat:slack-people" };
  const old = await run(() => slackPeople(["--json"]));
  expect(old.code).toBe(0);
  expect(old.stdout).toBe('{"ok":false,"reason":"unavailable","error":"unknown command: chat:slack-people"}\n');
});

test("slack-people lists names and ids in plain text", async () => {
  const res = await run(() => slackPeople([]));
  expect(res.stdout).toContain("Alex");
  expect(res.stdout).toContain("U0TEST");
});

test("slack-close sends the pane", async () => {
  canned["chat:slack-close"] = { ok: true, data: { conversationId: 7, closed: false } };
  const res = await run(() => slackClose(["--pane", "w1:p1", "--json"]));
  expect(res.code).toBe(0);
  expect(JSON.parse(res.stdout)).toEqual({ ok: true, conversationId: 7, closed: false });
  expect(seen.find((s) => s.cmd === "chat:slack-close")!.payload).toEqual({ pane: "w1:p1" });
});

test("slack-close sends the farewell file for this session's own chat", async () => {
  await signIn();
  canned["chat:slack-close"] = { ok: true, data: { conversationId: 7, closed: true } };
  const file = join(home, "farewell.txt");
  writeFileSync(file, "All sorted.\n");
  const res = await run(() => slackClose(["--farewell-file", file]));
  expect(res.code).toBe(0);
  expect(seen.find((s) => s.cmd === "chat:slack-close")!.payload.farewell).toBe("All sorted.\n");
});

test("slack-close refuses --pane with --farewell-file, and nothing is sent", async () => {
  const file = join(home, "farewell.txt");
  writeFileSync(file, "All sorted.\n");
  const res = await run(() => slackClose(["--pane", "w1:p1", "--farewell-file", file]));
  expect(res.code).toBe(1);
  expect(res.stderr).toContain("rt chat slack-close [--pane <pane> | --farewell-file <path>]");
  expect(seen).toEqual([]);
});

test("slack-close with no pane closes this session's own chat", async () => {
  await signIn();
  canned["chat:slack-close"] = { ok: true, data: { conversationId: 7, closed: true } };
  const res = await run(() => slackClose([]));
  expect(res.code).toBe(0);
  const payload = seen.find((s) => s.cmd === "chat:slack-close")!.payload;
  expect(typeof payload.agentHandle).toBe("string");
  expect(typeof payload.sessionId).toBe("string");
  expect(payload.pane).toBeUndefined();
});

test("slack-close says when a credential was removed from the farewell", async () => {
  await signIn();
  canned["chat:slack-close"] = { ok: true, data: { conversationId: 7, closed: true, redacted: true } };
  const text = await run(() => slackClose([]));
  expect(text.stdout).toContain("redacted: something shaped like a credential was removed");
  const json = await run(() => slackClose(["--json"]));
  expect(JSON.parse(json.stdout)).toEqual({ ok: true, conversationId: 7, closed: true, redacted: true });
});

test("slack-close with an unreadable farewell file is a failure, and nothing is sent", async () => {
  await signIn();
  seen = [];
  const res = await run(() => slackClose(["--farewell-file", join(home, "absent.txt")]));
  expect(res.code).toBe(1);
  expect(seen).toEqual([]);
});

test.each([
  ["a bare --pane", ["--pane"], "--pane"],
  ["an empty --pane", ["--pane", ""], "--pane"],
  ["a --pane that swallows the next flag", ["--pane", "--farewell-file", "x"], "--pane"],
  ["a bare --farewell-file", ["--pane", "w1:p1", "--farewell-file"], "--farewell-file"],
  ["an empty --farewell-file", ["--farewell-file", ""], "--farewell-file"],
] as [string, string[], string][])("slack-close refuses %s, and nothing is sent", async (_name, args, flag) => {
  await signIn();
  seen = [];
  const res = await run(() => slackClose(args));
  expect(res.code).toBe(1);
  expect(res.stderr).toContain(`${flag} needs a value`);
  expect(seen).toEqual([]);
});

test("slack-open is hidden and absent from the agent-safe list and the MCP roster", () => {
  const verbs = TREE.chat!.subcommands!;
  for (const name of ["slack-open", "slack-people", "slack-watch", "slack-delivered", "slack-start", "slack-assignment", "slack-request", "slack-resume"]) {
    expect(verbs[name]!.hidden, name).toBe(true);
    expect(verbs[name]!.agentSafe, name).toBeUndefined();
  }
  expect(verbs["slack-close"]!.hidden).toBeUndefined();
  expect(verbs["slack-status"]!.hidden).toBeUndefined();
  expect(listAgentSafe(TREE).filter((e) => e.path.join(" ").includes("slack"))).toEqual([]);
  const tools = mcpTools().map((t) => t.name);
  expect(tools.length).toBeGreaterThan(20);
  expect(tools.filter((t) => /slack[_-]?(open|people|watch|delivered|pending)/.test(t))).toEqual([]);
});

test("every Slack verb names a registered export the dispatcher can call with its context", async () => {
  const mod = await MODULE_REGISTRY["./commands/chat-slack.ts"]!();
  const verbs = Object.entries(TREE.chat!.subcommands!).filter(([name]) => name.startsWith("slack-"));
  expect(verbs.length).toBeGreaterThan(0);
  for (const [name, node] of verbs) {
    expect(node.module, name).toBe("./commands/chat-slack.ts");
    expect(typeof mod[node.fn!], name).toBe("function");
    expect(mod[node.fn!].length, name).toBe(1);
  }
});

const TICKET_INPUT = { kind: "bug", title: "Export hangs", problem: "p", idea: "i", acceptance: ["a"] };

test("slack-ticket prints the id and url Linear gave", async () => {
  await signIn();
  canned["chat:slack-ticket"] = { ok: true, data: { id: "SUP-7", title: "Export hangs", url: "https://linear.app/x/issue/SUP-7" } };
  const res = await run(() => slackTicket([], async () => TICKET_INPUT));
  expect(res.code).toBe(0);
  expect(res.stdout).toContain("Ticket SUP-7 filed: https://linear.app/x/issue/SUP-7");
  expect(seen.find((s) => s.cmd === "chat:slack-ticket")!.payload).toMatchObject({ kind: "bug", title: "Export hangs" });
});

test("slack-ticket prints the JSON shape", async () => {
  await signIn();
  canned["chat:slack-ticket"] = { ok: true, data: { id: "SUP-7", title: "Export hangs", url: "https://linear.app/x/issue/SUP-7" } };
  const res = await run(() => slackTicket(["--json"], async () => TICKET_INPUT));
  expect(JSON.parse(res.stdout)).toEqual({ ok: true, id: "SUP-7", title: "Export hangs", url: "https://linear.app/x/issue/SUP-7" });
});

const START_SEAMS = { readBrief: async () => "Export hangs on large files", repo: () => "github.com/acme/app" };

test("slack-assignment prints the conversation the session was started for", async () => {
  canned["chat:slack-assignment"] = { ok: true, data: { conversation: 7 } };
  const res = await run(() => slackAssignment(["--session", SESSION, "--json"]));
  expect(res.code).toBe(0);
  expect(JSON.parse(res.stdout)).toEqual({ ok: true, conversation: 7 });
  expect(seen.find((s) => s.cmd === "chat:slack-assignment")!.payload).toEqual({ sessionId: SESSION });
});

test("slack-assignment prints null for a session nothing was assigned to", async () => {
  const res = await run(() => slackAssignment(["--session", SESSION, "--json"]));
  expect(res.code).toBe(0);
  expect(JSON.parse(res.stdout)).toEqual({ ok: true, conversation: null });
});

test("slack-assignment without a session is refused, and the daemon is never asked", async () => {
  const res = await run(() => slackAssignment(["--json"]));
  expect(res.code).toBe(1);
  expect(JSON.parse(res.stdout).ok).toBe(false);
  expect(seen).toEqual([]);
});

test("slack-start sends the brief read from stdin, the pane and the repo", async () => {
  canned["chat:slack-start"] = { ok: true, data: { conversation: 9 } };
  const res = await run(() => slackStart(["alex", "--brief", "-", "--requester-pane", "w1-2", "--json"], START_SEAMS));
  expect(res.code).toBe(0);
  expect(JSON.parse(res.stdout)).toEqual({ ok: true, conversation: 9 });
  expect(seen.find((s) => s.cmd === "chat:slack-start")!.payload).toEqual({
    person: "alex",
    brief: "Export hangs on large files",
    requesterPane: "w1-2",
    repo: "github.com/acme/app",
  });
});

test("slack-start from a signed-in session names the requester", async () => {
  await signIn();
  canned["chat:slack-start"] = { ok: true, data: { conversation: 9 } };
  await run(() => slackStart(["alex", "--brief", "-", "--json"], START_SEAMS));
  expect(seen.find((s) => s.cmd === "chat:slack-start")!.payload).toMatchObject({ requesterSession: SESSION, requesterHandle: expect.stringMatching(/^support\./) });
});

test("slack-start keeps a refusal in the envelope under --json", async () => {
  canned["chat:slack-start"] = { ok: false, error: "alex already has a Slack chat open in room" };
  const res = await run(() => slackStart(["alex", "--brief", "-", "--json"], START_SEAMS));
  expect(res.code).toBe(1);
  expect(res.stderr).toBe("");
  expect(JSON.parse(res.stdout)).toEqual({ ok: false, error: "alex already has a Slack chat open in room" });
});

test.each([
  ["no person", ["--brief", "-", "--json"], START_SEAMS],
  ["no --brief -", ["alex", "--json"], START_SEAMS],
  ["an empty brief", ["alex", "--brief", "-", "--json"], { ...START_SEAMS, readBrief: async () => "  " }],
  ["no repo underfoot", ["alex", "--brief", "-", "--json"], { ...START_SEAMS, repo: () => null }],
] as [string, string[], typeof START_SEAMS][])("slack-start with %s is refused, and nothing is sent", async (_name, args, seams) => {
  const res = await run(() => slackStart(args, seams as never));
  expect(res.code).not.toBe(0);
  expect(seen.filter((s) => s.cmd === "chat:slack-start")).toEqual([]);
});

test("slack-request --json prints gateId", async () => {
  await signIn();
  canned["chat:slack-request"] = { ok: true, data: { gateId: "gate-1" } };
  const res = await run(() => slackRequest(["alex", "--brief", "-", "--json"], START_SEAMS));
  expect(res.code).toBe(0);
  expect(JSON.parse(res.stdout)).toEqual({ ok: true, gateId: "gate-1" });
  expect(seen.find((s) => s.cmd === "chat:slack-request")!.payload).toEqual({
    person: "alex",
    brief: "Export hangs on large files",
    requesterSession: SESSION,
    requesterHandle: expect.stringMatching(/^support\./),
    repo: "github.com/acme/app",
  });
});

test("slack-request prints the candidates when the name is ambiguous", async () => {
  await signIn();
  canned["chat:slack-request"] = { ok: true, data: { candidates: [{ name: "Alex A", person: "U1" }, { name: "Alex B", person: "U2", title: "Lead" }] } };
  const json = await run(() => slackRequest(["alex", "--brief", "-", "--json"], START_SEAMS));
  expect(JSON.parse(json.stdout)).toEqual({ ok: true, candidates: [{ name: "Alex A", person: "U1" }, { name: "Alex B", person: "U2", title: "Lead" }] });
  const text = await run(() => slackRequest(["alex", "--brief", "-"], START_SEAMS));
  expect(text.stdout).toContain("Alex A");
  expect(text.stdout).toContain("U2");
});

test("slack-request keeps a refusal in the envelope under --json", async () => {
  await signIn();
  canned["chat:slack-request"] = { ok: false, error: "No one in Slack matches nobody" };
  const res = await run(() => slackRequest(["nobody", "--brief", "-", "--json"], START_SEAMS));
  expect(res.code).toBe(1);
  expect(JSON.parse(res.stdout)).toEqual({ ok: false, error: "No one in Slack matches nobody" });
});

test.each([
  ["no person", ["--brief", "-", "--json"], START_SEAMS, true],
  ["no --brief -", ["alex", "--json"], START_SEAMS, true],
  ["an empty brief", ["alex", "--brief", "-", "--json"], { ...START_SEAMS, readBrief: async () => "  " }, true],
  ["no repo underfoot", ["alex", "--brief", "-", "--json"], { ...START_SEAMS, repo: () => null }, true],
  ["a session that is not signed in", ["alex", "--brief", "-", "--json"], START_SEAMS, false],
] as [string, string[], typeof START_SEAMS, boolean][])("slack-request with %s is refused, and nothing is sent", async (_name, args, seams, signedIn) => {
  if (signedIn) await signIn();
  else process.env.CLAUDE_CODE_SESSION_ID = SESSION;
  const res = await run(() => slackRequest(args, seams as never));
  expect(res.code).not.toBe(0);
  expect(seen.filter((s) => s.cmd === "chat:slack-request")).toEqual([]);
});

test("slack-resume sends the conversation id and the caller, never an approval", async () => {
  await signIn();
  canned["chat:slack-resume"] = { ok: true, data: { gateId: "gate-2" } };
  const res = await run(() => slackResume(["7", "--approved", "--json"]));
  expect(res.code).toBe(0);
  expect(JSON.parse(res.stdout)).toEqual({ ok: true, gateId: "gate-2" });
  expect(seen.find((s) => s.cmd === "chat:slack-resume")!.payload).toEqual({
    conversation: 7,
    requesterSession: SESSION,
    requesterHandle: expect.stringMatching(/^support\./),
  });
});

test.each([["no id", []], ["a word", ["abc"]], ["zero", ["0"]]] as [string, string[]][])("slack-resume with %s is refused, and nothing is sent", async (_name, args) => {
  await signIn();
  const res = await run(() => slackResume([...args, "--json"]));
  expect(res.code).toBe(1);
  expect(seen.filter((s) => s.cmd === "chat:slack-resume")).toEqual([]);
});

test("slack-resume from a session that is not signed in is refused", async () => {
  process.env.CLAUDE_CODE_SESSION_ID = SESSION;
  const res = await run(() => slackResume(["7", "--json"]));
  expect(res.code).toBe(1);
  expect(seen.filter((s) => s.cmd === "chat:slack-resume")).toEqual([]);
});

test("slack-status prints the session, pane and ticket ids", async () => {
  canned["chat:slack-status"] = {
    ok: true,
    data: {
      closed: [],
      conversations: [
        {
          id: 4,
          room: "dm-x",
          handle: "slack.u0test",
          name: "alex-slack",
          agentName: "support",
          displayName: "Alex",
          openedAt: Date.now(),
          lastActiveAt: Date.now(),
          assignedSession: "agent-session-9",
          assignedPane: "bg:w1:p9",
          tickets: [
            { id: "SUP-7", title: "T", url: "https://linear.app/x/SUP-7", createdAt: 1 },
            { id: "SUP-9", title: "U", url: "https://linear.app/x/SUP-9", createdAt: 2 },
          ],
        },
      ],
    },
  };
  const text = await run(() => slackStatus([]));
  expect(text.stdout.indexOf("Last active")).toBeLessThan(text.stdout.indexOf("Session"));
  expect(text.stdout).toContain("agent-session-9");
  expect(text.stdout).toContain("bg:w1:p9");
  expect(text.stdout).toContain("SUP-7");
  expect(text.stdout).toContain("SUP-9");
});

test("slack-status says who is asking, so the daemon can return that caller's brief", async () => {
  await signIn();
  await run(() => slackStatus(["--json"]));
  expect(seen.find((s) => s.cmd === "chat:slack-status")!.payload).toEqual({ agentHandle: expect.stringMatching(/^support\./), sessionId: SESSION });
});
