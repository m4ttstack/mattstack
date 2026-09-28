# Herd watchdog follow-up rounds and form-only gate Escape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the herd watchdog nagging a done job that is mid follow-up round (RT-355), and stop gate-push pressing Escape into a herd worker's fresh turn (RT-357).

**Architecture:** Five tasks. The lifecycle keeps its status subscription on done-job panes so the watchdog's quiet clock sees post-report activity. The watchdog adapter reads the Claude Code footer of idle job panes to spot background shells, monitors and subagents, and the evaluators treat that as working. A shepherd-only `herd:follow-up` verb flips a done job back to `active`. gate-push probes the pane before the doorbell and only presses Escape when the pane reads `blocked`.

**Tech Stack:** Bun + TypeScript, `bun:test`, herdr socket API (`session.snapshot`, `pane.read`), rt daemon handlers, rt-client workspace package, MCP tool defs.

**Spec:** `docs/superpowers/specs/2026-09-27-herd-watchdog-followup-and-gate-escape-design.md`

## Global Constraints

- Run every test from the repo root (`bun test <path>`); bun reads `bunfig.toml` only from the cwd.
- Test-first for every task: the new test must fail before the code change.
- No em dashes or en dashes anywhere (code, comments, commit messages). Use `...`, parens or rephrase.
- Comments state constraints the code cannot show; no narration, no review/process history. Ticket ids in comments are fine only where they anchor a why (the file already does this with RT-205).
- `packages/rt-client`: rebuild `dist/` (`bun run build` inside `packages/rt-client`) after touching its source; no version bump, no publish.
- Never run a built binary or the daemon against the real `~/.mattstack`; tests only.
- Commit after each task with a short imperative message ending in `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Write fence: `lib/daemon/herd-watchdog.ts`, `herd-watchdog-adapters.ts`, `herd-lifecycle.ts`, `gate-push.ts`, `gate-escape.ts`, `lib/daemon/handlers/herd.ts`, one wiring line in `lib/daemon.ts`, `commands/herd.ts`, `lib/command-tree-def.ts`, `lib/mcp/herd-tools.ts`, `packages/rt-client/src/{commands,client,index}.ts`, their tests, `docs/`.
- Final verification: `bun run test`, `bunx tsc --noEmit`, `bash scripts/repo-purity.sh`, `bun run picker:check`, plus `lib/daemon/__tests__/gates-e2e.test.ts` and any `e2e/` file naming herd or gate.

## Review Focus

- Transcript text above the composer that mentions "1 shell" must not mark a pane busy (Task 2 test).
- One pane whose `pane.read` fails must not abort the refresh or mark any pane busy (Task 2 test).
- A shepherd holding a Monitor must still be flagged for a human gate it left open (Task 3 test).
- A follow-up round ends normally: follow-up then report puts the job back to `done` with a new `lastReport` (Task 4 test).
- A probe that throws, or herdr being unreachable, still delivers the doorbell and sends no Escape (Task 5 test).

---

### Task 1: Keep watching a done job's pane

**Files:**
- Modify: `lib/daemon/herd-lifecycle.ts` (`WATCHED` at line ~54, `reconcilePanes` at line ~146)
- Test: `lib/daemon/__tests__/herd-lifecycle.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `lc.lastStatusChangeMs(pane)` keeps moving for a `done` job's pane.

- [ ] **Step 1: Write the failing tests**

In the test at line ~122 ("start opens a status stream per live job pane..."), job-b is `done` on `w1:p2`. Change its first assertion so a done pane is now subscribed, and the later assertions to match:

```ts
    lc.start();
    expect(paneSubs().map((s) => s.subscriptions[0]!.pane_id).sort()).toEqual(["w1:p1", "w1:p2"]);
    store.upsertJob({ herd: herd.id, name: "job-c", worktree: "/w3", handle: "job-c", status: "spawning", pane: "w1:p3" });
    await lc.handleEvent(null, { type: "pane.agent_detected", pane_id: "w1:p3" });
    expect(paneSubs().map((s) => s.subscriptions[0]!.pane_id).sort()).toEqual(["w1:p1", "w1:p2", "w1:p3"]);
    await lc.handleEvent(null, { type: "pane.exited", pane_id: "w1:p3" });
    expect(paneSubs().map((s) => s.subscriptions[0]!.pane_id).sort()).toEqual(["w1:p1", "w1:p2"]);
    store.setJobStatus(herd.id, "job-a", "closed");
    store.setJobStatus(herd.id, "job-b", "closed");
    const reconcileTimer = timers.find((t) => t.ms === 30_000 && !t.cleared)!;
    reconcileTimer.fn();
    expect(paneSubs()).toEqual([]);
```

Add after that test:

