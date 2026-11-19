# Herd gates in the shepherd's kit form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A herd worker's gate draws nothing in the worker's pane; the shepherd shows it in its own kit form, identical to what the worker would have drawn.

**Architecture:** The open path (`askGate`) sees `HERD_JOB`, asks the daemon for a `wait` gate, and stores the kit form it would have drawn on the row as `meta.kitForm`. A new shepherd-only MCP tool, `herd_gate_present`, returns that stored form in `gate_ask`'s kit result shape. The gate-form mod takes that tool over like `gate_ask`, queues the form, and records the answer `--by shepherd` without waking its own agent.

**Tech Stack:** Bun, TypeScript, bun:test; Claude Code mods (`claude-code/testing` harness).

**Spec:** `docs/superpowers/specs/2026-11-18-herd-gates-in-shepherd-kit-form-design.md`

## Global Constraints

- Gates outside a herd behave exactly as today (no `HERD_JOB` → no change in any result or row).
- Milestone gates keep the shepherd's own Approve / Revise / Spawn a reviewer handling.
- `rt.gates.kitForm` off → the shepherd keeps AskUserQuestion; the mod draws nothing.
- Every edit under `plugins/mattstack` bumps `.claude-plugin/plugin.json`; any MCP tool change regenerates `plugins/mattstack/attachments/mcp-tools/reference.md` (`bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`).
- Skill edits go through superpowers:writing-skills and mattstack:editing-skills.
- Run tests from the worktree root; locally run only the targeted files.

## Review Focus

1. Several gates presented in one shepherd turn: each queues once, the first stays on screen, answering moves to the next.
2. The same gate presented twice (a repeat push): one form, not two.
3. A relayed gate answered on the board or console while queued: it leaves the queue with the "Answered elsewhere" style note, and nothing wakes the shepherd.
4. A herd worker whose mod is not loaded (no `kitForm` input): still opens `wait`, still stores `meta.kitForm`.
5. A gate-mode auto-answer (`preAnswer`) in a herd: unchanged, answered at open, no stored form needed.

---

### Task 1: Daemon opens a relayed gate as `wait`

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (the `gate:ask` payload type)
- Modify: `lib/daemon/handlers/gate.ts:840`
- Test: `lib/daemon/__tests__/gate-ask-handler.test.ts`

**Interfaces:**
- Produces: `gate:ask` payload field `shepherdRelay?: boolean`. When `true`, presentation is `"wait"` whatever `kitForm`, pane or option count say; `nudge` is not set (as for any wait gate).

- [ ] **Step 1: Write the failing tests**

```ts
test("shepherdRelay opens a gate with a pane and kitForm as wait", async () => {
  // harness with paneId + sessionId, payload { questions: twoOptionQuestion(), kitForm: true, shepherdRelay: true }
  expect(res.data.presentation).toBe("wait");
  expect(row.nudge).toBeFalsy();
});
test("without shepherdRelay the same ask still opens as kit", async () => {
  expect(res.data.presentation).toBe("kit");
});
```

- [ ] **Step 2: Run them to see the first fail**

Run: `bun test lib/daemon/__tests__/gate-ask-handler.test.ts`
Expected: the shepherdRelay test FAILs with presentation `"kit"`.

- [ ] **Step 3: Implement**

Add `shepherdRelay?: boolean` to the payload type; at line 840 treat `payload?.shepherdRelay === true` like `boardOnly || preAnswer` (presentation `"wait"`), and skip the over-cap advisory for it.

- [ ] **Step 4: Run the tests to see them pass**

Run: `bun test lib/daemon/__tests__/gate-ask-handler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/commands.ts lib/daemon/handlers/gate.ts lib/daemon/__tests__/gate-ask-handler.test.ts
git commit -m "gate:ask: shepherdRelay opens a gate as wait"
```

### Task 2: A herd worker's open stores its kit form and waits

**Files:**
- Modify: `lib/mcp/gate-tools.ts` (`askGate`, ~lines 363-445)
- Test: `lib/mcp/__tests__/gate-tools.test.ts`

**Interfaces:**
- Consumes: Task 1's `shepherdRelay`.
- Produces: for a caller with `env.HERD_JOB` non-empty and no `preAnswer`, the row's `meta.kitForm: { questions: GateQuestion[]; context?: string; controls: { pause: boolean; goBack: string[] } }`, the same value a kit result would carry. The tool result has `paneAction: "wait"` and no `kitForm`.
- Produces: `function kitFormOf(questions: GateQuestion[], formContext: string | undefined, controls: { pause: boolean; goBack: string[] }, proseById?: Record<string, string>): KitFormPayload` in `gate-tools.ts`, used by both the stored copy and the existing kit result (lines 437-443), so the two can't drift.

