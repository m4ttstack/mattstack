import { expect, test } from "bun:test";
import type { ChatPane } from "../../packages/rt-client/src/commands.ts";
import type { PickRequest, PickResult, PickRow, PickSegment } from "../../lib/ui/protocol.ts";
import { UserActionableError } from "../../lib/errors.ts";
import { attachRows, paneAttachWith, type AttachDeps } from "../pane-attach.ts";

const kirk: ChatPane = {
  paneId: "w1:p3", workspace: "acme", tab: "api", cwd: "/src/acme", repo: "acme", branch: "main", agentStatus: "working", sessionId: "s1",
  presence: { handle: "kirk", name: "kirk", status: "live", rooms: ["mattstack", "build"] },
  agent: { id: "a-1", provider: "claude", caller: "board:review", model: "opus-5.5", effort: "high", account: "me@x", startedAt: Date.UTC(2026, 10, 17, 15, 4) },
};
const anon: ChatPane = { paneId: "w1:p4", workspace: "acme", tab: "web", cwd: "/src/web", repo: "web", branch: "dev", agentStatus: "idle" };
const worker: ChatPane = {
  paneId: "bg:w9:p1", workspace: "bg", cwd: "/w/docs", repo: "acme", branch: "docs", agentStatus: "working",
  presence: { handle: "ada", name: "ada", status: "live", rooms: [] }, herd: { herdId: "h-7c1", job: "docs-sweep" },
};
const other: ChatPane = { paneId: "w2:p1", workspace: "mattstack", agentStatus: "blocked", gate: { id: "g-1", question: "Merge now or wait for CI?" }, herd: { herdId: "h-2", job: "x" } };

const text = (segs: PickSegment[] | undefined) => (segs ?? []).map((s) => s.text).join("");
const rowOf = (rows: PickRow[], id: string) => rows.find((r) => r.value === id)!;
const section = (r: PickRow, title: string) => r.preview!.sections.find((s) => s.title === title);

test("groups: workspace label, background last", () => {
  const rows = attachRows([worker, kirk, other, anon], new Map(), new Map(), undefined);
  expect(rows.map((r) => [r.value, r.group])).toEqual([
    ["w1:p3", "acme"], ["w1:p4", "acme"], ["w2:p1", "mattstack"], ["bg:w9:p1", "background"],
  ]);
});

test("self excluded", () => {
  const rows = attachRows([kirk, anon], new Map(), new Map(), "w1:p3");
  expect(rows.map((r) => r.value)).toEqual(["w1:p4"]);
});