```ts
  test("a done job's pane stays subscribed and its post-report activity moves the clock, with no room notice (RT-355)", async () => {
    let clock = 1_000;
    const { store, lc, herd, paneSubs, timers, posts } = fx({ now: () => clock });
    store.upsertJob({ herd: herd.id, name: "job-a", worktree: "/w", handle: "job-a", status: "active", pane: "w1:p1" });
    lc.start();
    store.setJobStatus(herd.id, "job-a", "done", { lastReport: 7 });
    timers.find((t) => t.ms === 30_000 && !t.cleared)!.fn();
    expect(paneSubs().map((s) => s.subscriptions[0]!.pane_id)).toEqual(["w1:p1"]);
    clock = 5_000;
    await lc.handleEvent(null, { type: "pane.agent_status_changed", pane_id: "w1:p1", agent_status: "working" });
    clock = 9_000;
    await lc.handleEvent(null, { type: "pane.agent_status_changed", pane_id: "w1:p1", agent_status: "idle" });
    expect(lc.lastStatusChangeMs("w1:p1")).toBe(9_000);
    expect(store.getJob(herd.id, "job-a")!.status).toBe("done");
    expect(timers.filter((t) => t.ms !== 30_000 && !t.cleared)).toEqual([]);
    expect(posts).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/daemon/__tests__/herd-lifecycle.test.ts`
Expected: FAIL. The first test sees only `["w1:p1"]`; the new test sees no subscription after the reconcile tick.

- [ ] **Step 3: Implement**

In `lib/daemon/herd-lifecycle.ts`, below `WATCHED`:

```ts
// A done job's pane stays subscribed: a follow-up round runs in the same
// pane after the report, and the watchdog's quiet clock only sees it through
// lastStatusChange (RT-355). WATCHED stays the set the notices act on.
const SUBSCRIBED: ReadonlySet<string> = new Set([...WATCHED, "done"]);
```

In `reconcilePanes`, change the filter line:

```ts
        if (!job.pane || !SUBSCRIBED.has(job.status)) continue;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/daemon/__tests__/herd-lifecycle.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/herd-lifecycle.ts lib/daemon/__tests__/herd-lifecycle.test.ts
git commit -m "herd lifecycle: keep a done job's pane subscribed so post-report activity counts (RT-355)"
```

---

### Task 2: Background-work sensor in the watchdog adapter

**Files:**
- Modify: `lib/daemon/herd-watchdog.ts` (`WatchdogSensors` interface only)
- Modify: `lib/daemon/herd-watchdog-adapters.ts` (`createWatchdogSensors`, new export `hasBackgroundWork`)
- Test: `lib/daemon/__tests__/herd-watchdog-adapters.test.ts`
- Test: `lib/daemon/__tests__/herd-watchdog.test.ts` (fake gains the new member)

**Interfaces:**
- Produces: `WatchdogSensors.backgroundWork(pane: string): boolean`; `export function hasBackgroundWork(screen: string): boolean` in `herd-watchdog-adapters.ts`.

- [ ] **Step 1: Write the failing tests**

In `herd-watchdog.test.ts`, add `backgroundWork: () => false,` to the `sensors()` fake after `idleSinceMs`.

In `herd-watchdog-adapters.test.ts`:

1. Import `hasBackgroundWork` next to `createWatchdogSensors`.
2. Extend `fx`'s options with `jobs?: HerdJobRow[]; screens?: Record<string, string>`, pass `jobs: () => over.jobs ?? []` in `herdStore`, and answer `pane.read` in the fake herdr before the snapshot branch:

```ts
    if (method === "pane.read") {
      const text = over.screens?.[(_params as { pane_id: string }).pane_id];
      return text === undefined ? { ok: false, code: "pane_not_found", message: "no such pane" } : { ok: true, result: { read: { text } } };
    }
```

3. Add a `job()` helper if the file does not already have one in scope at top level (one exists near line 531; hoist it or add):

```ts
function jobRow(over: Partial<HerdJobRow> = {}): HerdJobRow {
  return {
    herd: "demo-1", name: "job-a", worktree: "/w", branch: null, tree: null,
    pane: "w1:p1", agentSession: "sess-a", agentId: null, handle: "job-a",
    status: "done", disposable: false, lastGate: null, lastReport: 7,
    createdAt: 0, updatedAt: 0, ...over,
  };
}
```

4. Add the captured screens and tests:

