import { describe, expect, test } from "bun:test";
import { chatToolDefs, realChatToolDeps, type ChatToolDeps } from "../chat-tools.ts";
import { mcpTools } from "../tools.ts";
import { SIGN_IN_HINT } from "../shared.ts";

const SESSION = { sessionId: "s1", handle: "support", baseHandle: "support", signedInAt: 1 };
const ENV = { CLAUDE_CODE_SESSION_ID: "s1" } as NodeJS.ProcessEnv;
const TICKET = { kind: "bug", title: "Export fails", problem: "It errors.", idea: "Fix the export.", acceptance: ["Export works"] };

type Call = { fn: string; a: any };

function fake(opts: { signedIn?: boolean; closeData?: unknown; fail?: string } = {}) {
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
    slackTicket: answer("slackTicket", { path: "/tmp/ticket.md" }),
  };
  const tools = chatToolDefs(deps);
  return { calls, tool: (name: string) => tools.find((t) => t.name === name)! };
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

  test("chat_slack_ticket takes no path", async () => {
    const f = fake();
    const tool = f.tool("chat_slack_ticket");
    expect(Object.keys((tool.inputSchema as any).properties).sort()).toEqual(["acceptance", "idea", "kind", "problem", "title"]);
    const r = await tool.handler({ ...TICKET, path: "/etc/x", handle: "mallory", pane: "w9:p9" }, ENV);
    expect(r).toEqual({ ok: true, body: { path: "/tmp/ticket.md" } });
    expect(f.calls).toEqual([{ fn: "slackTicket", a: { agentHandle: "support", sessionId: "s1", ...TICKET } }]);
  });

  test("chat_slack_ticket refuses a wrong-shaped field before asking the daemon", async () => {
    const f = fake();
    expect((await f.tool("chat_slack_ticket").handler({ ...TICKET, acceptance: "one" }, ENV)).ok).toBe(false);
    expect((await f.tool("chat_slack_ticket").handler({ ...TICKET, title: undefined }, ENV)).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("chat_slack_status lists open conversations", async () => {
    const f = fake();
    const r = await f.tool("chat_slack_status").handler({}, ENV);
    expect(r).toEqual({ ok: true, body: { conversations: [] } });
    expect(f.calls.map((c) => c.fn)).toEqual(["slackStatus"]);
  });

  test.each([
    ["chat_slack_close", { farewell: "Bye." }],
    ["chat_slack_status", {}],
    ["chat_slack_ticket", TICKET],
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
    expect(names).toEqual(expect.arrayContaining(["chat_slack_close", "chat_slack_status", "chat_slack_ticket"]));
    expect(names.filter((n) => /slack/.test(n) && /open|watch|deliver/.test(n))).toEqual([]);
  });
});