test("badge priority: gate > herd > caller > first room", () => {
  const rows = attachRows([kirk, anon, worker, other], new Map(), new Map(), undefined);
  const badge = (id: string) => rowOf(rows, id).right!.at(-1)!.text.trim();
  expect(badge("w2:p1")).toBe("? gate");
  expect(badge("bg:w9:p1")).toBe("herd h-7c1");
  expect(badge("w1:p3")).toBe("board:review");
  expect(badge("w1:p4")).not.toMatch(/gate|herd|#/);
  const roomOnly = attachRows([{ ...kirk, agent: undefined }], new Map(), new Map(), undefined)[0]!;
  expect(roomOnly.right!.at(-1)!.text.trim()).toBe("#mattstack");
});

test("not signed in", () => {
  const row = attachRows([anon], new Map(), new Map(), undefined)[0]!;
  const name = row.left.find((s) => s.text.includes("not signed in"))!;
  expect(name.tone).toBe("faint");
  expect(row.preview!.face).toEqual({ placeholder: "?" });
});

test("a signed-in pane gets its face path", () => {
  const row = attachRows([kirk], new Map([["kirk", "/faces/kirk.png"]]), new Map(), undefined)[0]!;
  expect(row.preview!.face).toEqual({ path: "/faces/kirk.png" });
  const missing = attachRows([kirk], new Map(), new Map(), undefined)[0]!;
  expect(missing.preview!.face).toEqual({ placeholder: "?" });
});

test("hand-started: started by hand, not in a herd, no gate", () => {
  const row = attachRows([anon], new Map(), new Map(), undefined)[0]!;
  expect(section(row, "STARTED BY")!.rows.map((r) => text(r.value))).toEqual(["started by hand"]);
  expect(section(row, "HERD")!.rows.map((r) => text(r.value))).toEqual(["not in a herd"]);
  expect(section(row, "GATE")).toBeUndefined();
});

test("preview header for a signed-in agent pane is four lines", () => {
  const row = attachRows([kirk], new Map(), new Map(), undefined)[0]!;
  const header = row.preview!.header;
  expect(header).toHaveLength(4);
  expect(header[0]![0]).toMatchObject({ text: "kirk", bold: true });
  expect(text(header[1])).toBe("working · live in chat");
  expect(text(header[2])).toBe("#mattstack #build");
  expect(text(header[3])).toBe("claude · opus-5.5 · high");
  const noRecord = attachRows([{ ...kirk, agent: undefined }], new Map(), new Map(), undefined)[0]!;
  expect(noRecord.preview!.header).toHaveLength(3);
});

test("WHERE rows", () => {
  const row = attachRows([kirk], new Map(), new Map(), undefined)[0]!;
  expect(section(row, "WHERE")!.rows.map((r) => [r.key, text(r.value)])).toEqual([
    ["repo", "acme · main"], ["folder", "/src/acme"], ["herdr", "acme › api · pane w1:p3"],
  ]);
});

test("STARTED BY carries the agent record", () => {
  const row = attachRows([kirk], new Map(), new Map(), undefined)[0]!;
  const rows = section(row, "STARTED BY")!.rows.map((r) => [r.key, text(r.value)]);
  expect(rows.slice(0, 3)).toEqual([["agent", "a-1"], ["caller", "board:review"], ["account", "me@x"]]);
  expect(rows[3]![0]).toBe("started");
});

test("gate present: GATE sits before HERD with the question", () => {
  const row = attachRows([other], new Map(), new Map(), undefined)[0]!;
  const titles = row.preview!.sections.map((s) => s.title);
  expect(titles.indexOf("GATE")).toBeLessThan(titles.indexOf("HERD"));
  expect(text(section(row, "GATE")!.rows[0]!.value)).toBe("Merge now or wait for CI?");
  expect(section(row, "HERD")!.rows.map((r) => [r.key, text(r.value)])).toEqual([["herd", "h-2"], ["job", "x"]]);
});

test("screen lines come from the peeks", () => {
  const row = attachRows([kirk], new Map(), new Map([["w1:p3", ["a", "b", "c"]]]), undefined)[0]!;
  expect(row.preview!.screen).toEqual(["a", "b", "c"]);
  expect(attachRows([anon], new Map(), new Map(), undefined)[0]!.preview!.screen).toBeUndefined();
});

test("match carries handle, repo, branch, tab and rooms", () => {
  const match = attachRows([kirk], new Map(), new Map(), undefined)[0]!.match!;
  for (const word of ["kirk", "acme", "main", "api", "mattstack", "build"]) expect(match).toContain(word);
});

// ─── the verb ──────────────────────────────────────────────────────────────

function deps(over: Partial<AttachDeps> & { picked?: Partial<PickResult> } = {}) {
  const calls = { spawned: [] as Array<{ argv: string[]; env: Record<string, string | undefined> }>, plans: [] as Array<{ paneId: string; takeover?: boolean }>, focused: [] as string[], picks: [] as PickRequest[], cachedLater: [] as string[][] };
  const d: AttachDeps = {
    isTTY: () => true,
    selfRef: () => undefined,
    list: async () => ({ ok: true, data: { panes: [kirk, anon] } }),
    peek: async () => ({ ok: true, data: { paneId: "x", lines: [] } }),
    faces: async () => new Map(),
    plan: async (p) => { calls.plans.push(p); return { ok: true, data: { argv: ["herdr", "agent", "attach", p.paneId], env: { HERDR_SESSION: "s" } } }; },
    focus: async (p) => { calls.focused.push(p.paneId); return { ok: true, data: { paneId: p.paneId, focused: true } }; },
    pick: async (req) => { calls.picks.push(req as PickRequest); return { t: "result", action: "attach", value: "w1:p3", query: "", ...over.picked } as PickResult; },
    spawn: async (argv, env) => { calls.spawned.push({ argv, env }); return 7; },
    cacheLater: (handles) => { calls.cachedLater.push(handles); },
    exit: ((code: number) => { throw new Error(`exit ${code}`); }) as AttachDeps["exit"],
    ...over,
  };
  return { d, calls };
}

test("no pane off a terminal is a usage failure and spawns nothing", async () => {
  const { d, calls } = deps({ isTTY: () => false });
  const err = await paneAttachWith([], d).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(UserActionableError);
  expect((err as UserActionableError).message).toBe("Which pane should rt attach to?");
  expect((err as UserActionableError).next).toBe("rt pane attach <pane>");
  expect(calls.spawned).toEqual([]);
  expect(calls.picks).toEqual([]);
});

test("only the self pane at a terminal: no picker, nothing to attach to", async () => {
  const { d, calls } = deps({ selfRef: () => "w1:p3", list: async () => ({ ok: true, data: { panes: [kirk] } }) });
  const err = await paneAttachWith([], d).catch((e: unknown) => e);
  expect((err as UserActionableError).message).toBe("No Claude panes to attach to");
  expect(calls.picks).toEqual([]);
});

test("a named pane attaches straight away with the plan's env over the caller's", async () => {
  const { d, calls } = deps();
  await expect(paneAttachWith(["w1:p3"], d)).rejects.toThrow("exit 7");
  expect(calls.plans).toEqual([{ paneId: "w1:p3" }]);
  expect(calls.spawned[0]!.argv).toEqual(["herdr", "agent", "attach", "w1:p3"]);
  expect(calls.spawned[0]!.env.HERDR_SESSION).toBe("s");
  expect(calls.spawned[0]!.env.PATH).toBe(process.env.PATH);
  expect(calls.picks).toEqual([]);
});

test("--takeover on a named pane asks for a takeover plan", async () => {
  const { d, calls } = deps();
  await expect(paneAttachWith(["w1:p3", "--takeover"], d)).rejects.toThrow("exit 7");
  expect(calls.plans).toEqual([{ paneId: "w1:p3", takeover: true }]);
});

test("the picker opens fullscreen with the three actions", async () => {
  const { d, calls } = deps();
  await expect(paneAttachWith([], d)).rejects.toThrow("exit 7");
  const req = calls.picks[0]!;
  expect(req.layout).toBe("fullscreen");
  expect(req.breadcrumb).toEqual(["rt", "pane attach"]);
  expect(req.idleCount).toBe("2 agents · 0 waiting on you");
  expect(req.actions!.map((a) => [a.id, a.key])).toEqual([["attach", "enter"], ["takeover", "ctrl+t"], ["focus", "ctrl+f"]]);
  expect(calls.plans).toEqual([{ paneId: "w1:p3" }]);
});

test("ctrl-t asks for a takeover plan", async () => {
  const { d, calls } = deps({ picked: { action: "takeover" } });
  await expect(paneAttachWith([], d)).rejects.toThrow("exit 7");
  expect(calls.plans).toEqual([{ paneId: "w1:p3", takeover: true }]);
});

test("ctrl-f focuses, spawns nothing and exits at once", async () => {
  const { d, calls } = deps({ picked: { action: "focus" } });
  await expect(paneAttachWith([], d)).rejects.toThrow("exit 0");
  expect(calls.focused).toEqual(["w1:p3"]);
  expect(calls.spawned).toEqual([]);
});

test("esc exits at once without attaching", async () => {
  const { d, calls } = deps({ picked: { action: "cancel", value: null } });
  await expect(paneAttachWith([], d)).rejects.toThrow("exit 0");
  expect(calls.plans).toEqual([]);
  expect(calls.spawned).toEqual([]);
});

test("a failed plan is a plain failure", async () => {
  const { d } = deps({ plan: async () => ({ ok: false, error: "The background herdr server isn't running" }) });
  const err = await paneAttachWith(["bg:w9:p1"], d).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(UserActionableError);
  expect((err as UserActionableError).message).toBe("The background herdr server isn't running");
});

test("faces still missing when the picker opens are handed off to be cached", async () => {
  const ada: ChatPane = { ...anon, paneId: "w1:p9", presence: { handle: "ada", name: "ada", status: "live", rooms: [] } };
  const { d, calls } = deps({ list: async () => ({ ok: true, data: { panes: [kirk, ada, anon] } }), faces: async () => new Map([["kirk", "/faces/kirk.png"]]) });
  await expect(paneAttachWith([], d)).rejects.toThrow("exit 7");
  expect(calls.cachedLater).toEqual([["ada"]]);
});
