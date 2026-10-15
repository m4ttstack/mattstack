# Gate Write-ins and Preselected Proceed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a gate question the asker marks `writeIn: true` be answered with the human's own text instead of a pick (console, board, in-pane form), and open the `next` question with Proceed preselected.

**Architecture:** A new answer wire shape `{ writeIn }` gated by a new `writeIn?: true` question attribute, validated in rt-client (daemon side) and refused at gate open when misused. gate-kit owns the shared rule that turns "no pick + note text" into a write-in and the Proceed preset, so the console and board build one wire shape. Answered views render the write-in; the gate-protocol skill tells agents when to set the attribute and to always re-gate after acting on a write-in.

**Tech Stack:** Bun + TypeScript (rt-client, daemon, MCP), React (console on Mantine via app-kit, vitest; board on tui-kit, bun test + happy-dom), Markdown skills (mattstack plugin).

**Spec:** `docs/superpowers/specs/2026-10-15-gate-write-ins-design.md`

## Global Constraints

- `writeIn` on a question is optional and, when present, exactly `true`. Absent means today's behaviour, unchanged.
- An answer `{ "writeIn": "<text>" }` stands alone: no `value`, `note` or `text` beside it; trimmed text is non-empty.
- Pinned daemon error strings, verbatim:
  - `question <id> does not accept a write-in`
  - `question <id> writeIn must be a non-empty string`
  - `question <id> writeIn replaces value, note and text; send it alone`
  - `question <id> writeIn must be true when set` (gate open)
  - `question <id> writeIn needs options` (gate open)
- `unwrapGateAnswerValue` returns `undefined` for a write-in.
- Proceed preselection: only a single-select question with id `next` that has an option whose value is `proceed`; only when no draft was restored; never saved as a draft by itself.
- Review-post, respond, doctor and pane-attention questions never set `writeIn`; their sheets and wrapper skills do not change.
- Run `bun test` from the repo root (bunfig preload). Run only the targeted tests named in each task; CI runs the full suites.
- Any file under `plugins/mattstack` changes with a `plugins/mattstack/.claude-plugin/plugin.json` patch bump (once for the branch).
- Skill text is written through `superpowers:writing-skills` (RED/GREEN) and `mattstack:editing-skills`.
- No employer or internal ticket names in any file, commit or PR text; run `bash scripts/repo-purity.sh` before pushing.
- Commit after every task; commit messages are short and imperative, ending with the `Co-Authored-By` trailer the session supplies.

## Review Focus