- [ ] **Step 1: Write the failing tests**

```ts
test("a herd worker's gate_ask sends shepherdRelay, not kitForm, and stores the kit form", async () => {
  // env { HERD_JOB: "j", HERDR_ENV: "1", CLAUDE_CODE_SESSION_ID: "s" }, input { questions, context: "Why", kitForm: true }
  expect(asked.shepherdRelay).toBe(true);
  expect(asked.kitForm).toBeUndefined();
  expect(asked.meta.kitForm).toEqual({ questions, context: "Why", controls: { pause: false, goBack: [] } });
  expect(body.paneAction).toBe("wait");
  expect(body.kitForm).toBeUndefined();
});
test("a herd worker without kitForm input still relays and stores the form", ...);
test("a herd worker's gate_open stores the pane-fitted prose, as the kit result would carry it", ...);
test("a herd worker's preAnswered gate stores no kit form", ...);
test("outside a herd, gate_ask's payload and result are unchanged", ...);
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test lib/mcp/__tests__/gate-tools.test.ts`
Expected: the four herd tests FAIL.

- [ ] **Step 3: Implement**

Extract `kitFormOf` from lines 437-443. Compute `formContext` before `deps.ask` (it depends only on `lead`, `extra` and `context`). When `env.HERD_JOB` is non-empty and there is no `preAnswer`: set `payload.shepherdRelay = true`, leave `payload.kitForm` unset, and set `meta.kitForm = kitFormOf(...)`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `bun test lib/mcp/__tests__/gate-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/gate-tools.ts lib/mcp/__tests__/gate-tools.test.ts
git commit -m "gate_ask: a herd worker's gate waits and stores its kit form"
```

### Task 3: `herd_gate_present`

**Files:**
- Modify: `lib/mcp/herd-tools.ts` (next to `herd_gate_answer`, line ~238)
- Modify: `plugins/mattstack/attachments/mcp-tools/reference.md` (regenerated), `plugins/mattstack/.claude-plugin/plugin.json` (version bump)
- Test: `lib/mcp/__tests__/herd-tools.test.ts`

**Interfaces:**
- Consumes: Task 2's `meta.kitForm`; existing `herdGate(herd, id, gates, includeParked)`, `shepherdHerd`, `IN_WORKER`.
- Produces: tool `herd_gate_present { herd?: string; gate: string }`, shepherd only. Result: `{ id, kind, subject, presentation: "kit", paneAction: "kit", boardOnly: false, relay: true, kitForm }`, where `kitForm` is `row.meta.kitForm`, or for a row without one `{ questions: row.questions, context: flattenContext(row.context, { level: "gate" }), controls: { pause: false, goBack: [] } }`. Errors as `herd_gate_answer` for an unknown or closed gate. `shellForms: { none: GATE_NO_CLI_TWIN }`.

- [ ] **Step 1: Write the failing tests**

Add `["herd_gate_present", { herd: "hd-1", gate: "g1" }]` to `SHEPHERD_ONLY` and `"herd_gate_present"` to `NEW_TOOLS` (so the worker, no-session and wrong-shepherd refusals cover it), plus:

```ts
test("herd_gate_present returns the stored kit form as a kit result", async () => {
  // gates fake returns a row with meta.kitForm K
  expect(body).toMatchObject({ id: "g1", paneAction: "kit", relay: true, boardOnly: false, kitForm: K });
});
test("herd_gate_present builds a form for a herd_ask gate with no stored one", ...);
test("herd_gate_present refuses a closed gate", ...);
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test lib/mcp/__tests__/herd-tools.test.ts`
Expected: FAIL, unknown tool `herd_gate_present`.

- [ ] **Step 3: Implement the tool**

Description: "Show one of this herd's open or parked gates to the user in this pane's kit form, exactly as its worker would have. Call it once per gate, then end your turn; the answer is recorded by the shepherd and wakes the worker. Only the herd's shepherd session may call it."

- [ ] **Step 4: Run the tests, regenerate the reference, bump the plugin version**

