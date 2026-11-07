import { describe, expect, test } from "bun:test";
import { chatToolDefs, realChatToolDeps, type ChatToolDeps } from "../chat-tools.ts";
import { mcpTools } from "../tools.ts";
import { SIGN_IN_HINT } from "../shared.ts";

const SESSION = { sessionId: "s1", handle: "support", baseHandle: "support", signedInAt: 1 };
const ENV = { CLAUDE_CODE_SESSION_ID: "s1" } as NodeJS.ProcessEnv;
const TICKET = { kind: "bug", title: "Export fails", problem: "It errors.", idea: "Fix the export.", acceptance: ["Export works"] };

const FORM = { label: "Open a Slack support chat with Alex? [slack-open gate-1]", options: [{ value: "approve", label: "Approve" }, { value: "decline", label: "Decline" }] };

type Call = { fn: string; a: any };

function fake(opts: { signedIn?: boolean; closeData?: unknown; fail?: string; repo?: string | null } = {}) {
  const calls: Call[] = [];
  const answer = (fn: string, data: unknown) => (async (a?: unknown) => {
    calls.push({ fn, a });
    return opts.fail ? { ok: false, error: opts.fail } : { ok: true, data };
  }) as any;
  const deps: ChatToolDeps = {
    ...realChatToolDeps,
    session: (id) => (opts.signedIn === false || id !== "s1" ? null : SESSION),
    buddies: (async () => ({ ok: true, data: { buddies: [] } })) as any,
    slackClose: answer("slackClose", opts.closeData ?? { conversationId: 7, closed: true }),
    slackStatus: answer("slackStatus", { conversations: [] }),
    slackTicket: answer("slackTicket", { id: "SUP-7", title: "T", url: "https://linear.app/x/SUP-7" }),
    slackRequest: answer("slackRequest", { gateId: "gate-1", question: FORM }),
    slackResume: answer("slackResume", { gateId: "gate-2", question: FORM }),
    serverCwd: () => "/work/app",
    repoOf: (cwd) => (cwd === "/work/app" ? (opts.repo === undefined ? "github.com/acme/app" : opts.repo) : null),
  };
  const tools = chatToolDefs(deps);
  return { calls, setAnswer: (fn: string, data: unknown) => void ((deps as any)[fn] = answer(fn, data)), tool: (name: string) => tools.find((t) => t.name === name)! };
}

