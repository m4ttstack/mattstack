import { expect, test } from "bun:test";
import type { ChatPane, GateRow } from "../../../packages/rt-client/src/commands.ts";
import type { AgentRecord } from "../../state/agents-store.ts";
import type { HerdJobRow } from "../herd-store.ts";
import { paneExtras, type PaneExtrasSources } from "../pane-extras.ts";

const pane = (over: Partial<ChatPane> = {}): ChatPane => ({ paneId: "w1-3", workspace: "acme", agentStatus: "working", ...over });

const record = (over: Partial<AgentRecord> = {}): AgentRecord => ({
  id: "a-1", repo: "acme", cwd: "/r", provider: "claude", surface: "herdr", sessionId: "s1", createdAt: 1000, ...over,
});

const job = (over: Partial<HerdJobRow> = {}): HerdJobRow => ({
  herd: "h-7c1", name: "docs-sweep", worktree: "/w", branch: null, tree: null, pane: "w1-3", agentSession: null, agentId: null,
  handle: "ada", status: "running", disposable: false, model: null, effort: null, account: null, lastGate: null, lastReport: null,
  createdAt: 1, updatedAt: 1, ...over,
} as HerdJobRow);

const gate = (over: Partial<GateRow> = {}): GateRow => ({
  id: "g-1", subject: "run:1", kind: "decision", status: "open",
  questions: [{ id: "q1", label: "Merge now or wait for CI?", multi: false, options: [] }],
  pane: null, origin: null, ...over,
} as unknown as GateRow);

const sources = (over: Partial<PaneExtrasSources> = {}): PaneExtrasSources => ({ agents: [], jobsByPane: () => [], openGates: [], ...over });

test("agent matched by session id", () => {
  const rec = record({ sessionId: "s1", paneId: "w9-9", caller: "board:review", model: "opus-5.5", effort: "high", account: "me@x" });
  const out = paneExtras(pane({ sessionId: "s1" }), sources({ agents: [rec] }));
  expect(out.agent).toEqual({ id: "a-1", provider: "claude", caller: "board:review", model: "opus-5.5", effort: "high", account: "me@x", startedAt: 1000 });
});

test("pane-id fallback matches an unfinished record on the same server", () => {
  const out = paneExtras(pane({ sessionId: "s-live" }), sources({ agents: [record({ sessionId: "other", paneId: "w1-3" })] }));
  expect(out.agent?.id).toBe("a-1");
});

test("pane-id fallback skips finished records", () => {
  const out = paneExtras(pane({ sessionId: "s-live" }), sources({ agents: [record({ sessionId: "other", paneId: "w1-3", finishedAt: 5 })] }));
  expect(out.agent).toBeUndefined();
});

test("pane-id fallback skips the other server", () => {
  const out = paneExtras(pane({ paneId: "bg:w1-3" }), sources({ agents: [record({ sessionId: "other", paneId: "w1-3" })] }));
  expect(out.agent).toBeUndefined();
});

test("session match wins over a pane-id match", () => {
  const byPane = record({ id: "a-pane", sessionId: "other", paneId: "w1-3" });
  const bySession = record({ id: "a-sess", sessionId: "s1", paneId: "w4-4" });
  expect(paneExtras(pane({ sessionId: "s1" }), sources({ agents: [byPane, bySession] })).agent?.id).toBe("a-sess");
});

test("herd from jobsByPane", () => {
  const out = paneExtras(pane(), sources({ jobsByPane: (ref) => (ref === "w1-3" ? [job()] : []) }));
  expect(out.herd).toEqual({ herdId: "h-7c1", job: "docs-sweep" });
});

test("gate by origin.paneId, else pane", () => {
  const mine = gate({ origin: { paneId: "w1-3" } });
  const other = gate({ id: "g-2", origin: { paneId: "w2-1" } });
  expect(paneExtras(pane(), sources({ openGates: [other, mine] })).gate).toEqual({ id: "g-1", question: "Merge now or wait for CI?" });
  expect(paneExtras(pane(), sources({ openGates: [gate({ pane: "w1-3" })] })).gate?.id).toBe("g-1");
  expect(paneExtras(pane(), sources({ openGates: [other] })).gate).toBeUndefined();
});

test("empty sources", () => {
  expect(paneExtras(pane({ sessionId: "s1" }), sources())).toEqual({});
});