```ts
const RULE = "─".repeat(60);
const COMPOSER = ["", RULE, "❯", RULE, "  O 5.5 [high] | claude | W:38% C:16%"];
const SHELL_FOOTER = [...COMPOSER, "  ⏵⏵ auto mode on · 1 shell · ← for agents"].join("\n");
const SHELL_MONITOR_FOOTER = [...COMPOSER, "  ⏵⏵ auto mode on · 1 shell, 1 monitor · ← for agents"].join("\n");
const AGENTS_PANEL = [...COMPOSER, "  ⏵⏵ auto mode on · ← for agents", "", "  ⏺ main", "  ◯ general-purpose  Throwaway footer… 5s · ↓ 49.3k tokens"].join("\n");
const PLAIN_FOOTER = [...COMPOSER, "  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents"].join("\n");
const TRANSCRIPT_MENTION = ["⏺ Started 2 shells and 1 monitor for the CI wait.", ...COMPOSER, "  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents"].join("\n");

describe("hasBackgroundWork", () => {
  test("a shell or monitor count in the footer is background work", () => {
    expect(hasBackgroundWork(SHELL_FOOTER)).toBe(true);
    expect(hasBackgroundWork(SHELL_MONITOR_FOOTER)).toBe(true);
  });
  test("a live agents panel under main is background work", () => {
    expect(hasBackgroundWork(AGENTS_PANEL)).toBe(true);
  });
  test("a plain footer is not", () => {
    expect(hasBackgroundWork(PLAIN_FOOTER)).toBe(false);
  });
  test("counts above the composer's last rule are transcript text, not the footer", () => {
    expect(hasBackgroundWork(TRANSCRIPT_MENTION)).toBe(false);
  });
  test("a screen with no rule at all is not", () => {
    expect(hasBackgroundWork("1 shell")).toBe(false);
  });
});

describe("watchdog sensors: background work", () => {
  const snapshots: Snap = {
    [DEFAULT]: [
      { pane_id: "w1:p1", agent: "claude", agent_status: "idle" },
      { pane_id: "w1:p2", agent: "claude", agent_status: "working" },
      { pane_id: "w1:p3", agent: "claude", agent_status: "idle" },
      { pane_id: "w1:p0", agent: "claude", agent_status: "idle" },
    ],
  };

  test("an idle job pane whose footer shows a shell reads as background work", async () => {
    const { sensors } = fx({ snapshots, jobs: [jobRow()], screens: { "w1:p1": SHELL_FOOTER } });
    await sensors.refresh();
    expect(sensors.backgroundWork("w1:p1")).toBe(true);
  });

  test("only idle job panes are read: working panes and the shepherd pane never are", async () => {
    const { sensors, herdrCalls } = fx({
      snapshots,
      jobs: [jobRow({ name: "a", pane: "w1:p2" }), jobRow({ name: "b", pane: "w1:p3" })],
      screens: { "w1:p0": SHELL_FOOTER, "w1:p2": SHELL_FOOTER, "w1:p3": PLAIN_FOOTER },
    });
    await sensors.refresh();
    expect(herdrCalls.filter((c) => c.method === "pane.read")).toHaveLength(1);
    expect(sensors.backgroundWork("w1:p0")).toBe(false);
    expect(sensors.backgroundWork("w1:p2")).toBe(false);
    expect(sensors.backgroundWork("w1:p3")).toBe(false);
  });

  test("a closed job's pane is not read", async () => {
    const { sensors, herdrCalls } = fx({ snapshots, jobs: [jobRow({ status: "closed" })], screens: { "w1:p1": SHELL_FOOTER } });
    await sensors.refresh();
    expect(herdrCalls.filter((c) => c.method === "pane.read")).toHaveLength(0);
    expect(sensors.backgroundWork("w1:p1")).toBe(false);
  });

  test("a failed read on one pane leaves it not busy and still reads the others", async () => {
    const { sensors } = fx({
      snapshots,
      jobs: [jobRow({ name: "a", pane: "w1:p1" }), jobRow({ name: "b", pane: "w1:p3" })],
      screens: { "w1:p3": SHELL_FOOTER },
    });
    await sensors.refresh();
    expect(sensors.backgroundWork("w1:p1")).toBe(false);
    expect(sensors.backgroundWork("w1:p3")).toBe(true);
  });

  test("the next refresh drops a pane whose background work finished", async () => {
    const screens: Record<string, string> = { "w1:p1": SHELL_FOOTER };
    const { sensors } = fx({ snapshots, jobs: [jobRow()], screens });
    await sensors.refresh();
    expect(sensors.backgroundWork("w1:p1")).toBe(true);
    screens["w1:p1"] = PLAIN_FOOTER;
    await sensors.refresh();
    expect(sensors.backgroundWork("w1:p1")).toBe(false);
  });
});
```

