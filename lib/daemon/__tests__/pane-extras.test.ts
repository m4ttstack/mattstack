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

const sources = (over: Partial<PaneExtrasSources> = {}): PaneExtrasSources => ({ agents: [], jobsByPane: () => [], herdActive: () => true, openGates: [], ...over });

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

test("herd skips a job from a wrapped herd that once used the pane id", () => {
  const old = job({ herd: "h-old", name: "old-job", status: "closed", updatedAt: 9 });
  const live = job({ herd: "h-new", name: "new-job", status: "active", updatedAt: 2 });
  const out = paneExtras(pane(), sources({ jobsByPane: () => [old, live], herdActive: (id) => id === "h-new" }));
  expect(out.herd).toEqual({ herdId: "h-new", job: "new-job" });
});

test("herd shows nothing when every job is from a wrapped herd", () => {
  const out = paneExtras(pane(), sources({ jobsByPane: () => [job({ status: "closed" })], herdActive: () => false }));
  expect(out.herd).toBeUndefined();
});

test("herd prefers a watched job over a finished one in the same herd", () => {
  const done = job({ name: "first", status: "done", updatedAt: 9 });
  const working = job({ name: "second", status: "at-gate", updatedAt: 2 });
  expect(paneExtras(pane(), sources({ jobsByPane: () => [done, working] })).herd?.job).toBe("second");
});

test("herd skips a job whose agent session is another Claude", () => {
  const theirs = job({ agentSession: "s-old" });
  expect(paneExtras(pane({ sessionId: "s-live" }), sources({ jobsByPane: () => [theirs] })).herd).toBeUndefined();
});

test("gate on a bg pane matches by the nudged session", () => {
  const g = gate({ pane: "w1-3", nudge: { session: "s1" } });
  expect(paneExtras(pane({ paneId: "bg:w1-3", sessionId: "s1" }), sources({ openGates: [g] })).gate?.id).toBe("g-1");
});

test("gate nudging another session skips a pane with the same id", () => {
  const g = gate({ pane: "w1-3", nudge: { session: "s-bg" } });
  expect(paneExtras(pane({ sessionId: "s-visible" }), sources({ openGates: [g] })).gate).toBeUndefined();
});

test("gate with an empty origin pane falls back to the pane column", () => {
  const g = gate({ origin: { paneId: "" }, pane: "w1-3" });
  expect(paneExtras(pane(), sources({ openGates: [g] })).gate?.id).toBe("g-1");
});

test("empty sources", () => {
  expect(paneExtras(pane({ sessionId: "s1" }), sources())).toEqual({});
});