Run: `bun test lib/mcp/__tests__/herd-tools.test.ts` → PASS. Then the reference command from Global Constraints, and bump the patch version in `plugins/mattstack/.claude-plugin/plugin.json`.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/herd-tools.ts lib/mcp/__tests__/herd-tools.test.ts plugins/mattstack/attachments/mcp-tools/reference.md plugins/mattstack/.claude-plugin/plugin.json
git commit -m "add herd_gate_present: a herd gate's kit form for the shepherd"
```

### Task 4: The mod draws relayed gates and answers as the shepherd

**Files:**
- Modify: `mods/gate-form/types/index.d.ts` (`Form`: add `relay?: true`)
- Modify: `mods/gate-form/src/register.tsx` (`takeGate`, `recordAnswer`, `gateEnded`, tool registrations ~line 604)
- Modify: `mods/gate-form/src/gate/parse.ts` (`gateForm` keeps `relay`), `mods/gate-form/src/gate/reply.ts` (new copy)
- Modify: `mods/gate-form/harness/world.ts` (a `PRESENT` constant and a fake `herd_gate_present` reply)
- Test: `mods/gate-form/harness/gate.test.tsx`
- Regenerate: `plugins/gate-form/hooks/*` via `bun run mods:build`

**Interfaces:**
- Consumes: Task 3's result shape (`relay: true`, `kitForm`).
- Produces: `export const RELAY_INSTRUCTION = (gateId: string) => string` in `reply.ts`: "Gate `<id>` is queued in your kit form. Present any other open gates, then end your turn. The answer is recorded as the shepherd's and wakes its worker; don't wait on it or reconcile it."

- [ ] **Step 1: Write the failing tests**

```ts
const PRESENT = 'mcp__plugin_mattstack_mattstack__herd_gate_present'
test('herd_gate_present opens a relayed form and the agent gets the relay instruction', ...)
  // expect form.relay === true, result text contains "queued in your kit form", no kitForm field
test('three presents in one turn queue three forms, the first on screen', ...)
test('presenting a queued gate again leaves one form for it', ...)
test('a relayed answer runs rt gate answer --by shepherd and submits no prompt', ...)
  // expect the rt call args to contain '--by', 'shepherd'; no prompt.submit
test('answering the first relayed form shows the next one', ...)
test('a relayed gate answered on the board leaves the queue and submits no prompt', ...)
test('with rt.gates.kitForm off, herd_gate_present passes through untouched', ...)
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun run mods:test`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

Register `PRESENT` with `takeGate` beside `gate_ask`/`gate_open`. In `takeGate`, a result with `relay: true` builds the form with `relay: true` and returns `agentFields` with `RELAY_INSTRUCTION` instead of `GATE_INSTRUCTION`; don't add `kitForm: true` to this call's input. In `recordAnswer`, a relay form passes `--by shepherd` and skips `wakeAnswered`. In `gateEnded`, a relay form never wakes (an `end.by === 'shepherd'` from this session counts as its own answer).

- [ ] **Step 4: Run tests, typecheck, rebuild the plugin**

Run: `bun run mods:test && bun run mods:typecheck && bun run mods:build`
Expected: PASS; `plugins/gate-form/hooks/` regenerated.

- [ ] **Step 5: Commit**

```bash
git add mods/gate-form plugins/gate-form
git commit -m "gate-form: draw herd_gate_present forms and answer as the shepherd"
```

### Task 5: The shepherdr skill presents with the kit form

**Files:**
- Modify: `plugins/mattstack/attachments/orchestration/shepherdr/the-watch-loop/present-open-gates.block.md`
- Regenerate: `plugins/mattstack/skills/shepherdr/SKILL.md` (`rt skills compile`, per mattstack:editing-skills)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (bump again if Task 3's bump has merged)

**Interfaces:**
- Consumes: Task 3's tool and Task 4's mod behavior.

- [ ] **Step 1: Load superpowers:writing-skills and mattstack:editing-skills; run the RED baseline they call for** (a shepherd given two open worker gates presents with AskUserQuestion).

- [ ] **Step 2: Edit the block**

With `rt.gates.kitForm` on: for each open gate it isn't answering from its brief and that isn't a milestone, call `herd_gate_present {herd, gate}`, then end the turn; no cap of 4; a push for a gate already presented needs nothing. With it off, today's AskUserQuestion text stays. Milestone gates and the answer-from-brief rule are unchanged.

- [ ] **Step 3: Recompile and check**

Run: `rt skills compile` then `rt skills check --strict`
Expected: clean; `SKILL.md` carries the new block.

- [ ] **Step 4: GREEN run** of the same scenario: the shepherd calls `herd_gate_present` per gate and ends its turn.

- [ ] **Step 5: Commit**

```bash
git add plugins/mattstack
git commit -m "shepherdr: present worker gates in the kit form"
```

Follow-up outside this repo: a team pack's compiled shepherdr picks this block up on its next `rt skills compile` and sync in the org clone.