(`fx` must read `over.screens` by reference so the last test's mutation is seen.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/daemon/__tests__/herd-watchdog-adapters.test.ts`
Expected: FAIL (`hasBackgroundWork` is not exported; `backgroundWork` is not a function).

- [ ] **Step 3: Implement**

In `lib/daemon/herd-watchdog.ts`, add to `WatchdogSensors` after `idleSinceMs`:

```ts
  /** True when the pane's last reading showed Claude Code holding a
      background shell, monitor or subagent: a turn that ended to wait on
      one is working, not wedged. Job panes only; never the shepherd's. */
  backgroundWork(pane: string): boolean;
```

In `lib/daemon/herd-watchdog-adapters.ts`, add near the other constants:

```ts
// Claude Code draws its status footer below the composer's bottom rule, so
// only that region is read: a transcript line quoting "1 shell" never counts.
// The agents panel exists only while a subagent is still running.
const RULE_LINE = /^\s*─{10,}\s*$/;
const FOOTER_TASK_COUNT = /\b[1-9]\d* (?:shells?|monitors?)\b/;
const AGENTS_PANEL_MAIN = /^\s*⏺ main\s*$/;

export function hasBackgroundWork(screen: string): boolean {
  const lines = screen.split("\n");
  let rule = -1;
  for (let i = 0; i < lines.length; i++) if (RULE_LINE.test(lines[i]!)) rule = i;
  if (rule < 0) return false;
  const footer = lines.slice(rule + 1);
  if (footer.some((line) => FOOTER_TASK_COUNT.test(line))) return true;
  const main = footer.findIndex((line) => AGENTS_PANEL_MAIN.test(line));
  return main >= 0 && footer.slice(main + 1).some((line) => line.trim().length > 0);
}
```

In `createWatchdogSensors`, add state beside `panes`:

```ts
  let busy = new Set<string>();
```

At the end of `refresh()`, after `panes = next;`:

```ts
    const nextBusy = new Set<string>();
    for (const herd of active) {
      for (const job of deps.herdStore.jobs(herd.id)) {
        if (job.pane === null || job.status === "closed") continue;
        const row = next.get(job.pane);
        if (!row || readingState(row) !== "idle") continue;
        const screen = await deps.herdr<{ read: { text: string } }>("pane.read", { pane_id: parsePaneRef(job.pane).paneId, source: "visible" }, { sockPath: row.socket });
        if (screen.ok && hasBackgroundWork(screen.result.read.text)) nextBusy.add(job.pane);
      }
    }
    busy = nextBusy;
```

and in the returned object, after `idleSinceMs`:

```ts
    backgroundWork: (pane) => busy.has(pane),
```

If any other object in the repo implements `WatchdogSensors` (grep `WatchdogSensors` under `lib/` and `e2e/`), give it `backgroundWork: () => false`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/daemon/__tests__/herd-watchdog-adapters.test.ts lib/daemon/__tests__/herd-watchdog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/herd-watchdog.ts lib/daemon/herd-watchdog-adapters.ts lib/daemon/__tests__/herd-watchdog-adapters.test.ts lib/daemon/__tests__/herd-watchdog.test.ts
git commit -m "herd watchdog: sense background shells, monitors and subagents from the pane footer (RT-355)"
```

---

### Task 3: Background work silences the quiet clocks, and the nag names the follow-up verb

**Files:**
- Modify: `lib/daemon/herd-watchdog.ts` (`openReportAges`, `closeRemedy`, `evaluateJob`)
- Test: `lib/daemon/__tests__/herd-watchdog.test.ts`

**Interfaces:**
- Consumes: `WatchdogSensors.backgroundWork` (Task 2).
- Produces: the nag evidence text now ends `...; if a follow-up round is in flight run rt herd follow-up <job> --herd <herd>, else rt herd close <job> --herd <herd>` (Task 4 adds the verb it names).

- [ ] **Step 1: Write the failing tests**

Replace every occurrence of the old remedy in `herd-watchdog.test.ts`:

```bash
sed -i '' 's/confirm no follow-up round is in flight, then run rt herd close job-a --herd demo-1/if a follow-up round is in flight run rt herd follow-up job-a --herd demo-1, else rt herd close job-a --herd demo-1/g' lib/daemon/__tests__/herd-watchdog.test.ts
```

Then add inside `describe("evaluateJob", ...)`:

```ts
  test("RT-355: a done job waiting on background work is healthy however quiet", () => {
    const s = sensors({ ...idleFor(40), backgroundWork: () => true });
    expect(evaluateJob(job({ status: "done", lastReport: 2758, updatedAt: NOW - 60 * MIN }), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("RT-355: a live job idle past the backstop on background work is healthy", () => {
    const s = sensors({ ...idleFor(20), backgroundWork: () => true });
    expect(evaluateJob(job(), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("RT-355: background work never hides the fast path", () => {
    const dm = sensors({ ...idleFor(3), backgroundWork: () => true, unreadDmMentionsFor: () => 1 });
    expect(evaluateJob(job(), dm, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "idle 3m with 1 unread DM/mention" });
    const answered = sensors({ ...idleFor(3), backgroundWork: () => true, unconsumedAnswered: () => [{ id: "g-1", ageMs: 4 * MIN }] });
    expect(evaluateJob(job(), answered, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "gate g-1 answered 4m ago and unconsumed" });
  });
```

and inside `describe("evaluateShepherd", ...)`:

```ts
  test("RT-355: a done job on background work trips neither the nag nor the shepherd backstop", () => {
    const s = sensors({
      paneState: () => "idle",
      backgroundWork: (p) => p === "w1:p1",
      jobs: () => [job({ status: "done", lastReport: 2758, updatedAt: NOW - 90 * MIN })],
    });
    expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "healthy" });
  });

  test("RT-355: a shepherd's own background work never hides a human gate it left open", () => {
    const s = sensors({ paneState: () => "idle", backgroundWork: () => true, openHumanGates: () => [{ id: "g-9", ageMs: 6 * MIN }] });
    expect(evaluateShepherd(herd(), s, cfg)).toEqual({ kind: "wedged", path: "fast", evidence: "human gate g-9 open 6m unanswered" });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/daemon/__tests__/herd-watchdog.test.ts`
Expected: FAIL on the renamed-remedy tests (old text still produced) and the new background-work tests.

- [ ] **Step 3: Implement**

In `openReportAges`, change the state guard:

```ts
  const state = s.paneState(job.pane);
  if (state === "gone" || state === "working" || s.backgroundWork(job.pane)) return null;
```

and extend its doc comment's last sentence with: `A pane waiting on a background shell, monitor or subagent counts as working too (RT-355).`

Replace `closeRemedy` and its comment:

```ts
// The remedy offers both answers: the watchdog cannot see a follow-up round
// the shepherd dispatched, a bare close killed live jobs twice (RT-205), and
// follow-up is what silences the nag for a round in flight (RT-355).
const closeRemedy = (job: HerdJobRow) =>
  `if a follow-up round is in flight run rt herd follow-up ${job.name} --herd ${job.herd}, else rt herd close ${job.name} --herd ${job.herd}`;
```

In `evaluateJob`, change the backstop line:

```ts
  if (AWAITING_ANSWER.has(job.status) || idleMs < ms(cfg.backstopMins) || s.backgroundWork(job.pane)) return HEALTHY;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/daemon/__tests__/herd-watchdog.test.ts lib/daemon/__tests__/herd-watchdog-adapters.test.ts`
Expected: PASS. Grep the rest of the repo for the old remedy text (`confirm no follow-up round is in flight`) and update any other test or doc asserting it.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/herd-watchdog.ts lib/daemon/__tests__/herd-watchdog.test.ts
git commit -m "herd watchdog: background work silences the quiet clocks; nag names the follow-up verb (RT-355)"
```

---

### Task 4: `herd:follow-up` verb, CLI and MCP tool

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (the `"herd:close"` entry at ~948 and the verb list at ~1105)
- Modify: `packages/rt-client/src/client.ts` (beside `herdClose` at ~654)
- Modify: `packages/rt-client/src/index.ts` (export list at ~72)
- Modify: `lib/daemon/handlers/herd.ts` (beside `"herd:report"` at ~561)
- Modify: `commands/herd.ts` (beside `close` at ~368, import at ~25)
- Modify: `lib/command-tree-def.ts` (herd subtree, beside `close` at ~360)
- Modify: `lib/mcp/herd-tools.ts` (deps at ~17-28, tool beside `herd_close` at ~152, `rt-herd` shell-form note at ~85)
- Test: `lib/daemon/__tests__/herd-handlers.test.ts`, `lib/mcp/__tests__/herd-tools.test.ts`

**Interfaces:**
- Produces: `Commands["herd:follow-up"] = { payload: { herd: string; job: string }; data: { job: string; status: "active" } }`; `herdFollowUp(a, o?)` in rt-client; `followUp(args: string[])` in `commands/herd.ts`; MCP tool `herd_follow_up { job, herd? }`; `HerdToolDeps.followUp: typeof herdFollowUp`.

- [ ] **Step 1: Write the failing tests**

In `herd-handlers.test.ts`, inside `describe("worker verbs", ...)` (it has the `withJob()` helper used by the report tests):

```ts
  test("follow-up flips a done job back to active and keeps its report", async () => {
    const { h, store, herd } = await withJob();
    const reported = await h["herd:report"]({ herd, job: "job-a", body: "done: A1" });
    if (!reported.ok) throw new Error(reported.error);
    const res = await h["herd:follow-up"]({ herd, job: "job-a" });
    expect(res).toEqual({ ok: true, data: { job: "job-a", status: "active" } });
    expect(store.getJob(herd, "job-a")).toMatchObject({ status: "active", lastReport: reported.data.message });
  });

  test("a follow-up round ends at the next report: done again with the new report", async () => {
    const { h, store, herd } = await withJob();
    await h["herd:report"]({ herd, job: "job-a", body: "done: A1" });
    await h["herd:follow-up"]({ herd, job: "job-a" });
    const second = await h["herd:report"]({ herd, job: "job-a", body: "done: follow-up fixes" });
    if (!second.ok) throw new Error(second.error);
    expect(store.getJob(herd, "job-a")).toMatchObject({ status: "done", lastReport: second.data.message });
  });

  test("follow-up refuses a job that is not done, an unknown job and a paneless job", async () => {
    const { h, store, herd } = await withJob();
    const live = await h["herd:follow-up"]({ herd, job: "job-a" });
    expect(live.ok).toBe(false);
    if (!live.ok) expect(live.error).toContain("not done");
    const unknown = await h["herd:follow-up"]({ herd, job: "nope" });
    expect(unknown.ok).toBe(false);
    store.upsertJob({ herd, name: "job-p", worktree: "/w/p", handle: "job-p", status: "done", pane: null });
    const paneless = await h["herd:follow-up"]({ herd, job: "job-p" });
    expect(paneless.ok).toBe(false);
    if (!paneless.ok) expect(paneless.error).toContain("no pane");
    expect(store.getJob(herd, "job-p")!.status).toBe("done");
  });
```

(Check `withJob()` gives job-a a pane and status `active`; if it does not set a pane, upsert `pane: "w9:p1"` first.)

In `lib/mcp/__tests__/herd-tools.test.ts`:
- add `followUp: rec("followUp"),` to `deps` in `fake()`;
- add `"followUp"` to the `destructive()` filter list;
- add `["herd_follow_up", { herd: "hd-1", job: "j" }],` to `SHEPHERD_ONLY`;
- add:

```ts
test("herd_follow_up sends the herd and job to the daemon verb", async () => {
  const { tool, calls } = fake();
  const r = await tool("herd_follow_up").handler({ herd: "hd-1", job: "j" }, SESSION);
  expect(r.ok).toBe(true);
  expect(calls.find((c) => c.fn === "followUp")!.a).toEqual({ herd: "hd-1", job: "j" });
});
```

Update the four `SHEPHERD_ONLY` test titles that list tool names to include `herd_follow_up`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/daemon/__tests__/herd-handlers.test.ts lib/mcp/__tests__/herd-tools.test.ts`
Expected: FAIL (`h["herd:follow-up"]` is not a function; `herd_follow_up` tool not found).

- [ ] **Step 3: Implement rt-client**

`packages/rt-client/src/commands.ts`, after the `"herd:close"` entry:

```ts
  /** Reopens a done job for a follow-up round in its same pane: it goes back to active until its next report. */
  "herd:follow-up": { payload: { herd: string; job: string }; data: { job: string; status: "active" } };
```

and `"herd:follow-up",` after `"herd:close",` in the verb list.

`packages/rt-client/src/client.ts`, after `herdClose`:

```ts
export function herdFollowUp(
  a: Commands["herd:follow-up"]["payload"],
  o: RtClientOptions = {},
): Promise<RtResponse<Commands["herd:follow-up"]["data"]>> {
  return rtCommand<Commands["herd:follow-up"]["data"]>("herd:follow-up", { herd: a.herd, job: a.job }, { sockPath: o.sockPath, timeoutMs: o.timeoutMs ?? 30_000 });
}
```

`packages/rt-client/src/index.ts`: add `herdFollowUp,` after `herdClose,`.

Then: `cd packages/rt-client && bun run build` (from a subshell; return to the repo root after).

- [ ] **Step 4: Implement the handler**

`lib/daemon/handlers/herd.ts`, after `"herd:report"`:

```ts
    "herd:follow-up": async (raw: unknown): Promise<CommandResult<"herd:follow-up">> => {
      const p = raw as Commands["herd:follow-up"]["payload"] | undefined;
      const herdId = str(p?.herd); const name = str(p?.job);
      if (!herdId || !name) return { ok: false, error: "herd and job are required" };
      const herd = store.get(herdId); const job = herd ? store.getJob(herdId, name) : null;
      if (!herd || !job) return { ok: false, error: `unknown job "${name}" in herd "${herdId}"` };
      if (job.status !== "done") return { ok: false, error: `job "${name}" is ${job.status}, not done; only a job that has reported can start a follow-up round` };
      if (!job.pane) return { ok: false, error: `job "${name}" has no pane; a follow-up round runs in the worker's own pane` };
      // Back to active rather than a status of its own: the lifecycle and the
      // watchdog already judge an active job as a live worker, so the done
      // nag stops and the worker backstop becomes the round's quiet limit.
      // setJobStatus leaves lastReport alone; the next report replaces it.
      store.setJobStatus(herdId, name, "active");
      return { ok: true, data: { job: name, status: "active" } };
    },
```

- [ ] **Step 5: Implement the CLI and tree node**

`commands/herd.ts`: add `herdFollowUp` to the rt-client import, and after `close`:

```ts
export async function followUp(args: string[]): Promise<void> {
  const json = has(args, "--json");
  const job = positional(args);
  const herd = flagValue(args, "--herd") ?? process.env.HERD_ID;
  if (!job || !herd) fail("usage: rt herd follow-up <job> --herd <id>");
  const data = unwrap(await herdFollowUp({ herd, job }), "follow-up");
  emit(json, data, `${data.job} is in a follow-up round; it reads as active until its next report`);
}
```

`lib/command-tree-def.ts`, in the herd subtree after `close`:

```ts
  "follow-up": {
    description: "Reopen a done job for a follow-up round: active again until its next report",
    module: "./commands/herd.ts",
    fn: "followUp",
    omitBehavior: { exempt: "agent-facing; the shepherd names the job" },
    args: [
      { name: "Job", type: "text", placeholder: "acme-1483-facts", hint: "Job name" },
      { name: "Herd", flag: "--herd", type: "text", placeholder: "hd-1a2b3c4d", hint: "Herd id (default: HERD_ID)" },
      { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Emit the follow-up record as JSON" },
    ],
  },
```

(`./commands/herd.ts` is already in `lib/module-registry.ts`; no registry change.)

- [ ] **Step 6: Implement the MCP tool**

`lib/mcp/herd-tools.ts`: add `herdFollowUp` to the rt-client import; `followUp: typeof herdFollowUp;` to `HerdToolDeps`; `followUp: herdFollowUp,` to `realHerdToolDeps`; `herd_follow_up` to the `rt-herd` shell-form `note` list after `herd_close`; and after the `herd_close` tool:

```ts
    {
      name: "herd_follow_up",
      description: "Reopen a done job for a follow-up round in its same pane: it goes back to active, which stops the watchdog's done-not-closed nag until the job's next report. Only the herd's shepherd session may call it.",
      inputSchema: { type: "object", properties: { ...HERD_PROP, job: { type: "string" } }, required: ["job"], additionalProperties: false },
      shellForms: ["rt herd follow-up"],
      async handler(input, env) {
        if (env.HERD_JOB) return err(IN_WORKER);
        const bad = checkRequired(input, [{ name: "job", type: "string" }]);
        if (bad) return err(bad);
        const h = await herdFor(input, env);
        if ("error" in h) return err(h.error);
        const owner = await requireShepherd(h.herd, env, deps.status);
        if (owner) return err(owner);
        return fromResponse(await deps.followUp({ herd: h.herd, job: input.job as string }));
      },
    },
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test lib/daemon/__tests__/herd-handlers.test.ts lib/mcp/__tests__/herd-tools.test.ts packages/rt-client/test/dist-freshness.test.ts`
Then: `bun run picker:check` and `bun test lib/__tests__/` (tree, picker-conformance, agent-safe, mcp roster guards).
Expected: PASS. If a roster or command-list test enumerates herd verbs or MCP tool names, add `herd:follow-up` / `herd_follow_up` there.

- [ ] **Step 8: Commit**

```bash
git add packages/rt-client/src lib/daemon/handlers/herd.ts commands/herd.ts lib/command-tree-def.ts lib/mcp/herd-tools.ts lib/daemon/__tests__/herd-handlers.test.ts lib/mcp/__tests__/herd-tools.test.ts
git commit -m "herd: follow-up verb reopens a done job for a follow-up round (RT-355)"
```

---

### Task 5: Escape only onto a pane that holds a form

**Files:**
- Modify: `lib/daemon/gate-escape.ts` (new `createPaneStatusProbe`, `PaneStatusProbe`)
- Modify: `lib/daemon/gate-push.ts` (`createGatePush` opts, `pushToPane`, header comment)
- Modify: `lib/daemon.ts` (the `createGatePush({` block at ~689 and its import at ~122)
- Test: `lib/daemon/__tests__/gate-escape.test.ts`, `lib/daemon/__tests__/gate-push.test.ts`

**Interfaces:**
- Produces: `export type PaneStatusProbe = (hints: PaneHints) => Promise<LivePane["agentStatus"] | null>`; `export function createPaneStatusProbe(deps?: { snapshot?: () => Promise<LivePane[] | null> }): PaneStatusProbe`; `createGatePush` opts gain `paneStatus?: PaneStatusProbe`.

- [ ] **Step 1: Write the failing tests**

`gate-escape.test.ts`: import `createPaneStatusProbe` and add:

```ts
describe("createPaneStatusProbe", () => {
  test("reads the agent status of the pane the hints resolve to", async () => {
    const probe = createPaneStatusProbe({ snapshot: async () => [pane({ paneRef: "wE2:p8", sessionId: "s-1", agentStatus: "idle" })] });
    expect(await probe({ paneId: "wE2:p6", sessionId: "s-1" })).toBe("idle");
  });
  test("null when no herdr server answers or nothing resolves", async () => {
    expect(await createPaneStatusProbe({ snapshot: async () => null })({ paneId: "wE2:p8" })).toBeNull();
    expect(await createPaneStatusProbe({ snapshot: async () => [] })({ paneId: "wE2:p8" })).toBeNull();
  });
});
```

`gate-push.test.ts`:

1. Import `LivePane` type: `import type { LivePane, PaneHints } from "../pane-resolve-live.ts";`.
2. Extend `w4Harness` opts with `paneStatus?: LivePane["agentStatus"] | null | "throw"; withProbe?: boolean; traceProbe?: boolean`, and add to its `createGatePush` call:

```ts
  const probes: PaneHints[] = [];
  const paneStatus = async (hints: PaneHints) => {
    probes.push(hints);
    if (opts.traceProbe) events.push("probe");
    if (opts.paneStatus === "throw") throw new Error("herdr exploded");
    return opts.paneStatus === undefined ? ("blocked" as const) : opts.paneStatus;
  };
  // ...
    ...(opts.withProbe === false ? {} : { paneStatus }),
```

and return `probes` from the harness. Existing W4 tests keep passing because the default reads `blocked`.

3. Add to `describe("gate-push escape injection (W4)", ...)`:

```ts
  test("RT-357: a form gate whose pane sits at an idle prompt gets the doorbell only", async () => {
    for (const status of ["idle", "done", "working", "unknown"] as const) {
      const { push, store, events } = w4Harness({ paneStatus: status });
      await push.onAnswered(answeredFormGate(store, "shepherd"));
      expect(events, status).toEqual(["deliver"]);
    }
  });

  test("the pane is probed before the doorbell, then Escape follows it", async () => {
    const { push, store, events } = w4Harness({ traceProbe: true });
    await push.onAnswered(answeredFormGate(store, "console"));
    expect(events).toEqual(["probe", "deliver", "inject:pane-7"]);
  });

  test("an unreadable pane, a probe that throws, or no probe wired gets the doorbell only", async () => {
    for (const opts of [{ paneStatus: null }, { paneStatus: "throw" as const }, { withProbe: false }]) {
      const { push, store, events } = w4Harness(opts);
      const row = answeredFormGate(store, "console");
      await push.onAnswered(row);
      expect(events, JSON.stringify(opts)).toEqual(["deliver"]);
      expect(store.get(row.id)!.delivery!.outcome).toBe("delivered");
    }
  });

  test("a self-answered or wait gate is never probed", async () => {
    const self = w4Harness();
    await self.push.onAnswered(answeredFormGate(self.store, "pane"));
    expect(self.probes).toEqual([]);
    const wait = w4Harness();
    await wait.push.onAnswered(answeredFormGate(wait.store, "console", { presentation: "wait", paneId: "pane-7" }));
    expect(wait.probes).toEqual([]);
  });

  test("a closed form gate follows the same rule: idle pane doorbell only, blocked pane doorbell then Escape", async () => {
    for (const [status, expected] of [["idle", ["deliver"]], ["blocked", ["deliver", "inject:pane-7"]]] as const) {
      const { push, store, events } = w4Harness({ paneStatus: status });
      const row = store.open({
        subject: "mr:https://gitlab.example.com/x/1", kind: "review-post", questions: qs(),
        nudge: { session: "sess-1" }, pane: "pane-7", origin: { presentation: "form", paneId: "pane-7" },
      }).row;
      store.close(row.id, "abandoned");
      await push.onClosed(store.get(row.id)!);
      expect(events, status).toEqual([...expected]);
    }
  });
```

(Check the gates-store close method name and signature with `grep -n "close(" lib/daemon/gates-store.ts`; use whatever the existing onClosed tests in this file use.)

4. In the wiring test at the end of the file, add: `expect(wiring).toContain("paneStatus: createPaneStatusProbe()");`.

5. Any other `createGatePush` call in this file (or in `gates-e2e.test.ts`, `gate-answer-executor.test.ts`) that passes `injectEscape` and expects an `inject:` event must also pass `paneStatus: async () => "blocked" as const`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/daemon/__tests__/gate-escape.test.ts lib/daemon/__tests__/gate-push.test.ts`
Expected: FAIL (`createPaneStatusProbe` missing; idle pane still gets `inject:pane-7`; wiring test missing `paneStatus`).

- [ ] **Step 3: Implement the probe**

`lib/daemon/gate-escape.ts`, after `createEscapeInjector`:

```ts
export type PaneStatusProbe = (hints: PaneHints) => Promise<LivePane["agentStatus"] | null>;

/** The agent status of the pane the hints resolve to, read from a fresh
    snapshot the same way the injector resolves. Null when no herdr server
    answers or no pane resolves. */
export function createPaneStatusProbe(deps: { snapshot?: () => Promise<LivePane[] | null> } = {}): PaneStatusProbe {
  const snapshot = deps.snapshot ?? snapshotPanes;
  return async (hints) => {
    const panes = await snapshot();
    if (!panes) return null;
    return resolveLivePane(hints, panes)?.agentStatus ?? null;
  };
}
```

- [ ] **Step 4: Implement the gate-push rule**

`lib/daemon/gate-push.ts`: import `type PaneStatusProbe` alongside `EscapeInjector`; add to the `createGatePush` opts after `injectEscape?: EscapeInjector;`:

```ts
  /** Required for any Escape: without it every push is doorbell-only. */
  paneStatus?: PaneStatusProbe;
```

Replace `pushToPane` with:

```ts
  /** Escape exists to dismiss an in-pane form. A herd worker ends its turn
      instead of drawing one, and an Escape sent to an idle prompt interrupts
      the turn the doorbell just started (RT-357), so it needs the pane to
      read blocked. The reading is taken before the doorbell: afterwards an
      idle pane is mid-flip to working and the reading races. */
  async function formOnScreen(row: GateRow): Promise<boolean> {
    if (!opts.injectEscape || !opts.paneStatus || !row.nudge?.session) return false;
    if (row.origin?.presentation !== "form") return false;
    // Same self-answer test as the doorbell: a form the nudged pane answered
    // itself has already dismissed. A foreign surface's `by: "pane"` must not
    // gate this off -- session wins.
    if (answeredByNudgedPane(row)) return false;
    try {
      const status = await opts.paneStatus(gateHints(row));
      if (status !== "blocked") log.debug({ gateId: row.id, status }, "gate-push: no form on screen; doorbell-only");
      return status === "blocked";
    } catch (err) {
      log.warn({ err, gateId: row.id }, "gate-push: pane status probe threw; doorbell-only");
      return false;
    }
  }

  async function pushToPane(row: GateRow, phrase: string): Promise<void> {
    const escape = await formOnScreen(row);
    const { ok } = await pushDoorbell(row, phrase);
    // Escape only ever follows an ACCEPTED doorbell: the dismissed form's
    // next input must be the queued frame, and a dead pane has nothing
    // queued to find.
    if (!ok || !escape || !opts.injectEscape) return;
    const hints = gateHints(row);
    const injected = await opts.injectEscape(hints);
    if (injected.ok) {
      log.debug({ gateId: row.id, paneRef: injected.paneRef }, "gate-push: escape injected");
    } else {
      log.warn({ gateId: row.id, hints, error: injected.error }, "gate-push: escape injection failed; doorbell-only");
    }
  }
```

In the file header, change the "The Escape injection passes ..." paragraph's first sentence to: `The Escape injection fires only when the pane reads blocked (a form on screen) just before the doorbell, and passes \`origin.paneId\` ...` keeping the rest.

- [ ] **Step 5: Wire the probe in the daemon**

`lib/daemon.ts`: change the import to `import { createEscapeInjector, createPaneStatusProbe } from "./daemon/gate-escape.ts";` and in the `createGatePush({` block add after `injectEscape: createEscapeInjector(),`:

```ts
          paneStatus: createPaneStatusProbe(),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test lib/daemon/__tests__/gate-escape.test.ts lib/daemon/__tests__/gate-push.test.ts lib/daemon/__tests__/gates-e2e.test.ts lib/daemon/__tests__/gate-answer-executor.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/daemon/gate-escape.ts lib/daemon/gate-push.ts lib/daemon.ts lib/daemon/__tests__/gate-escape.test.ts lib/daemon/__tests__/gate-push.test.ts
git commit -m "gate-push: press Escape only when the pane holds a form (RT-357)"
```

---

### Task 6: Whole-branch verification

- [ ] **Step 1:** `bun run test` from the repo root. Expected: all green. A failure that also fails on clean `main` is pre-existing; say so with the output.
- [ ] **Step 2:** `bunx tsc --noEmit`. Expected: no errors.
- [ ] **Step 3:** `bash scripts/repo-purity.sh` and `bun run picker:check`. Expected: pass.
- [ ] **Step 4:** Run the e2e files that touch herd or gates: `ls e2e/tests | grep -iE 'herd|gate'`, then `bun test --preload ./e2e/setup.ts <each>`. Expected: pass.
- [ ] **Step 5:** `git diff main --name-only | xargs grep -n "$(printf '\342\200\224\|\342\200\223')"` returns nothing (no em or en dashes).