1. A write-in typed on a plain (non-`writeIn`) question must never be sent as a write-in: Next stays disabled on a single-select, and a multi still sends `{ value: [], note }`. Pinned in Task 4 (builder) and Task 6 (console).
2. A gate opened while the board is running must keep `writeIn` through the live `gate/opened` cache path. Pinned in Task 5.
3. Proceed preselection must not resurrect itself over a restored draft, and must not show "Draft saved" on a fresh open. Pinned in Task 6.
4. A write-in answer reaching a consumer that only reads values (`run-outcome-refresher`, pane-attention routing, respond-join) must fall through, never read the text as an option. Pinned in Task 1 (`unwrapGateAnswerValue`) and Task 2 (pane-attention refusal via the attribute rule).
5. Clicking the selected option on a `writeIn` single-select must clear it, and clicking an unselected option must still pick it (Mantine's RadioCard calls `onClick` before `onChange`). Pinned in Task 6 and Task 8.

---

## Before starting

Work in an rt worktree (EnterWorktree name-mode, name `gate-write-ins`), branched from current `main`. Read the spec end to end first.

---

### Task 1: rt-client wire contract

**Files:**
- Modify: `packages/rt-client/src/commands.ts:180` (`GateQuestion`), `:194` (`GateAnswer`)
- Modify: `packages/rt-client/src/gate-answers.ts`
- Test: `packages/rt-client/test/gate-answers.test.ts`
- Rebuild: `packages/rt-client/dist/` (`bun run build` in `packages/rt-client`)

**Interfaces:**
- Produces: `GateQuestion.writeIn?: true`; `type GateWriteIn = { writeIn: string }` (exported from `commands.ts`); `GateAnswer['answers'][string]` gains `GateWriteIn`; `isWriteIn(raw: unknown): raw is GateWriteIn` (exported from `gate-answers.ts`, so from `@mattstack/rt-client/gate`); `unwrapGateAnswerValue` returns `undefined` for a write-in.

- [ ] **Step 1: Write the failing tests**

Append to `packages/rt-client/test/gate-answers.test.ts`:

```ts
const open: GateQuestion = { id: "approach", label: "a", multi: false, options: ["x", "y"], writeIn: true };
const openMulti: GateQuestion = { id: "picks", label: "p", multi: true, options: ["a", "b"], writeIn: true };

describe("write-ins", () => {
  test("isWriteIn spots the shape and nothing else", () => {
    expect(isWriteIn({ writeIn: "do z" })).toBe(true);
    expect(isWriteIn({ value: "x" })).toBe(false);
    expect(isWriteIn("x")).toBe(false);
    expect(isWriteIn(["x"])).toBe(false);
  });
  test("unwrapGateAnswerValue gives undefined for a write-in", () => {
    expect(unwrapGateAnswerValue({ writeIn: "do z" })).toBeUndefined();
  });
  test("accepted on a writeIn single-select and multi", () => {
    expect(validateGateAnswers([open, openMulti], { approach: { writeIn: "do z" }, picks: { writeIn: "neither" } })).toBeNull();
  });
  test("refused on a question without the attribute", () => {
    expect(validateGateAnswers([single], { verdict: { writeIn: "maybe" } })).toBe("question verdict does not accept a write-in");
  });
  test("refused beside value, note or text", () => {
    const alone = "question approach writeIn replaces value, note and text; send it alone";
    expect(validateGateAnswers([open], { approach: { writeIn: "z", value: "x" } })).toBe(alone);
    expect(validateGateAnswers([open], { approach: { writeIn: "z", note: "n" } })).toBe(alone);
    expect(validateGateAnswers([open], { approach: { writeIn: "z", text: "t" } })).toBe(alone);
  });
  test("refused when empty, whitespace or not a string", () => {
    const empty = "question approach writeIn must be a non-empty string";
    expect(validateGateAnswers([open], { approach: { writeIn: "" } })).toBe(empty);
    expect(validateGateAnswers([open], { approach: { writeIn: "   " } })).toBe(empty);
    expect(validateGateAnswers([open], { approach: { writeIn: 3 } })).toBe(empty);
  });
  test("a writeIn question still takes an ordinary pick", () => {
    expect(validateGateAnswers([open], { approach: "x" })).toBeNull();
    expect(validateGateAnswers([open], { approach: "nope" })).toBe('answer for "approach" is not one of its options: "nope"');
  });
});
```

Update the file's import line to:

```ts
import { isWriteIn, unwrapGateAnswerValue, validateGateAnswers } from "../src/gate-answers.ts";
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test packages/rt-client/test/gate-answers.test.ts`
Expected: FAIL (`isWriteIn` is not exported; type error on `writeIn` in `GateQuestion`).

- [ ] **Step 3: Implement**

In `packages/rt-client/src/commands.ts`, replace the `GateQuestion` line with:

```ts
/** `writeIn: true` lets this question be answered `{ writeIn }`, the
    human's own words, instead of one of its options. */
export interface GateQuestion { id: string; label: string; multi: boolean; options: GateOption[]; context?: string; writeIn?: true }
export type GateWriteIn = { writeIn: string };
```

and in `GateAnswer`, change the answers value type to:

```ts
answers: Record<string, string | string[] | { value: string | string[]; note?: string; text?: string } | GateWriteIn>;
```

In `packages/rt-client/src/gate-answers.ts`:

```ts
import type { GateQuestion, GateAnswer, GateWriteIn } from "./commands.ts";

export function isWriteIn(raw: unknown): raw is GateWriteIn {
  return !!raw && typeof raw === "object" && !Array.isArray(raw) && "writeIn" in (raw as Record<string, unknown>);
}
```

Make `unwrapGateAnswerValue` start with `if (isWriteIn(raw)) return undefined;`.

Add:

```ts
function writeInError(question: GateQuestion, raw: GateWriteIn): string | null {
  const qid = question.id;
  if (question.writeIn !== true) return `question ${qid} does not accept a write-in`;
  if (Object.keys(raw).some((k) => k !== "writeIn")) return `question ${qid} writeIn replaces value, note and text; send it alone`;
  const text: unknown = raw.writeIn;
  if (typeof text !== "string" || text.trim() === "") return `question ${qid} writeIn must be a non-empty string`;
  return null;
}
```

In `validateGateAnswers`, right after `if (!question) return ...`, add:

```ts
    if (isWriteIn(raw)) {
      const error = writeInError(question, raw);
      if (error) return error;
      continue;
    }
```

Extend the function's doc comment with one sentence: a question marked `writeIn` may instead carry `{writeIn}`, checked by `writeInError`.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test packages/rt-client/test/gate-answers.test.ts`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Rebuild dist and check freshness**

Run: `cd packages/rt-client && bun run build && cd ../..` then `bun test packages/rt-client/test/dist-freshness.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/rt-client
git commit -m "rt-client: gate questions can take a writeIn answer"
```

---

### Task 2: Daemon refuses a misused attribute at gate open

**Files:**
- Modify: `lib/daemon/handlers/gate.ts` (`gate:open`, after the duplicate-id check near line 474)
- Test: `lib/daemon/__tests__/gates-handlers.test.ts`

**Interfaces:**
- Consumes: `GateQuestion.writeIn` (Task 1), `validateGateAnswers` (Task 1, already called by `gate:answer`).
- Produces: `gate:open` (and so `gate:ask`, which delegates to it) refuses `writeIn` that is not `true` or sits on a zero-option question.

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe` that holds the "rejects duplicate question ids" test:

```ts
  test("refuses a writeIn that is not true", async () => {
    const { handlers } = harness();
    const r = await handlers["gate:open"]({
      subject: "run:r1", kind: "plan",
      questions: [{ id: "q", label: "Pick", multi: false, options: ["a", "b"], writeIn: "yes" }],
    });
    expect(r).toEqual({ ok: false, error: "question q writeIn must be true when set" });
  });

  test("refuses writeIn on a question with no options", async () => {
    const { handlers } = harness();
    const r = await handlers["gate:open"]({
      subject: "run:r1", kind: "plan",
      questions: [{ id: "q", label: "Say", multi: false, options: [], writeIn: true }],
    });
    expect(r).toEqual({ ok: false, error: "question q writeIn needs options" });
  });

  test("a writeIn question survives storage and takes a write-in answer", async () => {
    const { handlers, store } = harness();
    const opened = await handlers["gate:open"]({
      subject: "run:r1", kind: "plan",
      questions: [{ id: "q", label: "Pick", multi: false, options: ["a", "b"], writeIn: true }],
    });
    if (!opened.ok) throw new Error(opened.error);
    expect(store.get(opened.data.id)?.questions[0]?.writeIn).toBe(true);
    const answered = await handlers["gate:answer"]({ id: opened.data.id, answers: { q: { writeIn: "neither" } }, by: "console" });
    expect(answered.ok).toBe(true);
  });

  test("a write-in on a question without the attribute is refused at answer time", async () => {
    const { handlers } = harness();
    const opened = await handlers["gate:open"]({ subject: "run:r1", kind: "plan", questions: qs() });
    if (!opened.ok) throw new Error(opened.error);
    const r = await handlers["gate:answer"]({ id: opened.data.id, answers: { q: { writeIn: "neither" } }, by: "console" });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("does not accept a write-in");
  });
```

If `store.get` is not the store's read-by-id method, use the one the file's other tests use to read a row back (search the file for `store.` reads).

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/gates-handlers.test.ts -t "writeIn"`
Expected: the first two FAIL (open succeeds); the others may already pass.

- [ ] **Step 3: Implement**

In `lib/daemon/handlers/gate.ts`, near `oversizedOptionText`:

```ts
function writeInQuestionError(questions: GateQuestion[]): string | null {
  for (const q of questions) {
    const flag: unknown = (q as { writeIn?: unknown }).writeIn;
    if (flag === undefined) continue;
    if (flag !== true) return `question ${q.id} writeIn must be true when set`;
    if (q.options.length === 0) return `question ${q.id} writeIn needs options`;
  }
  return null;
}
```

In `gate:open`, directly after the `duplicate question id` check:

```ts
      const writeInError = writeInQuestionError(questions);
      if (writeInError) return { ok: false as const, error: writeInError };
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test lib/daemon/__tests__/gates-handlers.test.ts lib/daemon/__tests__/gate-ask-handler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/gate.ts lib/daemon/__tests__/gates-handlers.test.ts
git commit -m "daemon: refuse a misused writeIn at gate open"
```

---

### Task 3: MCP schemas and descriptions

**Files:**
- Modify: `lib/mcp/tools.ts` (`ANSWER_VALUE_SCHEMA` ~line 113, `GATE_QUESTION_SCHEMA` ~line 147, `gate_answer` description ~line 164, `gate_ask` description ~line 232)
- Test: `lib/mcp/__tests__/tools.test.ts`
- Regenerate: `plugins/mattstack/attachments/mcp-tools/reference.md`
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (patch bump, once for the branch)

**Interfaces:**
- Consumes: the wire shape from Task 1.
- Produces: `gate_ask` accepts `writeIn: true` per question; `gate_answer` accepts `{ writeIn }`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/mcp/__tests__/tools.test.ts` next to the "object answer form accepts text beside note" test:

```ts
  test("gate_answer accepts a write-in object, alone", () => {
    const tool = mcpTools().find((t) => t.name === "gate_answer")!;
    const schema = tool.inputSchema as {
      properties: { answers: { additionalProperties: { oneOf: Array<{ type: string; required?: string[]; properties?: Record<string, unknown>; additionalProperties?: boolean }> } } };
    };
    const writeIn = schema.properties.answers.additionalProperties.oneOf.find((b) => b.required?.includes("writeIn"))!;
    expect(Object.keys(writeIn.properties!)).toEqual(["writeIn"]);
    expect(writeIn.additionalProperties).toBe(false);
    expect(writeIn.properties!.writeIn).toMatchObject({ type: "string", pattern: "\\S" });
    expect(tool.description).toContain("{writeIn");
  });

  test("gate_ask questions may carry writeIn: true", () => {
    const tool = mcpTools().find((t) => t.name === "gate_ask")!;
    const q = (tool.inputSchema as { properties: { questions: { items: { properties: Record<string, unknown> } } } }).properties.questions.items;
    expect(q.properties.writeIn).toMatchObject({ type: "boolean", enum: [true] });
    expect(tool.description).toContain("writeIn");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/mcp/__tests__/tools.test.ts -t "write"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add a fourth branch at the END of `ANSWER_VALUE_SCHEMA.oneOf` (after the `{value, note, text}` object, so the existing test that finds the first object branch still reads that one):

```ts
    {
      type: "object",
      properties: {
        writeIn: { type: "string", pattern: "\\S", description: "The human's own answer, for a question opened with writeIn: true. Sent alone, never beside value, note or text." },
      },
      required: ["writeIn"],
      additionalProperties: false,
    },
```

Add to `GATE_QUESTION_SCHEMA.properties`:

```ts
    writeIn: { type: "boolean", enum: [true], description: "Lets the human answer this question in their own words instead of a pick; the answer then arrives as {writeIn}. Set it only on a decision question whose free-text answer you can act on, never on next." },
```

`gate_answer` description: replace its first sentence's tail so it reads:
`"Answer an open gate's questions as this pane. Answer values must be option VALUES verbatim; nuance goes in {value, note}, and replacement text for something the gate offered goes in {value, text}. A question opened with writeIn: true may instead take {writeIn: \"<the human's own words>\"}, sent alone."`

`gate_ask` description: replace the final sentence `Answers must be option VALUES verbatim.` with
`Answers must be option VALUES verbatim, except that a question opened with writeIn: true may be answered {writeIn} with the human's own words.`

- [ ] **Step 4: Run to verify they pass**

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the reference and bump the plugin**

Run: `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`
Then bump the patch version in `plugins/mattstack/.claude-plugin/plugin.json` (for example `0.31.3` to `0.31.4`; use the next patch after whatever main carries).

- [ ] **Step 6: Commit**

```bash
git add lib/mcp plugins/mattstack/attachments/mcp-tools/reference.md plugins/mattstack/.claude-plugin/plugin.json
git commit -m "mcp: gate_ask and gate_answer carry writeIn"
```

---

### Task 4: gate-kit builders, preset and summary

**Files:**
- Modify: `packages/gate-kit/src/payload.ts`
- Create: `packages/gate-kit/src/preset.ts`
- Modify: `packages/gate-kit/src/index.ts` (exports)
- Modify: `packages/gate-kit/src/react/index.ts` (`GateItemDisplay`, `gateItems`, `answersFromForm`)
- Modify: `packages/gate-kit/src/summary.ts`
- Test: `packages/gate-kit/test/payload.test.ts`, `packages/gate-kit/test/preset.test.ts` (new), `packages/gate-kit/test/react.test.tsx`, `packages/gate-kit/test/summary.test.ts`

**Interfaces:**
- Consumes: `isWriteIn`, `GateWriteIn` from `@mattstack/rt-client/gate` (Task 1).
- Produces:
  - `UnwrappedGateAnswer { value?: string | string[]; note?: string; text?: string; writeIn?: string }`
  - `writeIns(questions: GateQuestion[], selections: GateSelections, notes: Record<string, string>): Record<string, string>`
  - `gateAnswerPayload(questions, selections, written: Record<string, string> = {})`: skips ids in `written`
  - `presetSelections(questions: GateQuestion[]): GateSelections`, `withoutPreset(selections: GateSelections, preset: GateSelections): GateSelections`, `NEXT_QUESTION_ID = 'next'`, `PROCEED_VALUE = 'proceed'`
  - `GateItemDisplay.writeIn?: true`
  - `answersFromForm` emits `{ writeIn }` for a `writeIn` question with no pick and note text

- [ ] **Step 1: Write the failing tests**

`packages/gate-kit/test/payload.test.ts`, append:

```ts
import { writeIns } from '@mattstack/gate-kit';

const OPEN_Q = { id: 'approach', label: 'A', multi: false, options: ['x', 'y'], writeIn: true as const };
const PLAIN_Q = { id: 'scope', label: 'S', multi: false, options: ['a', 'b'] };
const OPEN_MULTI = { id: 'picks', label: 'P', multi: true, options: ['a', 'b'], writeIn: true as const };

test('unwrapGateAnswer reads a write-in with no value', () => {
  expect(unwrapGateAnswer({ writeIn: 'do z' })).toEqual({ writeIn: 'do z' });
});

test('writeIns: a writeIn question with no pick and note text answers with the trimmed text', () => {
  expect(writeIns([OPEN_Q, OPEN_MULTI], {}, { approach: '  do z ', picks: 'neither' })).toEqual({ approach: 'do z', picks: 'neither' });
});

test('writeIns: a pick, a blank note or a plain question is never a write-in', () => {
  expect(writeIns([OPEN_Q], { approach: 'x' }, { approach: 'because' })).toEqual({});
  expect(writeIns([OPEN_Q], {}, { approach: '   ' })).toEqual({});
  expect(writeIns([OPEN_MULTI], { picks: ['a'] }, { picks: 'also' })).toEqual({});
  expect(writeIns([PLAIN_Q], {}, { scope: 'mine' })).toEqual({});
});

test('gateAnswerPayload skips a written-in question instead of refusing the form', () => {
  expect(gateAnswerPayload([OPEN_Q, PLAIN_Q], { scope: 'a' }, { approach: 'do z' })).toEqual({ answers: { scope: 'a' } });
  expect(gateAnswerPayload([OPEN_Q, PLAIN_Q], { scope: 'a' })).toBeNull();
});
```

`packages/gate-kit/test/preset.test.ts` (new):

```ts
import { expect, test } from 'vitest';

import { presetSelections, withoutPreset } from '@mattstack/gate-kit';

const NEXT = { id: 'next', label: 'Then?', multi: false, options: ['proceed', 'iterate', 'hold'] };

test('Proceed is preset on a single-select next that offers it', () => {
  expect(presetSelections([NEXT])).toEqual({ next: 'proceed' });
  expect(presetSelections([{ ...NEXT, options: [{ value: 'proceed', label: 'Proceed (Recommended)' }, 'hold'] }])).toEqual({ next: 'proceed' });
});

test('nothing is preset without a next question, without proceed, or on a multi', () => {
  expect(presetSelections([{ ...NEXT, id: 'action' }])).toEqual({});
  expect(presetSelections([{ ...NEXT, options: ['done', 'hold'] }])).toEqual({});
  expect(presetSelections([{ ...NEXT, multi: true }])).toEqual({});
});

test('withoutPreset drops only picks still equal to the preset', () => {
  expect(withoutPreset({ next: 'proceed', tier: 'a' }, { next: 'proceed' })).toEqual({ tier: 'a' });
  expect(withoutPreset({ next: 'hold' }, { next: 'proceed' })).toEqual({ next: 'hold' });
});
```

`packages/gate-kit/test/react.test.tsx`, inside `describe('gateItems', ...)`:

```ts
  test('a writeIn question carries the flag onto its display item', () => {
    const { display } = gateItems(
      { kind: 'plan', questions: [{ id: 'approach', label: 'A', multi: false, options: ['x'], writeIn: true }, { id: 'scope', label: 'S', multi: false, options: ['a'] }] },
      {}
    );
    expect(display.map(d => d.writeIn)).toEqual([true, undefined]);
  });
```

and inside `describe('answersFromForm', ...)`:

```ts
  test('a writeIn question with no pick and a note answers { writeIn }; a plain question still refuses', () => {
    const gate: GateForItems = {
      kind: 'plan',
      questions: [
        { id: 'approach', label: 'A', multi: false, options: ['x', 'y'], writeIn: true },
        { id: 'scope', label: 'S', multi: false, options: ['a', 'b'] },
      ],
    };
    const form = new FormData();
    form.set(noteFieldName('approach'), '  split it ');
    form.set('scope', 'a');
    expect(answersFromForm(gate, form)).toEqual({ answers: { approach: { writeIn: 'split it' }, scope: 'a' } });

    const plain = new FormData();
    plain.set(noteFieldName('scope'), 'mine');
    plain.set(noteFieldName('approach'), 'split it');
    expect(answersFromForm(gate, plain)).toBeNull();
  });

  test('a pick plus a note on a writeIn question is still { value, note }', () => {
    const gate: GateForItems = { kind: 'plan', questions: [{ id: 'approach', label: 'A', multi: false, options: ['x'], writeIn: true }] };
    const form = new FormData();
    form.set('approach', 'x');
    form.set(noteFieldName('approach'), 'because');
    expect(answersFromForm(gate, form)).toEqual({ answers: { approach: { value: 'x', note: 'because' } } });
  });
```

`packages/gate-kit/test/summary.test.ts`, inside `describe('answeredGateSummary detail', ...)` and `describe('answeredGateSummary chip', ...)` respectively (reuse the file's row builder; if it has none, build the row inline with the fields the neighbouring tests set):

```ts
  test('a write-in shows as wrote in, in the detail row', () => {
    const s = answeredGateSummary({
      kind: 'plan', status: 'answered', subject: 'run:abcdef123456',
      questions: [{ id: 'approach', label: 'Which approach?', multi: false, options: ['x', 'y'], writeIn: true }],
      answer: { answers: { approach: { writeIn: 'split it' } }, by: 'console', answeredAt: 1 },
    } as never);
    expect(s.detail[0]!.answers).toEqual([{ text: 'wrote in: "split it"' }]);
  });

  test('a write-in shows as wrote in, in the chip', () => {
    const s = answeredGateSummary({
      kind: 'plan', status: 'answered', subject: 'run:abcdef123456',
      questions: [{ id: 'approach', label: 'Which approach?', multi: false, options: ['x', 'y'], writeIn: true }],
      answer: { answers: { approach: { writeIn: 'split it' } }, by: 'pane', answeredAt: 1 },
    } as never);
    expect(s.chip).toContain('wrote in: "split it"');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/gate-kit && bunx vitest run; cd ../..`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement payload.ts**

```ts
import {
  isWriteIn,
  unwrapGateAnswerValue,
  type GateAnswer,
} from '@mattstack/rt-client/gate';
```

Replace `gateAnswerPayload` with the same body plus a `written` parameter:

```ts
export function gateAnswerPayload(
  questions: GateQuestion[],
  selections: GateSelections,
  written: Record<string, string> = {}
): { answers: GateSelections } | null {
  const answers: GateSelections = {};
  for (const q of questions) {
    if (q.options.length === 0 || q.id in written) continue;
    const value = selections[q.id];
    if (q.multi) {
      if (!Array.isArray(value)) return null;
      answers[q.id] = value;
    } else {
      if (typeof value !== 'string' || value.length === 0) return null;
      answers[q.id] = value;
    }
  }
  return { answers };
}
```

Add one sentence to its doc comment: a question named in `written` is left to the caller, which sends it as `{ writeIn }`.

Add:

```ts
/** A `writeIn` question with no pick and non-blank note text is answered
    by that text; returns the trimmed text keyed by question id. */
export function writeIns(
  questions: GateQuestion[],
  selections: GateSelections,
  notes: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    if (q.writeIn !== true || q.options.length === 0) continue;
    const pick = selections[q.id];
    const picked = Array.isArray(pick)
      ? pick.length > 0
      : typeof pick === 'string' && pick.length > 0;
    const text = (notes[q.id] ?? '').trim();
    if (!picked && text) out[q.id] = text;
  }
  return out;
}
```

Update `UnwrappedGateAnswer` to `value?: string | string[]` and add `writeIn?: string`. Make `unwrapGateAnswer` begin with `if (isWriteIn(raw)) return { writeIn: raw.writeIn };`.

- [ ] **Step 4: Implement preset.ts**

```ts
import { optionValue } from './options';
import type { GateSelections } from './payload';
import type { GateQuestion } from './types';

export const NEXT_QUESTION_ID = 'next';
export const PROCEED_VALUE = 'proceed';

/** The picks a fresh form opens with: Proceed on a single-select `next`
    that offers it, nothing else. */
export function presetSelections(questions: GateQuestion[]): GateSelections {
  const next = questions.find(q => q.id === NEXT_QUESTION_ID && !q.multi);
  return next?.options.some(o => optionValue(o) === PROCEED_VALUE)
    ? { [NEXT_QUESTION_ID]: PROCEED_VALUE }
    : {};
}

/** `selections` minus every pick still equal to its preset, so an untouched
    preset never counts as a draft. */
export function withoutPreset(
  selections: GateSelections,
  preset: GateSelections
): GateSelections {
  const out: GateSelections = {};
  for (const [id, v] of Object.entries(selections))
    if (preset[id] !== v) out[id] = v;
  return out;
}
```

In `packages/gate-kit/src/index.ts`, change the payload export line to `export { gateAnswerPayload, unwrapGateAnswer, writeIns } from './payload';` (keep any type exports beside it) and add:

```ts
export {
  NEXT_QUESTION_ID,
  presetSelections,
  PROCEED_VALUE,
  withoutPreset,
} from './preset';
```

- [ ] **Step 5: Implement react/index.ts**

Add to `GateItemDisplay`:

```ts
  /** Note text with no pick answers this question as `{ writeIn }`. */
  writeIn?: true;
```

In `gateItems`'s display map, after the `context` spread: `...(q.writeIn === true ? { writeIn: true as const } : {}),`.

Rewrite the `gateItems` doc comment's single-select sentence to: "Single-selects are required: answered by a pick from the question's own set or, on a question marked `writeIn`, by note text instead (`writeIns`); a multi question is skippable, ..." (keep the rest).

Replace the body of `answersFromForm` after `selections` is built:

```ts
  const notes: Record<string, string> = {};
  for (const q of gate.questions) {
    const raw = formData.get(noteFieldName(q.id));
    if (typeof raw === 'string') notes[q.id] = raw;
  }
  const written = writeIns(gate.questions, selections, notes);
  const payload = gateAnswerPayload(
    gate.questions,
    effectiveSelections(gate.kind, gate.questions, selections),
    written
  );
  if (!payload) return null;
  const answers: GateAnswers = {};
  for (const [id, value] of Object.entries(payload.answers)) {
    const note = id in selections ? (notes[id] ?? '').trim() : '';
    answers[id] = note.length > 0 ? { value, note } : value;
  }
  for (const [id, text] of Object.entries(written))
    answers[id] = { writeIn: text };
  return { answers };
```

Import `writeIns` from `'../payload'` beside `gateAnswerPayload`. Add one sentence to the doc comment: a `writeIn` question with no pick and note text submits `{ writeIn }`.

- [ ] **Step 6: Implement summary.ts**

In the detail map (around line 222):

```ts
    const unwrapped = raw !== undefined ? unwrapGateAnswer(raw) : null;
    const value = unwrapped?.value;
    const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
    return {
      id: q.id,
      question: q.label,
      answers:
        unwrapped?.writeIn !== undefined
          ? [{ text: `wrote in: "${unwrapped.writeIn}"` }]
          : values.length > 0
            ? values.map(v => displayForValue(v, q.options))
            : [{ text: '(none)' }],
      ...
```

In the chip loop (around line 265), replace `const { value } = unwrapGateAnswer(raw);` with:

```ts
      const unwrapped = unwrapGateAnswer(raw);
      if (unwrapped.writeIn !== undefined) {
        fragments.push(`wrote in: "${unwrapped.writeIn}"`);
        continue;
      }
      const value = unwrapped.value ?? [];
```

At line ~156 change `const value = unwrapped === null ? [] : unwrapped.value;` to `const value = unwrapped?.value ?? [];`.

- [ ] **Step 7: Run to verify they pass**

Run the gate-kit tests (same command as Step 2) and `bunx tsc --noEmit -p packages/gate-kit`.
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/gate-kit
git commit -m "gate-kit: write-in builder rule, Proceed preset, wrote-in summary"
```

---

### Task 5: Board gate cache keeps the attribute

**Files:**
- Modify: `apps/board/src/gates/cache.ts:44-50` (`sanitizeQuestions`)
- Test: `apps/board/src/__tests__/gates-cache.test.ts`

**Interfaces:**
- Consumes: `GateQuestion.writeIn` (Task 1, via gate-kit's type).
- Produces: live `gate/opened` rows keep `writeIn: true`.

- [ ] **Step 1: Write the failing test**

In `describe('GateCache.applyEvent', ...)`:

```ts
  test('opened frame keeps writeIn on a question', () => {
    const cache = new GateCache();
    cache.applyEvent({
      topic: 'gate/opened/gate-9',
      payload: {
        id: 'gate-9',
        subject: SUBJECT_A,
        kind: 'plan',
        questions: [
          { id: 'approach', label: 'Which?', multi: false, options: ['x', 'y'], writeIn: true },
          { id: 'next', label: 'Then?', multi: false, options: ['proceed', 'hold'] },
        ],
        meta: null,
      },
    });
    expect(cache.get(SUBJECT_A, 'plan')?.questions).toEqual([
      { id: 'approach', label: 'Which?', multi: false, options: ['x', 'y'], writeIn: true },
      { id: 'next', label: 'Then?', multi: false, options: ['proceed', 'hold'] },
    ]);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/board && bun test src/__tests__/gates-cache.test.ts -t writeIn; cd ../..` (board suites run from the app dir)
Expected: FAIL (`writeIn` missing).

- [ ] **Step 3: Implement**

In `sanitizeQuestions`, after the `context` spread:

```ts
        ...(q.writeIn === true ? { writeIn: true as const } : {}),
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/board && bun test src/__tests__/gates-cache.test.ts; cd ../..`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/gates/cache.ts apps/board/src/__tests__/gates-cache.test.ts
git commit -m "board: live gate frames keep writeIn"
```

---

### Task 6: Console gate panel

**Files:**
- Modify: `apps/console/src/app/runs/run-page/GatePanel.tsx`
- Test: `apps/console/src/app/runs/run-page/GatePanel.test.tsx`

**Interfaces:**
- Consumes: `presetSelections`, `withoutPreset` from `@mattstack/gate-kit`; `GateItemDisplay.writeIn`, write-in-aware `answersFromForm` from `@mattstack/gate-kit/react` (Task 4).
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing tests**

Add a fixture helper and tests inside `describe('GatePanel', ...)`:

```ts
  const writeInGate = () =>
    gateRow({
      questions: [
        { ...gateRow().questions[0]!, writeIn: true },
        { id: 'next', label: 'Then?', multi: false, options: ['proceed', 'iterate', 'hold'] },
      ],
    });

  it('enables Next on a writeIn question from note text alone and submits it as a write-in', async () => {
    answerPost.mockResolvedValue(ok());
    renderPanel(writeInGate());
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: /note/i })).toHaveAttribute('placeholder', 'Write your own answer, or pick one above');
    await userEvent.type(screen.getByRole('textbox', { name: /note/i }), 'split the migration out');
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() =>
      expect(answerPost).toHaveBeenCalledWith({
        param: { id: 'g1' },
        json: { answers: { approach: { writeIn: 'split the migration out' }, next: 'proceed' } },
      })
    );
  });

  it('keeps Next shut on a plain question with only a note', async () => {
    renderPanel(gateRow());
    await userEvent.type(screen.getByRole('textbox', { name: /note/i }), 'something else');
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });

  it('clears the picked option of a writeIn question when it is clicked again', async () => {
    renderPanel(writeInGate());
    await userEvent.click(radio(/Client-side filter/));
    expect(radio(/Client-side filter/)).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(radio(/Client-side filter/));
    expect(radio(/Client-side filter/)).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(radio(/Both, behind a flag/));
    expect(radio(/Both, behind a flag/)).toHaveAttribute('aria-checked', 'true');
  });

  it('opens with Proceed picked on next, without saving a draft', async () => {
    renderPanel(writeInGate());
    await userEvent.click(step(/Next/));
    expect(within(screen.getByRole('radiogroup', { name: /Then\?/ })).getByRole('radio', { name: /proceed/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('Draft saved')).toBeNull();
    expect(localStorage.getItem(gateDraftKey('g1'))).toBeNull();
  });

  it('does not preselect Proceed over a restored draft', async () => {
    localStorage.setItem(gateDraftKey('g1'), JSON.stringify({ selections: { approach: 'client' }, notes: {}, item: null, skipped: [] }));
    renderPanel(writeInGate());
    await userEvent.click(step(/Next/));
    expect(within(screen.getByRole('radiogroup', { name: /Then\?/ })).getByRole('radio', { name: /proceed/i })).toHaveAttribute('aria-checked', 'false');
  });
```

If `step(/Next/)` collides with the Next button, use the stepper's accessible name for the `next` step (`stepName('next')` renders "Next"); scope with `within(screen.getByTestId('gate-stepper'))`, which `step` already does.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/console && bunx vitest run src/app/runs/run-page/GatePanel.test.tsx; cd ../..`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

Imports: add `presetSelections, withoutPreset` to the `@mattstack/gate-kit` import.

Constants above `isAnswered`:

```ts
const NOTE_PLACEHOLDER = 'Add a note for the agent (optional)';
const WRITE_IN_PLACEHOLDER = 'Write your own answer, or pick one above';
```

Run both strings past `rt:ui-copy` before committing; if it changes them, update the tests to match.

Replace `isAnswered`:

```ts
function isAnswered(item: GateItemDisplay, value: unknown, note = ''): boolean {
  if (item.writeIn && note.trim().length > 0) return true;
  if (item.multiple) return Array.isArray(value) && value.length > 0;
  return typeof value === 'string' && value.length > 0;
}
```

In `GatePanel`, before the `selections` state:

```ts
  const preset = useMemo(() => presetSelections(gate.questions), [gate.questions]);
```

and seed `selections` with `() => draft.initial?.selections ?? preset`. Change the save effect to `save({ selections: withoutPreset(selections, preset), notes, item, skipped });` with `preset` added to its dependency list.

Pass the note to every `isAnswered` call: `const answered = active ? isAnswered(active, activeValue, notes[active.name]) : false;`, the stepper's `done={i !== index && isAnswered(d, selections[d.name], notes[d.name])}`, and the open-question check in `submit` (`!isAnswered(d, selections[d.name], notes[d.name]) && !skips.includes(d.name)`).

In `Question`, compute `const picked = item.multiple ? Array.isArray(value) && value.length > 0 : typeof value === 'string' && value !== '';`, set the Textarea `placeholder={item.writeIn && !picked ? WRITE_IN_PLACEHOLDER : NOTE_PLACEHOLDER}`, and change the `Radio.Group`'s handler to:

```tsx
          onChange={v => onPick(item.writeIn && v === value ? '' : v)}
```

Mantine's `Radio.Card` calls the group's `onChange` with its own value on every click, checked or not, so a click on the checked card arrives here with `v === value`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/console && bunx vitest run src/app/runs/run-page/GatePanel.test.tsx; cd ../..` and `bun run console:typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/app/runs/run-page/GatePanel.tsx apps/console/src/app/runs/run-page/GatePanel.test.tsx
git commit -m "console: write-in answers and a preselected Proceed in the gate panel"
```

---

### Task 7: Console answered views

**Files:**
- Modify: `apps/console/src/app/runs/derive/gates.ts:37-51` (`questionAnswer`)
- Modify: `apps/console/src/app/runs/derive/gateRecord.ts` (`RecordQuestion`, `recordQuestion`)
- Modify: `apps/console/src/app/runs/run-page/GateRecord.tsx` (~line 189)
- Modify: `apps/console/src/app/runs/derive/day.ts` (`gateLine`, `decisionText`)
- Modify: `apps/console/src/app/runs/derive/story.ts` (`firstPick`)
- Test: `apps/console/src/app/runs/derive/gates.test.ts`, `gateRecord.test.ts`, `day.test.ts`

**Interfaces:**
- Consumes: `UnwrappedGateAnswer.writeIn` (Task 4).
- Produces: `questionAnswer(...)` returns `{ picked: string[]; note?: string; text?: string; writeIn?: string } | null`; `RecordQuestion.writeIn?: string`.

- [ ] **Step 1: Write the failing tests**

`gates.test.ts`:

```ts
it('reads a write-in as no picks plus the text', () => {
  const q = { id: 'approach', label: 'A', multi: false, options: ['x'], writeIn: true as const };
  expect(questionAnswer({ answers: { approach: { writeIn: 'split it' } }, by: 'console', answeredAt: 1 }, q)).toEqual({ picked: [], writeIn: 'split it' });
});
```

(Import `questionAnswer` if the file does not already.)

`gateRecord.test.ts`:

```ts
describe('gateRecord: a write-in', () => {
  it('carries the written answer on its question, with nothing picked', () => {
    const record = gateRecord(
      gate({
        questions: [{ id: 'approach', label: 'Which approach?', multi: false, options: ['x', 'y'], writeIn: true }],
        answer: answered({ approach: { writeIn: 'split it' } }),
      })
    );
    if (record.shape !== 'form') throw new Error(record.shape);
    expect(record.questions[0]).toMatchObject({ writeIn: 'split it' });
    expect(record.questions[0]!.options.every(o => !o.picked)).toBe(true);
  });
});
```

`day.test.ts` (use the file's own GateRow builder if it has one; otherwise cast a literal as `gateRecord.test.ts` does):

```ts
it('names a write-in in the decision text', () => {
  const g = {
    id: 'g1', subject: 'run:r1', kind: 'plan', status: 'answered',
    questions: [{ id: 'approach', label: 'Which approach?', multi: false, options: ['x'], writeIn: true }],
    answer: { answers: { approach: { writeIn: 'split it' } }, by: 'console', answeredAt: 1 },
  } as unknown as GateRow;
  expect(decisionText(g)).toBe('wrote in: “split it”');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/console && bunx vitest run src/app/runs/derive/gates.test.ts src/app/runs/derive/gateRecord.test.ts src/app/runs/derive/day.test.ts; cd ../..`
Expected: FAIL.

- [ ] **Step 3: Implement**

`gates.ts` `questionAnswer`:

```ts
): { picked: string[]; note?: string; text?: string; writeIn?: string } | null {
  const raw = answer?.answers[question.id];
  if (raw == null) return null;
  const { value, note, text, writeIn } = unwrapGateAnswer(raw);
  return {
    picked: value === undefined ? [] : Array.isArray(value) ? value : [value],
    ...(note !== undefined ? { note } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(writeIn !== undefined ? { writeIn } : {}),
  };
}
```

Update its doc comment: "...the note or edited reply text that rode with them, or the human's own written answer."

`gateRecord.ts`: add `writeIn?: string;` to `RecordQuestion`, and in `recordQuestion`'s return `...(answer?.writeIn ? { writeIn: answer.writeIn } : {}),`.

`GateRecord.tsx`, after the `q.text` block:

```tsx
        {q.writeIn ? (
          <Text fz="md" fs="italic" data-testid="record-write-in">
            Wrote in: “{q.writeIn}”
          </Text>
        ) : null}
```

`day.ts` `gateLine`: before `if (!answer || answer.picked.length === 0) return question.label;` add
`if (answer?.writeIn) return `${question.label} Wrote in: “${answer.writeIn}”.`;`
and in `decisionText`'s map:

```ts
      const a = questionAnswer(gate.answer, q);
      if (a?.writeIn) return `wrote in: “${a.writeIn}”`;
      return a && a.picked.length > 0 ? pickedText(q, a.picked) : null;
```

`story.ts` `firstPick`: after `if (!answer) continue;` add `if (answer.writeIn) return oneLine(answer.writeIn);`.

- [ ] **Step 4: Run to verify they pass**

Run the Step 2 command, then `bun run console:typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/app/runs
git commit -m "console: answered gates show a write-in"
```

---

### Task 8: Board stage sheet and answered views

**Files:**
- Modify: `apps/board/src/client/board/sheet-payload.ts`
- Modify: `apps/board/src/client/board/GateForm.tsx` (`useGateForm`: preset, draft save, reset)
- Modify: `apps/board/src/client/board/SheetParts.tsx` (`Choices` click-to-clear, `Note` placeholder)
- Modify: `apps/board/src/client/board/StageSheet.tsx` (`answered`, tally, `pickChip`)
- Modify: `apps/board/src/client/board/AnsweredSheet.tsx`
- Modify: `apps/board/src/client/board/row-status.ts:272-274`
- Test: `apps/board/src/client/board/__tests__/stage-sheet-dom.test.tsx`, `answered-sheet-dom.test.tsx`

**Interfaces:**
- Consumes: `writeIns`, `gateAnswerPayload(…, written)`, `presetSelections`, `withoutPreset` (Task 4); `GateItemDisplay.writeIn`; cache attribute (Task 5).
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing tests**

`stage-sheet-dom.test.tsx`, append:

```ts
const planGate = (): GateRow =>
  ship({
    kind: 'plan',
    label: 'plan',
    questions: [
      { id: 'approach', label: 'Which approach?', multi: false, options: ['server', 'client'], writeIn: true },
      { id: 'next', label: 'Then?', multi: false, options: ['proceed', 'iterate', 'hold'] },
    ],
  });

test('a writeIn question answered with only a note submits a write-in', async () => {
  await render(planGate());
  expect(submit().disabled).toBe(true);
  expect(($('input[aria-label="Note for Which approach?"]') as HTMLInputElement).placeholder).toBe('Write your own answer, or pick one above');
  await type('Note for Which approach?', 'split the migration out');
  expect(submit().disabled).toBe(false);
  expect(text('.tui-sheet-list-tally')).toBe('2 of 2 answered');
  expect(dockRows().map(([chip]) => chip)).toEqual(['wrote in', 'proceed']);
  await click(submit());
  expect(answerPosts()).toEqual([
    { url: '/gate/answer', body: { gateId: 'g-ship', answers: { approach: { writeIn: 'split the migration out' }, next: 'proceed' } } },
  ]);
});

test('a plain question with only a note still blocks submit', async () => {
  await render(ship());
  await pick('preview-a');
  await pick('draft');
  await type('Note for How do we hand off?', 'something else');
  expect(submit().disabled).toBe(true);
});

test('clicking the picked option of a writeIn question clears it', async () => {
  await render(planGate());
  await pick('server');
  expect(($('input[value="server"]') as HTMLInputElement).checked).toBe(true);
  await pick('server');
  expect(($('input[value="server"]') as HTMLInputElement).checked).toBe(false);
  await pick('client');
  expect(($('input[value="client"]') as HTMLInputElement).checked).toBe(true);
});

test('Proceed opens picked on next, and reset brings it back', async () => {
  await render(planGate());
  expect(($('input[value="proceed"]') as HTMLInputElement).checked).toBe(true);
  await pick('hold');
  await click($('.tui-sheet-reset'));
  expect(($('input[value="proceed"]') as HTMLInputElement).checked).toBe(true);
});
```

`answered-sheet-dom.test.tsx`: add one test using that file's own render helper and answered-row builder, giving a gate with `questions: [{ id: 'approach', label: 'Which approach?', multi: false, options: ['server', 'client'], writeIn: true }]` and `answers: { approach: { writeIn: 'split it' } }`, asserting that the sheet's text contains `wrote in: split it` and that the dock row chip for "Which approach?" reads `wrote in`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/board && bun test src/client/board/__tests__/stage-sheet-dom.test.tsx src/client/board/__tests__/answered-sheet-dom.test.tsx; cd ../..`
Expected: FAIL.

- [ ] **Step 3: Implement sheet-payload.ts**

Import `writeIns`. After `sel` is built:

```ts
  const written = writeIns(
    gate.questions.filter(q => shown.has(q.id)),
    sel,
    notes
  );
  const payload = gateAnswerPayload(
    gate.questions,
    effectiveSelections(gate.kind, gate.questions, sel),
    written
  );
```

and after the existing answers loop: `for (const [id, text] of Object.entries(written)) answers[id] = { writeIn: text };`. Add to the doc comment: a shown `writeIn` question with no pick and note text answers `{ writeIn }`.

- [ ] **Step 4: Implement useGateForm (GateForm.tsx)**

Import `presetSelections, withoutPreset` from `@mattstack/gate-kit`. Add `const preset = useMemo(() => presetSelections(gate.questions), [gate.questions]);` before the `selections` state; seed with `() => draft?.selections ?? preset`; save with `saveDraft({ selections: withoutPreset(selections, preset), notes, texts, item: null });` (add `preset` to the deps); in `resetAll` change `setSelections({})` to `setSelections(preset)`.

- [ ] **Step 5: Implement SheetParts.tsx**

On the `Choices` `<input>`, add:

```tsx
              onClick={() => {
                if (!q.multiple && q.writeIn && checked)
                  form.setSingle(q.name, '');
              }}
```

(A click on a checked native radio fires `click` but no `change`; a click on an unchecked one sees `checked` false here and is picked by `onChange`.)

In `Note`:

```tsx
function Note({ q, form }: { q: GateItemDisplay; form: GateFormState }) {
  const v = form.selections[q.name];
  const picked = Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v !== '';
  return (
    <input
      type="text"
      className="tui-gate-note"
      aria-label={`Note for ${q.prompt}`}
      placeholder={q.writeIn && !picked ? 'Write your own answer, or pick one above' : 'Add a note'}
      value={form.notes[q.name] ?? ''}
      onChange={e => form.setNote(q.name, e.currentTarget.value)}
    />
  );
}
```

Use the same wording `rt:ui-copy` settled on in Task 6.

- [ ] **Step 6: Implement StageSheet.tsx**

```ts
function written(q: GateItemDisplay, v: Selection, note: string | undefined): boolean {
  return q.writeIn === true && !answered(v) && (note ?? '').trim() !== '';
}
```

Tally: `const done = display.filter(q => answered(form.selections[q.name]) || written(q, form.selections[q.name], form.notes[q.name])).length;`

`pickChip(q, v, note?: string)`: first line `if (written(q, v, note)) return { text: 'wrote in', intent: 'accent', title: note!.trim() };`. The dock rows call `pickChip(q, form.selections[q.name], form.notes[q.name])`.

- [ ] **Step 7: Implement AnsweredSheet.tsx and row-status.ts**

`AnsweredSheet.tsx`:
- `picks`: `for (const [id, a] of recorded) if (a.value !== undefined) selections[id] = a.value;`
- rows: before the existing chip choice, `const a = recorded.get(q.id);` and `const chip: RowChip = a?.writeIn !== undefined ? { text: 'wrote in', intent: 'accent', title: a.writeIn } : d ? pickChip(d, a?.value) : ...` (keep the existing fallbacks).
- question `lines`: add `{a?.writeIn && <p className="tui-gate-summary-reply">wrote in: {a.writeIn}</p>}` first.
- the `!d` branch text: `a?.writeIn ?? (typeof a?.value === 'string' && a.value ? a.value : 'No answer recorded.')`.

`row-status.ts`:

```ts
    const summary = Object.values(gate.answers ?? {})
      .map(v => {
        const a = unwrapGateAnswer(v);
        return a.writeIn !== undefined ? `wrote in: ${a.writeIn}` : (a.value ?? []);
      })
      .flatMap(v => (Array.isArray(v) ? v : [v]))
      .join(', ');
```

`respond-join.ts` needs no change: it only reads `answer.value` behind `typeof === 'string'` checks; confirm with the typecheck below.

- [ ] **Step 8: Run to verify they pass**

Run: `cd apps/board && bun test src/client/board/__tests__/stage-sheet-dom.test.tsx src/client/board/__tests__/answered-sheet-dom.test.tsx src/client/board/__tests__/row-status.test.ts; cd ../..` then `bun run board:typecheck`.
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add apps/board/src/client/board
git commit -m "board: write-in answers and a preselected Proceed on stage gates"
```

---

### Task 9: Agent skills

**Files:**
- Modify: `plugins/mattstack/attachments/gate-protocol/SKILL.md` ("Build the gate's questions and context", "Map the gate answer to exact option values", "Answers are option values", the graph's act step)
- Modify: the stage site tables in `plugins/mattstack/attachments/pipeline/stage-plan/SKILL.md`, `stage-provision`, `stage-ship`, `ship`, `stage-evidence`, `stage-watch-ci`, `watch-ci`, `work`, and `plugins/mattstack/attachments/review/self-review/SKILL.md`
- Modify: `plugins/mattstack/attachments/orchestration/shepherdr/SKILL.md`
- Regenerate: `apps/board/skills` (`bun run skills:expand:board`)

**Interfaces:**
- Consumes: the MCP surface from Task 3.

Load `superpowers:writing-skills` and `mattstack:editing-skills` first and follow them: a RED baseline (an agent at a site with a `writeIn` answer in hand, without the new text, does the mechanical branch or coerces "Other" into an option), then the edits, then GREEN.

- [ ] **Step 1: RED baseline**

Per `superpowers:writing-skills`, run a fresh subagent on the current gate-protocol plus stage-plan text with this scenario: "Your `plan` gate came back `{tier: {writeIn: \"skip TDD, it's a docs change\"}, next: \"proceed\"}`. What do you do next?" Record whether it proceeds without re-gating. Then the pane-form scenario: "The human typed Other: 'split the migration out' on the `tier` question." Record whether it maps to an option.

- [ ] **Step 2: gate-protocol, "Build the gate's questions and context"**

Change the opening sentence's question shape to `(each {"id", "label", "multi", "options"}, plus "writeIn": true where the site table marks the question (write-in))`, and add a bullet after **Options**:

```markdown
- **Write-ins.** `"writeIn": true` on a question lets the human answer it
  in their own words instead of a pick; that answer arrives as
  `{"writeIn": "<their words>"}` (the attribute allows one, the answer key
  is the write-in itself). A site table marks such a question
  `(write-in)` after its id. Set it only on a decision question whose
  free-text answer you can act on; never on `next` (Iterate here carries
  a change request) or on a review-post, respond, doctor or
  pane-attention question.
```

- [ ] **Step 3: gate-protocol, "Map the gate answer to exact option values"**

Append:

```markdown
On a question opened with `writeIn`, "Other" text with nothing ticked is
`{"writeIn": "<text>"}`, never the nearest option; "Other" text beside
ticked options on a multi is `{"value": [<ticks>], "note": "<text>"}`.
Words given at a held gate follow the same rule. On any other question
"Other" keeps the rules above.
```

- [ ] **Step 4: gate-protocol, "Answers are option values"**

Add at the section's end:

```markdown
The one exception is a question opened with `writeIn: true`: its answer
may be `{"writeIn": "<the human's words>"}`, alone, with no value. The
daemon refuses a write-in on any other question.
```

- [ ] **Step 5: gate-protocol, the write-in rule before acting**

Add a section after "Take the winning gate answer and its by":

```markdown
### Act on a write-in

When any question came back `{"writeIn": ...}`, the gate is handled like
Iterate here, whatever else was picked:

1. Skip the site's own branch for this gate. A Proceed on `next` beside a
   write-in is ignored (the form preselects it); a Hold or Go back is
   deliberate and wins, carrying the write-in as that move's note, and
   steps 2 and 3 do not run.
2. Read the whole answer set with the write-in as the instruction and do
   the work it asks for.
3. Then open a NEW gate at the same site (never reuse the old one) so the
   human sees the result before anything advances, closes or ships. A
   write-in too unclear to act on skips step 2 and the new gate asks
   about it; with no run, a prose question is fine instead.

Under a run, `run_decision` records it in that question's slot as an
object: `"<id>": {"writeIn": "<text>"}`.
```

In the digraph, add a diamond `"Any answer a write-in?"` between `"Take the winning gate answer and its by"`'s decision record and `"Act on the gate answer at the site"`, with `yes` to a box `"Act on a write-in"` and `no` to the existing act node, following `mattstack:process-digraphs`.

- [ ] **Step 6: Site tables**

Append ` (write-in)` to the question id cell of exactly these rows (search each file for the id in its gate table):
- `stage-plan`: `tier`
- `stage-provision`: `resume_in`, `ticket`
- `stage-ship` and `ship`: `dirty`, `open_as`, and `ship`'s `ready`
- `stage-evidence`: `source`, `attach`
- `stage-watch-ci`: `action` (the Fix and re-push row), `ready`
- `watch-ci`: `ready`, and `action` (the Fix and re-push row)
- `work`: `resume` (the clarify gate)
- `review/self-review`: `fix` and `finding` (write `` `fix` (write-in)`` in the bullet list)

Leave `next`, `to`, `annotations`, `failing_test`, `slug`, the domain rows and every attendance `action` row (Take / Hand back) unmarked.

- [ ] **Step 7: shepherdr**

In `plugins/mattstack/attachments/orchestration/shepherdr/SKILL.md`, beside the `rt gate answer <id> --answers <json> --by shepherd` prose, add one line: "A relayed human answer that fits no option goes as `{\"writeIn\": \"<their words>\"}` when the question was opened with `writeIn`; otherwise ask them to pick."

- [ ] **Step 8: GREEN, expand and check**

Re-run the Step 1 scenarios; both must now re-gate and send `{writeIn}`. Then:

```bash
bun run skills:expand:board
bun run skills:check:board
```

Run the plugin checks the `plugin-mattstack` job in `.github/workflows/checks.yml` runs (certify, `rt skills check --strict`). Recompile the team packs that vendor gate-protocol per `mattstack:editing-skills`.

- [ ] **Step 9: Commit**

```bash
git add plugins/mattstack apps/board/skills
git commit -m "skills: write-in questions in gate-protocol and the stage sites"
```

---

### Task 10: Verify in the browser and wrap up

- [ ] **Step 1: Targeted suites**

Re-run every test command from Tasks 1-8 together, then `bun run console:typecheck`, `bun run board:typecheck`, `bun run check` scoped as the repo's rules allow. Run `bash scripts/repo-purity.sh`.

- [ ] **Step 2: Render both apps**

Using Fast Browser (delegate to `fast-browser:browser-driver`), on the console design fixture or a fixture gate, and on the board by raw port (never a `*.mattstack` URL): screenshot, in light and dark,
- the console gate panel on a `writeIn` question: empty, with only note text (write-in placeholder visible, Next enabled), and with a pick (note placeholder);
- the console `next` step opening with Proceed picked;
- the board stage sheet with a write-in in the dock (`wrote in` chip) and the answered sheet showing `wrote in: ...`.

Say plainly what reads wrong; fix and re-shoot before calling it done.

- [ ] **Step 3: Commit any fixes, then finish the branch**

Use `superpowers:finishing-a-development-branch`. The PR description notes that, in dev mode, the daemon needs a restart before the console or board can submit a write-in.