describe("Slack pane tools", () => {
  test("chat_slack_close closes this pane's conversation only", async () => {
    const f = fake();
    const r = await f.tool("chat_slack_close").handler({ farewell: "All sorted.", handle: "mallory", agentHandle: "mallory", pane: "w9:p9" }, ENV);
    expect(r).toEqual({ ok: true, body: { conversationId: 7, closed: true } });
    expect(f.calls).toEqual([{ fn: "slackClose", a: { agentHandle: "support", sessionId: "s1", farewell: "All sorted." } }]);
  });

  test("chat_slack_close passes on that a credential was removed from the farewell", async () => {
    const f = fake({ closeData: { conversationId: 7, closed: true, redacted: true } });
    const r = await f.tool("chat_slack_close").handler({ farewell: "x" }, ENV);
    expect(r.body).toEqual({ conversationId: 7, closed: true, redacted: true });
    expect(f.tool("chat_slack_close").description).toMatch(/credential/);
  });

  test("chat_slack_close needs a farewell string", async () => {
    const f = fake();
    expect((await f.tool("chat_slack_close").handler({}, ENV)).ok).toBe(false);
    expect((await f.tool("chat_slack_close").handler({ farewell: 3 }, ENV)).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("chat_slack_ticket takes no path and returns the issue", async () => {
    const f = fake();
    const tool = f.tool("chat_slack_ticket");
    expect(Object.keys((tool.inputSchema as any).properties).sort()).toEqual(["acceptance", "idea", "kind", "problem", "title"]);
    const r = await tool.handler({ ...TICKET, path: "/etc/x", handle: "mallory", pane: "w9:p9" }, ENV);
    expect(r).toEqual({ ok: true, body: { id: "SUP-7", title: "T", url: "https://linear.app/x/SUP-7" } });
    expect(f.calls).toEqual([{ fn: "slackTicket", a: { agentHandle: "support", sessionId: "s1", ...TICKET } }]);
  });

  test("chat_slack_ticket refuses a wrong-shaped field before asking the daemon", async () => {
    const f = fake();
    expect((await f.tool("chat_slack_ticket").handler({ ...TICKET, acceptance: "one" }, ENV)).ok).toBe(false);
    expect((await f.tool("chat_slack_ticket").handler({ ...TICKET, title: undefined }, ENV)).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("chat_slack_status lists open conversations and says who is asking", async () => {
    const f = fake();
    const r = await f.tool("chat_slack_status").handler({}, ENV);
    expect(r).toEqual({ ok: true, body: { conversations: [] } });
    expect(f.calls).toEqual([{ fn: "slackStatus", a: {} }]);
  });

  test("chat_slack_request sends the brief and the caller's session and handle", async () => {
    const f = fake();
    const tool = f.tool("chat_slack_request");
    expect(Object.keys((tool.inputSchema as any).properties).sort()).toEqual(["brief", "person"]);
    const r = await tool.handler({ person: "alex", brief: "Export hangs", requesterSession: "evil", requesterHandle: "mallory", repo: "x" }, ENV);
    expect(r).toEqual({ ok: true, body: { gateId: "gate-1", question: FORM } });
    expect(f.calls).toEqual([
      { fn: "slackRequest", a: { person: "alex", brief: "Export hangs", requesterSession: "s1", requesterHandle: "support", repo: "github.com/acme/app" } },
    ]);
  });

  test("chat_slack_request passes candidates on so the requester can ask which one", async () => {
    const f = fake();
    f.setAnswer("slackRequest", { candidates: [{ name: "Alex A", person: "U1" }] });
    const r = await f.tool("chat_slack_request").handler({ person: "alex", brief: "b" }, ENV);
    expect(r).toEqual({ ok: true, body: { candidates: [{ name: "Alex A", person: "U1" }] } });
  });

  test("chat_slack_request refuses a missing field or a folder outside a repo before asking the daemon", async () => {
    const f = fake();
    expect((await f.tool("chat_slack_request").handler({ person: "alex" }, ENV)).ok).toBe(false);
    expect((await f.tool("chat_slack_request").handler({ brief: "b" }, ENV)).ok).toBe(false);
    const outside = fake({ repo: null });
    expect((await outside.tool("chat_slack_request").handler({ person: "alex", brief: "b" }, ENV)).ok).toBe(false);
    expect(f.calls).toEqual([]);
    expect(outside.calls).toEqual([]);
  });

  test("chat_slack_resume sends the conversation id and never an approval", async () => {
    const f = fake();
    const r = await f.tool("chat_slack_resume").handler({ conversation: 7, approved: true }, ENV);
    expect(r).toEqual({ ok: true, body: { gateId: "gate-2", question: FORM } });
    expect(f.calls).toEqual([{ fn: "slackResume", a: { conversation: 7, requesterSession: "s1", requesterHandle: "support" } }]);
  });

  test("chat_slack_resume needs a positive integer conversation", async () => {
    const f = fake();
    for (const conversation of [undefined, "7", 0, 1.5, -2]) {
      expect((await f.tool("chat_slack_resume").handler({ conversation }, ENV)).ok).toBe(false);
    }
    expect(f.calls).toEqual([]);
  });

  test.each([
    ["chat_slack_close", { farewell: "Bye." }],
    ["chat_slack_status", {}],
    ["chat_slack_ticket", TICKET],
    ["chat_slack_request", { person: "alex", brief: "b" }],
    ["chat_slack_resume", { conversation: 7 }],
  ])("%s refuses an unsigned session", async (name, input) => {
    const f = fake({ signedIn: false });
    const r = await f.tool(name).handler(input, ENV);
    expect(r).toEqual({ ok: false, body: undefined, error: SIGN_IN_HINT });
    expect(f.calls).toEqual([]);
  });

  test("a daemon refusal comes back as the tool's error", async () => {
    const f = fake({ fail: "This pane has no Slack chat open" });
    const r = await f.tool("chat_slack_close").handler({ farewell: "Bye." }, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("This pane has no Slack chat open");
  });

  test("the roster has no open tool", () => {
    const names = mcpTools().map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["chat_slack_close", "chat_slack_status", "chat_slack_ticket", "chat_slack_request", "chat_slack_resume"]));
    expect(names.filter((n) => /slack/.test(n) && /open|watch|deliver/.test(n))).toEqual([]);
  });
});
