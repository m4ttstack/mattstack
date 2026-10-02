# Console pipeline viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Wiring page's Pipeline and On-demand tabs with a Graph tab that shows each skill as a template being rendered (inputs, template with placeholders, rendered output or links), a reusable compiled-skill drawer, and an unsynced-changes banner, built from rt data that says exactly which template line became which rendered lines.

**Architecture:** rt gains `skills anatomy` (one skill's template, placeholders, rendered line ranges, sources, links, drift), `skills changes`, `skills discard` and `sync --commit-pending`; composition gains a per-skill `targets` list. Console's server proxies these plus a confined `/api/skills/source` file read. The client maps them through pure models (`focusModel`, `templateModel`, `templateLayout`, `drawerContent`) into a React Flow canvas inside `PageShell` and a Mantine `Drawer`. Every UI task ends with a Fast Browser parity run against the Pencil boards.

**Tech Stack:** Bun + TypeScript (rt), Hono (console server), React 19 + Mantine 9.5 via `@mattstack/app-kit`, `@xyflow/react` 12, react-query, wouter, vitest + testing-library, Pencil (pen.dev) boards, Fast Browser.

**Spec:** `docs/superpowers/specs/2026-10-01-console-pipeline-viewer-design.md`

## Global Constraints

- UI follows `docs/apps/ui-authoring.md`: Mantine component as it ships (rung 1), CSS module via `classNames` for layout only (rung 2), else stop and ask Matt (rung 3). Colour only via `color`/`variant` props and role tokens (`--tk-*`); no raw hex in app code; no inline `style`/`styles` objects except the existing `useDrawerSurface()` helper.
- Nothing is hand-drawn that Mantine or the kit already provides. Look up any Mantine component or prop not already used in this session with the `mantine` MCP (`get_item_props`, `get_item_doc`) or the installed `@mantine/core` 9.5 types.
- The Graph tab renders in `PageShell`; the focus list is `PageShell.Sidebar`; the canvas is `PageShell.Content` with its own `bg` (opting out of the theme's line grid) and React Flow `<Background variant={BackgroundVariant.Dots} />`.
- Every write confirms through `modals.confirm` from `@mattstack/app-kit/modals`; results report through `notifications` from `@mattstack/app-kit/notifications`. No bespoke dialogs.
- Parity gate: every UI task ends with its boards rendered in Fast Browser in light and dark and compared with `scripts/parity/compare.ts`; the result must be 0 mismatches outside the board-fix list in `docs/apps/design/console/README.md`. A mismatch is a failure fixed in that task. Never open a `*.mattstack` URL in Fast Browser; load raw localhost ports.
- rt prints only through `lib/ui/out.ts` (`out.json` for `--json`); no `console.*`, no `process.stdout` writes (`lib/__tests__/no-raw-output.test.ts`).
- Fixtures, boards, commit messages and PR text use invented names only (`acme`, `globex`); run `bun run purity` before every push.
- No em dashes or en dashes anywhere (code, comments, copy, commits). Comments follow the clean-code rule: only constraints the code cannot show.
- Commit after every task with a short imperative message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run rt tests from the repo root (`bun test <path>`); run console tests with `cd apps/console && bunx vitest run <path>`; run kit tests with `cd packages/ui && bunx vitest run <path>`.

## Review Focus

- A legacy engine with no placeholders (body appended with slot sections, not compile-native): anatomy must still return one text part plus slot parts from the markers, and the canvas must render it. Tested in Task 2 and Task 12.
- A stage that was never compiled (`rendered.exists: false`): the template view renders, the output card says "never compiled", the drawer's Rendered toggle is disabled. Tested in Task 3 and Task 12.
- A `/api/skills/source` path that escapes the allowed roots (`..`, a symlink out of the pack, a non-`.md` file): 404, never the file. Tested in Task 6.
- A dirty pack checkout with files outside the pack scope (a README edit): `changes` lists them under `outsideScope`, `sync --commit-pending` refuses with that list, and the banner shows the refusal. Tested in Task 4, Task 5 and Task 20.
- A 1,300-line rendered file opened at a range near the end: the drawer scrolls the highlighted range into view without rendering lag. Tested in Task 11 and Task 17.

---

## File Structure

rt:
- `lib/skills/placeholders.ts`: modify; `substitute` gains a trace callback.
- `lib/skills/compile.ts`: modify; `compileSkill`/`buildBody` pass the trace through.
- `lib/skills/drift.ts`: modify; add `partExtents`, `changedPartKeys`.
- `lib/skills/anatomy.ts`: create; pure `buildParts`, `linksIn`, payload types.
- `lib/skills/changes.ts`: create; pure porcelain, binding and surface diff parsers.
- `lib/skills/sync.ts`: modify; `commitPending` option.
- `commands/skills.ts`: modify; `skillsAnatomy`, `skillsChanges`, `skillsDiscard`, composition `targets`, `compileVerb` trace param.
- `commands/skills-sync.ts`: modify; `--commit-pending` flag.
- `lib/command-tree-def.ts`: modify; `anatomy`, `changes`, `discard` leaves.

console server and data:
- `apps/console/src/server/skills.ts`: modify; routes `anatomy`, `source`, `changes`, `discard`; sync body flag.
- `apps/console/src/server/fixtures/design/*`: create; design fixture payloads and files.
- `apps/console/src/server/index.ts`: modify; `CONSOLE_FIXTURE=design` mode.
- `apps/console/src/app/wiring/useWiring.ts`: modify; new hooks, invalidation.

parity tooling and design:
- `docs/apps/design/console/console.pen`, `README.md`, `parity/*.html`, `renders/*.png`: create.
- `scripts/parity/{collect.js,run.js,compare.ts,pen.ts}` + tests: moved from `apps/boxscore/scripts/parity/`.
- `apps/console/scripts/parity/{boards.ts,harness.ts}`: create.

kit:
- `packages/ui/src/core/code-lines/{CodeLines.tsx,CodeLines.module.css,CodeLines.stories.tsx,CodeLines.test.tsx}`: create.

console UI (`apps/console/src/app/wiring/graph/`):
- `model/focusModel.ts`, `model/templateModel.ts`, `model/drawerContent.ts`, `layout/templateLayout.ts`: pure.
- `useWiringUrl.ts`: URL state.
- `FocusList.tsx`, `FocusHeader.tsx`, `GraphTab.tsx`, `TemplateCanvas.tsx` (lazy), `nodes/{TemplateNode,InputCardNode,LinkCardNode,OutputNode}.tsx`, `nodes/nodes.module.css`.
- `drawer/{SkillDrawer,TextTab,UsedByTab,HistoryTab,BuiltFromTable,RebindPanel,DrawerMenu}.tsx`.
- `UnsyncedBanner.tsx`.
- `apps/console/src/app/icons.ts`, `apps/console/src/app/app-icons.d.ts`: create.
- `WiringMap.tsx`: modify; Graph tab replaces Pipeline and On-demand.
- Removed in Task 22: `SkillSplitLayout.tsx`, `SkillRow.tsx`, `SkillRow.module.css`, `OnDemandView.tsx`, `SummaryStrip.tsx`, `SkillDetailPanel.tsx`, `AttentionEmptyState.tsx`, and their tests.

---

## Part A: rt data

### Task 1: Trace which template line became which rendered lines

**Files:**
- Modify: `lib/skills/placeholders.ts` (`emptySlotAfter`, `substitute`)
- Modify: `lib/skills/compile.ts` (`BuildOpts`, `buildBody`, `compileSkill` opts)
- Modify: `commands/skills.ts` (`compileVerb` at :637)
- Test: `lib/skills/__tests__/placeholders.test.ts`, `lib/skills/__tests__/compile.test.ts`

**Interfaces:**
- Produces: `export type TraceEntry = { templateIndex: number; outStart: number; outCount: number; placeholders: { kind: string; arg: string | null }[] }` from `lib/skills/placeholders.ts`; `substitute(body, ctx, where, trace?: (e: TraceEntry) => void)`; `compileSkill(..., opts.trace?)`; `compileVerb(target, resolved, emittedTargetDirs, verbSides, trace?)`.

- [ ] **Step 1: Write the failing tests** in `lib/skills/__tests__/placeholders.test.ts` (reuses the file's `ctx()`, `fill`, `inc`):

```ts
import { type TraceEntry } from "../placeholders.ts";

describe("substitute trace", () => {
  test("maps each template line to the rendered lines it produced", () => {
    const entries: TraceEntry[] = [];
    substitute("intro\n{{slot:domain}}\nmid\n{{include:review-core-body}}\nend", ctx(), "stage-plan", (e) => entries.push(e));
    expect(entries.map((e) => [e.templateIndex, e.outStart, e.outCount, e.placeholders.map((p) => `${p.kind}:${p.arg}`)])).toEqual([
      [0, 0, 1, []],
      [1, 1, 4, ["slot:domain"]],
      [2, 5, 1, []],
      [3, 6, 3, ["include:review-core-body"]],
      [4, 9, 1, []],
    ]);
  });

  test("an empty slot under a heading renders nothing and is still traced", () => {
    const entries: TraceEntry[] = [];
    substitute("## Domain\n\n{{slot:domain}}\n\nafter", ctx({ fills: { domain: null } }), "stage-plan", (e) => entries.push(e));
    expect(entries.map((e) => [e.templateIndex, e.outStart, e.outCount, e.placeholders.length])).toEqual([
      [0, 0, 0, 0],
      [1, 0, 0, 0],
      [2, 0, 0, 1],
      [3, 0, 0, 0],
      [4, 0, 1, 0],
    ]);
  });

  test("an inline placeholder in a table row is traced on that row", () => {
    const entries: TraceEntry[] = [];
    substitute("| plan | {{verb.path:stage-plan}} |", ctx(), "work", (e) => entries.push(e));
    expect(entries[0]).toEqual({ templateIndex: 0, outStart: 0, outCount: 1, placeholders: [{ kind: "verb.path", arg: "stage-plan" }] });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`TraceEntry` not exported; 4th argument ignored).

Run: `bun test lib/skills/__tests__/placeholders.test.ts`

- [ ] **Step 3: Implement** in `lib/skills/placeholders.ts`:

```ts
export type TraceEntry = {
  templateIndex: number;
  outStart: number;
  outCount: number;
  placeholders: { kind: string; arg: string | null }[];
};

function placeholdersIn(line: string): { kind: string; arg: string | null }[] {
  return [...line.matchAll(PLACEHOLDER_RE)].map((m) => ({ kind: m[1]!, arg: m[2] ?? null }));
}
```

Change `emptySlotAfter` to also return the slot line: `return { slot, end, line: j };` (type `{ slot: string; end: number; line: number } | null`).

Replace `substitute` with:

```ts
export function substitute(
  body: string,
  ctx: PlaceholderContext,
  where: string,
  trace?: (entry: TraceEntry) => void,
): { body: string; used: Used } {
  const used: Used = { slots: [], includes: [], packPaths: [] };
  const lines = body.split("\n");
  const out: string[] = [];
  let inFence = false;
  let outLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("```")) inFence = !inFence;
    if (!inFence && HEADING_RE.test(line)) {
      const empty = emptySlotAfter(lines, i, ctx.fills);
      if (empty) {
        used.slots.push(empty.slot);
        for (let k = i; k <= empty.end; k++) {
          trace?.({ templateIndex: k, outStart: outLines, outCount: 0, placeholders: k === empty.line ? [{ kind: "slot", arg: empty.slot }] : [] });
        }
        i = empty.end;
        continue;
      }
    }
    const rendered = substituteLine(line, i, ctx, where, used);
    const outCount = rendered.split("\n").length;
    trace?.({ templateIndex: i, outStart: outLines, outCount, placeholders: placeholdersIn(line) });
    outLines += outCount;
    out.push(rendered);
  }

  return { body: out.join("\n"), used };
}
```

- [ ] **Step 4: Run, expect PASS.** `bun test lib/skills/__tests__/placeholders.test.ts`

- [ ] **Step 5: Thread the trace through compile.** In `lib/skills/compile.ts`: add `trace?: (entry: TraceEntry) => void` to `BuildOpts` and to `compileSkill`'s `opts` type; pass `opts.trace` into the `buildBody(...)` options object inside `compileSkill`; in `buildBody` call `substitute(stepBody, opts.ctx, step.name, opts.trace)`. In `commands/skills.ts`, add a fifth parameter `trace?: (entry: TraceEntry) => void` to `compileVerb` and pass it as `trace` in the opts it hands `compileSkill`.

- [ ] **Step 6: Write the failing compile test** in `lib/skills/__tests__/compile.test.ts`, building the verb, step and include with the same builders this file's existing `compileSkill` tests use, a compile-native step body of `"first line\n{{include:x}}\nlast line"`, and asserting the line mapping lands in the final file:

```ts
test("trace entries map onto the rendered SKILL.md after the step marker", () => {
  const entries: TraceEntry[] = [];
  const result = compileSkill(verb, step, {}, roster, { includes: { x: include }, trace: (e) => entries.push(e) });
  const md = result.files["SKILL.md"]!;
  const lines = md.split("\n");
  const marker = lines.findIndex((l) => l.startsWith("<!-- part: step "));
  const bodyOffset = marker + 2;
  const last = entries.at(-1)!;
  expect(lines[bodyOffset + last.outStart]).toBe("last line");
  expect(lines[bodyOffset + entries[1]!.outStart]!.startsWith("<!-- part: include:x ")).toBe(true);
});
```

(If `CompileResult` names the file map differently than `files["SKILL.md"]`, use the field the existing compile tests read.)

- [ ] **Step 7: Run** `bun test lib/skills/__tests__/compile.test.ts lib/skills/__tests__/placeholders.test.ts` and **expect PASS**; then `bun test commands/__tests__/skills.test.ts` stays green.

- [ ] **Step 8: Commit**

```bash
git add lib/skills/placeholders.ts lib/skills/compile.ts commands/skills.ts lib/skills/__tests__/placeholders.test.ts lib/skills/__tests__/compile.test.ts
git commit -m "skills: trace template lines to rendered lines through compile"
```

### Task 2: Pure anatomy builder and part-level drift

**Files:**
- Create: `lib/skills/anatomy.ts`
- Modify: `lib/skills/drift.ts`
- Test: `lib/skills/__tests__/anatomy.test.ts`, `lib/skills/__tests__/drift.test.ts`

**Interfaces:**
- Consumes: `TraceEntry` (Task 1), `DriftCause` (drift.ts).
- Produces (from `lib/skills/anatomy.ts`):

```ts
export type AnatomyPartKind = "text" | "include" | "slot" | "verb.path" | "variable";
export type AnatomySource = { ref: string; path: string; version: string; builtVersion: string | null; lines: number };
export type AnatomyTarget = { skill: string; path: string; lines: number | null };
export type AnatomyPart = {
  kind: AnatomyPartKind;
  name: string | null;
  templateLines: [number, number] | null;
  renderedLines: [number, number] | null;
  mode: "inline" | "reference" | null;
  source: AnatomySource | null;
  target: AnatomyTarget | null;
  changed: boolean;
};
export type AnatomyLink = { path: string; line: number };
export type AnatomyPayload = {
  pack: string;
  skill: string;
  kind: "verb" | "stage";
  public: boolean;
  description: string | null;
  template: AnatomySource;
  rendered: { path: string; exists: boolean; lines: number };
  status: "in-sync" | "stale" | "never-compiled";
  staleBecause: DriftCause[];
  parts: AnatomyPart[];
  links: AnatomyLink[];
};
export type BuildPartsInput = {
  bodyStartLine: number;
  bodyOffset: number;
  trace: TraceEntry[];
  sources: Record<string, AnatomySource>;
  targets: Record<string, AnatomyTarget>;
  slotModes: Record<string, "inline" | "reference">;
  changedKeys: Set<string>;
};
export function buildParts(input: BuildPartsInput): AnatomyPart[];
export function partsFromMarkers(rendered: string, sources: Record<string, AnatomySource>, changedKeys: Set<string>): AnatomyPart[];
export function linksIn(rendered: string): AnatomyLink[];
```

- From `lib/skills/drift.ts`: `export type PartExtent = { key: string; version: string | null; start: number; end: number; text: string }`, `export function partExtents(md: string): PartExtent[]`, `export function changedPartKeys(onDisk: string, fresh: string): Set<string>`.

- [ ] **Step 1: Write the failing tests** `lib/skills/__tests__/anatomy.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { buildParts, linksIn, partsFromMarkers, type AnatomySource } from "../anatomy.ts";
import type { TraceEntry } from "../placeholders.ts";

const gate: AnatomySource = { ref: "mattstack:gate-protocol", path: "/m/attachments/gate-protocol/SKILL.md", version: "0.30.4", builtVersion: "0.28.10", lines: 446 };
const entry = (templateIndex: number, outStart: number, outCount: number, ph: [string, string | null][] = []): TraceEntry =>
  ({ templateIndex, outStart, outCount, placeholders: ph.map(([kind, arg]) => ({ kind, arg })) });

describe("buildParts", () => {
  test("merges plain lines into text parts and splits placeholders out", () => {
    const parts = buildParts({
      bodyStartLine: 14, bodyOffset: 9,
      trace: [entry(0, 0, 1), entry(1, 1, 1), entry(2, 2, 447, [["include", "gate-protocol"]]), entry(3, 449, 1), entry(4, 450, 1, [["stage.fields", null]])],
      sources: { "include:gate-protocol": gate }, targets: {}, slotModes: {}, changedKeys: new Set(),
    });
    expect(parts).toEqual([
      { kind: "text", name: null, templateLines: [14, 15], renderedLines: [10, 11], mode: null, source: null, target: null, changed: false },
      { kind: "include", name: "gate-protocol", templateLines: [16, 16], renderedLines: [12, 458], mode: null, source: gate, target: null, changed: false },
      { kind: "text", name: null, templateLines: [17, 17], renderedLines: [459, 459], mode: null, source: null, target: null, changed: false },
      { kind: "variable", name: "stage.fields", templateLines: [18, 18], renderedLines: [460, 460], mode: null, source: null, target: null, changed: false },
    ]);
  });

  test("an empty slot has no rendered lines and keeps its mode", () => {
    const [part] = buildParts({ bodyStartLine: 1, bodyOffset: 0, trace: [entry(0, 0, 0, [["slot", "domain"]])], sources: {}, targets: {}, slotModes: { domain: "inline" }, changedKeys: new Set() });
    expect(part).toMatchObject({ kind: "slot", name: "domain", renderedLines: null, mode: "inline" });
  });

  test("verb.path parts carry their target; changed keys mark includes and slots", () => {
    const parts = buildParts({
      bodyStartLine: 29, bodyOffset: 0,
      trace: [entry(0, 0, 1, [["verb.path", "stage-plan"]]), entry(1, 1, 3, [["slot", "domain"]])],
      sources: {}, targets: { "stage-plan": { skill: "stage-plan", path: "/p/attachments/stage-plan/SKILL.md", lines: 780 } },
      slotModes: { domain: "reference" }, changedKeys: new Set(["slot:domain"]),
    });
    expect(parts[0]).toMatchObject({ kind: "verb.path", name: "stage-plan", target: { lines: 780 } });
    expect(parts[1]).toMatchObject({ kind: "slot", mode: "reference", changed: true });
  });
});

describe("partsFromMarkers", () => {
  test("a legacy engine yields one text part plus a part per marker", () => {
    const md = ["---", "name: x", "---", "<!-- part: step source=mattstack:x version=1 path=a lines=5-6 -->", "", "body", "<!-- part: slot:domain binding=acme:p version=2 path=b lines=1-1 -->", "fill"].join("\n");
    const parts = partsFromMarkers(md, {}, new Set());
    expect(parts.map((p) => [p.kind, p.name, p.templateLines, p.renderedLines])).toEqual([
      ["text", null, null, [5, 6]],
      ["slot", "domain", null, [7, 8]],
    ]);
  });
});

describe("linksIn", () => {
  test("finds relative skill paths and vendored parts once each, with their first line", () => {
    const md = "a\nsee ../../attachments/gates/SKILL.md\nand ../../attachments/gates/SKILL.md\nparts/include-x/references/strategies.md";
    expect(linksIn(md)).toEqual([
      { path: "../../attachments/gates/SKILL.md", line: 2 },
      { path: "parts/include-x/references/strategies.md", line: 4 },
    ]);
  });
});
```

Add to `lib/skills/__tests__/drift.test.ts`:

```ts
import { changedPartKeys, partExtents } from "../drift.ts";

describe("partExtents", () => {
  test("bounds each include and slot part by its marker's line count", () => {
    const md = ["<!-- part: step source=m:s version=1 path=p lines=1-3 -->", "step", "<!-- part: include:g source=m:g version=0.28.10 path=a lines=7-8 -->", "g1", "g2", "step after"].join("\n");
    expect(partExtents(md)).toEqual([{ key: "include:g", version: "0.28.10", start: 2, end: 4, text: "g1\ng2" }]);
  });
});

describe("changedPartKeys", () => {
  test("ignores version bumps and reports only parts whose text changed", () => {
    const before = "<!-- part: include:g source=m:g version=1 path=a lines=1-1 -->\nsame\n<!-- part: slot:d binding=x version=1 path=b lines=1-1 -->\nold";
    const after = "<!-- part: include:g source=m:g version=2 path=a lines=1-1 -->\nsame\n<!-- part: slot:d binding=x version=1 path=b lines=1-1 -->\nnew";
    expect([...changedPartKeys(before, after)]).toEqual(["slot:d"]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test lib/skills/__tests__/anatomy.test.ts lib/skills/__tests__/drift.test.ts`

- [ ] **Step 3: Implement** `lib/skills/drift.ts` additions:

```ts
export type PartExtent = { key: string; version: string | null; start: number; end: number; text: string };

const EXTENT_RE = /^<!-- part: (slot:\S+|include:\S+) .*?\bversion=(\S+) .*?\blines=(\d+)-(\d+) -->$/;

export function partExtents(md: string): PartExtent[] {
  const lines = md.split("\n");
  const out: PartExtent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = EXTENT_RE.exec(lines[i]!);
    if (!m) continue;
    const end = Math.min(lines.length - 1, i + Number(m[4]) - Number(m[3]) + 1);
    out.push({ key: m[1]!, version: m[2]!, start: i, end, text: lines.slice(i + 1, end + 1).join("\n") });
  }
  return out;
}

export function changedPartKeys(onDisk: string, fresh: string): Set<string> {
  const before = new Map(partExtents(onDisk).map((p) => [p.key, p.text]));
  const changed = new Set<string>();
  for (const p of partExtents(fresh)) if (before.get(p.key) !== p.text) changed.add(p.key);
  return changed;
}
```

`lib/skills/anatomy.ts`:

```ts
import type { DriftCause } from "./drift.ts";
import { partExtents } from "./drift.ts";
import type { TraceEntry } from "./placeholders.ts";

// (types exactly as in Interfaces above)

const NAMED = new Set(["slot", "include", "verb.path"]);

function placeholderPart(kind: string, arg: string | null, line: number, rendered: [number, number] | null, input: BuildPartsInput): AnatomyPart {
  const key = kind === "slot" || kind === "include" ? `${kind}:${arg}` : null;
  return {
    kind: NAMED.has(kind) ? (kind as AnatomyPartKind) : "variable",
    name: NAMED.has(kind) ? arg : arg ? `${kind}:${arg}` : kind,
    templateLines: [line, line],
    renderedLines: rendered,
    mode: kind === "slot" ? input.slotModes[arg ?? ""] ?? null : null,
    source: key ? input.sources[key] ?? null : null,
    target: kind === "verb.path" && arg ? input.targets[arg] ?? null : null,
    changed: key ? input.changedKeys.has(key) : false,
  };
}

export function buildParts(input: BuildPartsInput): AnatomyPart[] {
  const parts: AnatomyPart[] = [];
  let run: { first: TraceEntry; last: TraceEntry; out: number } | null = null;
  const flush = () => {
    if (!run) return;
    parts.push({
      kind: "text", name: null,
      templateLines: [input.bodyStartLine + run.first.templateIndex, input.bodyStartLine + run.last.templateIndex],
      renderedLines: run.out === 0 ? null : [input.bodyOffset + run.first.outStart + 1, input.bodyOffset + run.first.outStart + run.out],
      mode: null, source: null, target: null, changed: false,
    });
    run = null;
  };
  for (const e of input.trace) {
    if (e.placeholders.length === 0) {
      if (run) { run.last = e; run.out += e.outCount; } else run = { first: e, last: e, out: e.outCount };
      continue;
    }
    flush();
    const rendered: [number, number] | null = e.outCount === 0 ? null : [input.bodyOffset + e.outStart + 1, input.bodyOffset + e.outStart + e.outCount];
    for (const p of e.placeholders) parts.push(placeholderPart(p.kind, p.arg, input.bodyStartLine + e.templateIndex, rendered, input));
  }
  flush();
  return parts;
}

const STEP_MARKER_RE = /^<!-- part: step /;

export function partsFromMarkers(rendered: string, sources: Record<string, AnatomySource>, changedKeys: Set<string>): AnatomyPart[] {
  const lines = rendered.split("\n");
  const stepAt = lines.findIndex((l) => STEP_MARKER_RE.test(l));
  const extents = partExtents(rendered);
  const firstPart = extents[0]?.start ?? lines.length;
  const parts: AnatomyPart[] = [];
  if (stepAt >= 0) parts.push({ kind: "text", name: null, templateLines: null, renderedLines: [stepAt + 2, firstPart], mode: null, source: null, target: null, changed: false });
  for (const x of extents) {
    const [kind, name] = x.key.split(":") as ["slot" | "include", string];
    parts.push({ kind, name, templateLines: null, renderedLines: [x.start + 1, x.end + 1], mode: kind === "slot" ? "inline" : null, source: sources[x.key] ?? null, target: null, changed: changedKeys.has(x.key) });
  }
  return parts;
}

const LINK_RE = /(?:\.\.\/)+(?:attachments|skills)\/[a-z0-9][a-z0-9-]*\/[A-Za-z0-9_./-]+\.md|parts\/[A-Za-z0-9_./-]+\.md/g;

export function linksIn(rendered: string): AnatomyLink[] {
  const seen = new Map<string, number>();
  rendered.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(LINK_RE)) if (!seen.has(m[0])) seen.set(m[0], i + 1);
  });
  return [...seen].map(([path, line]) => ({ path, line }));
}
```

- [ ] **Step 4: Run, expect PASS.** `bun test lib/skills/__tests__/anatomy.test.ts lib/skills/__tests__/drift.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/skills/anatomy.ts lib/skills/drift.ts lib/skills/__tests__/anatomy.test.ts lib/skills/__tests__/drift.test.ts
git commit -m "skills: pure anatomy parts, links and part-level drift"
```

### Task 3: `rt skills anatomy` and composition targets

**Files:**
- Modify: `commands/skills.ts` (new `skillsAnatomy`; `CompositionPayload` gains `targets`)
- Modify: `lib/command-tree-def.ts` (skills leaves near :2420)
- Test: `commands/__tests__/skills.test.ts`

**Interfaces:**
- Consumes: Task 1 trace, Task 2 `buildParts`/`partsFromMarkers`/`linksIn`/`changedPartKeys`, `skillMdDriftCauses` (drift.ts), `outDirFor` (lib/skills/layout.ts:62), `compileTargets` (:767), `compileVerb` (:637), `resolve` (:513).
- Produces: CLI `rt skills anatomy --pack <p> --skill <name> --json` printing `AnatomyPayload`; composition JSON gains:

```ts
type CompositionTarget = {
  name: string;
  kind: "verb" | "stage";
  public: boolean;
  artifactPath: string;           // absolute path of the rendered SKILL.md
  templatePath: string | null;    // absolute path of the engine SKILL.md
  placeholders: { kind: string; arg: string | null; line: number }[]; // template line numbers (frontmatter counted)
};
// CompositionPayload.targets: CompositionTarget[]
```

- [ ] **Step 1: Write the failing tests** in the `describe("skillsComposition --json")` block and a new `describe("skillsAnatomy --json")` block of `commands/__tests__/skills.test.ts`, using `makeMattstackDir()`, `makePackDir()`, `makeManifest()` and a pipeline with one stage engine whose body is `"intro\n{{include:gate-protocol}}\n{{slot:domain}}"` and a `gate-protocol` attachment of two lines:

```ts
test("composition lists every compile target with its rendered path and template placeholders", async () => {
  const payload = await compositionJson(/* the file's existing invocation pattern */);
  const stage = payload.targets.find((t: { name: string }) => t.name === "stage-plan");
  expect(stage).toMatchObject({ kind: "stage", public: false });
  expect(stage.artifactPath.endsWith("/attachments/stage-plan/SKILL.md")).toBe(true);
  expect(stage.placeholders.map((p: { kind: string }) => p.kind)).toEqual(["include", "slot"]);
  expect(stage.placeholders[0].line).toBeGreaterThan(1);
});

test("anatomy reports parts in template order with rendered ranges", async () => {
  await runSkills(["compile", ...packFlags]);
  const a = await anatomyJson(["--skill", "stage-plan", ...packFlags]);
  expect(a.kind).toBe("stage");
  expect(a.status).toBe("in-sync");
  expect(a.parts.map((p: { kind: string }) => p.kind)).toEqual(["text", "include", "slot"]);
  const inc = a.parts[1];
  const lines = readFileSync(a.rendered.path, "utf8").split("\n");
  expect(lines[inc.renderedLines[0] - 1]).toStartWith("<!-- part: include:gate-protocol ");
  expect(inc.source.lines).toBe(2);
});

test("anatomy of a never-compiled stage still lists template parts", async () => {
  const a = await anatomyJson(["--skill", "stage-plan", ...packFlags]);
  expect(a.status).toBe("never-compiled");
  expect(a.rendered.exists).toBe(false);
  expect(a.parts.every((p: { renderedLines: unknown }) => p.renderedLines !== undefined)).toBe(true);
});

test("anatomy rejects an unknown skill with a usage error", async () => {
  const { exitCode, stderr } = await runSkillsCapturing(["anatomy", "--skill", "nope", ...packFlags, "--json"]);
  expect(exitCode).not.toBe(0);
  expect(stderr).toContain('no skill named "nope"');
});
```

(`compositionJson`, `anatomyJson`, `runSkills`, `runSkillsCapturing` are thin wrappers to add at the top of the new describe block over the file's existing `console.log`-capture pattern; `packFlags` is `["--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifestPath]`.)

- [ ] **Step 2: Run, expect FAIL.** `bun test commands/__tests__/skills.test.ts -t "anatomy|compile target"`

- [ ] **Step 3: Implement composition `targets`.** In `skillsComposition` (:1451), after `resolve()`, build:

```ts
const targets: CompositionTarget[] = compileTargets(resolved).map((t) => {
  const step = /* the StepSource compileVerb loads for this target: same call compileVerb uses */;
  return {
    name: t.verb.name,
    kind: t.isStage ? "stage" : "verb",
    public: t.isPublic,
    artifactPath: join(outDirFor(resolved.packDir, t.verb.name, t.isPublic), "SKILL.md"),
    templatePath: step ? join(step.dir, "SKILL.md") : null,
    placeholders: step ? findPlaceholders(step.body).map((p) => ({ kind: p.kind, arg: p.arg, line: step.bodyStartLine + p.line - 1 })) : [],
  };
});
```

Add `targets` to `CompositionPayload` and the JSON it prints. (`bodyStartLine` is the source line of body line 1, so body line `p.line` is source line `bodyStartLine + p.line - 1`. If `StepSource` names its directory or path differently, use the field `buildCompositionVerb` already turns into `sourcePath`.)

- [ ] **Step 4: Implement `skillsAnatomy(args)`** in `commands/skills.ts`. Parse `--pack`, `--skill`, `--json` and the same `--pack-dir`/`--mattstack-dir`/`--manifest` overrides `skillsComposition` accepts; a missing `--skill` throws `SkillsUsageError("rt skills anatomy needs --skill <name>")`. Then:

```ts
const resolved = /* resolve() exactly as skillsComposition does */;
const target = compileTargets(resolved).find((t) => t.verb.name === skill);
if (!target) throw new SkillsUsageError(`no skill named "${skill}" in pack ${resolved.pack}`);

const trace: TraceEntry[] = [];
const result = compileVerb(target, resolved, [], /* verbSides as computeCheck builds them */, (e) => trace.push(e));
const fresh = result.files["SKILL.md"]!;
const renderedPath = join(outDirFor(resolved.packDir, skill, target.isPublic), "SKILL.md");
const onDisk = existsSync(renderedPath) ? readFileSync(renderedPath, "utf8") : null;
const shown = onDisk ?? fresh;

const builtVersions = new Map(partExtents(onDisk ?? "").map((p) => [p.key, p.version]));
const sources: Record<string, AnatomySource> = {};
for (const [name, inc] of Object.entries(/* the includes map compileVerb passed */)) {
  sources[`include:${name}`] = { ref: `${inc.plugin}:${name}`, path: join(inc.dir, "SKILL.md"), version: inc.version, builtVersion: builtVersions.get(`include:${name}`) ?? null, lines: inc.body.split("\n").length };
}
for (const [slot, fill] of Object.entries(/* the fills map compileVerb passed */)) {
  if (fill) sources[`slot:${slot}`] = { ref: fill.binding, path: join(fill.dir, "SKILL.md"), version: fill.version, builtVersion: builtVersions.get(`slot:${slot}`) ?? null, lines: fill.body.split("\n").length };
}
const targets: Record<string, AnatomyTarget> = {};
for (const t of compileTargets(resolved)) {
  const path = join(outDirFor(resolved.packDir, t.verb.name, t.isPublic), "SKILL.md");
  targets[t.verb.name] = { skill: t.verb.name, path, lines: existsSync(path) ? readFileSync(path, "utf8").split("\n").length : null };
}
const freshLines = fresh.split("\n");
const bodyOffset = freshLines.findIndex((l) => l.startsWith("<!-- part: step ")) + 2;
const changedKeys = onDisk ? changedPartKeys(onDisk, fresh) : new Set<string>();
const parts = trace.length > 0
  ? buildParts({ bodyStartLine: step.bodyStartLine, bodyOffset, trace, sources, targets, slotModes: /* slotMode map compileSkill built */, changedKeys })
  : partsFromMarkers(shown, sources, changedKeys);
const staleBecause = onDisk ? skillMdDriftCauses(onDisk, fresh) : [];
const payload: AnatomyPayload = {
  pack: resolved.pack, skill, kind: target.isStage ? "stage" : "verb", public: target.isPublic,
  description: target.verb.description ?? null,
  template: { ref: `${step.plugin}:${step.name}`, path: join(step.dir, "SKILL.md"), version: step.version, builtVersion: /* version= of the on-disk step marker, else null */, lines: /* line count of the engine SKILL.md */ },
  rendered: { path: renderedPath, exists: onDisk !== null, lines: shown.split("\n").length },
  status: onDisk === null ? "never-compiled" : staleBecause.length > 0 ? "stale" : "in-sync",
  staleBecause, parts, links: linksIn(shown),
};
```

Print with `out.json(payload)` under `--json`; without it, print a compact `out.table` of parts (kind, name, template lines, rendered lines). When the anatomy reports rendered ranges for a never-compiled skill, they describe the fresh compile; the console shows them only when `rendered.exists`.

Expose any values the snippet marks `/* ... */` by returning them from `compileVerb` alongside `CompileResult` (add an optional `anatomy?: { step, includes, fills, slotMode }` field filled only when `trace` is passed), so the command reads them instead of re-resolving.

- [ ] **Step 5: Register the leaf** in `lib/command-tree-def.ts` beside `composition`:

```ts
anatomy: {
  description: "Show what one compiled skill is made of",
  module: "./commands/skills.ts",
  fn: "skillsAnatomy",
  args: [
    { name: "--pack", type: "text", description: "Pack name" },
    { name: "--skill", type: "text", description: "Skill or stage name" },
    SETUP_JSON_ARG,
  ],
},
```

Mirror the exact arg object shape the `composition` leaf uses (field names may differ; copy them). Not agentSafe.

- [ ] **Step 6: Run** `bun test commands/__tests__/skills.test.ts` **expect PASS**, then `bun run picker:check`, `bun run docs:gen`, `bun test lib/__tests__/no-raw-output.test.ts lib/__tests__/agent-safe.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add commands/skills.ts lib/command-tree-def.ts commands/__tests__/skills.test.ts docs
git commit -m "skills: anatomy verb and per-target composition paths"
```

### Task 4: `rt skills changes`

**Files:**
- Create: `lib/skills/changes.ts`
- Modify: `commands/skills.ts` (`skillsChanges`), `lib/command-tree-def.ts`
- Test: `lib/skills/__tests__/changes.test.ts`, `commands/__tests__/skills.test.ts`

**Interfaces:**
- Produces from `lib/skills/changes.ts`:

```ts
export const PACK_SCOPE = ["pack", "skills", "attachments", ".claude-plugin", "surface.jsonc"] as const;
export type PendingFile = { path: string; status: string };
export type BindingChange = { engineRef: string; slot: string; from: string | null; to: string | null };
export type SurfaceChange = { skill: string; from: "public" | "internal"; to: "public" | "internal" };
export type ChangesPayload = { pack: string; packDir: string; dirty: boolean; files: PendingFile[]; outsideScope: PendingFile[]; bindings: BindingChange[]; surface: SurfaceChange[] };
export function parsePorcelain(stdout: string): PendingFile[];
export function inScope(path: string): boolean;
export function bindingChanges(before: unknown, after: unknown): BindingChange[];
export function surfaceChanges(before: unknown, after: unknown): SurfaceChange[];
```

- CLI: `rt skills changes --pack <p> --json` prints `ChangesPayload`.

- [ ] **Step 1: Write failing unit tests** `lib/skills/__tests__/changes.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { bindingChanges, inScope, parsePorcelain, surfaceChanges } from "../changes.ts";

describe("parsePorcelain", () => {
  test("reads status and path, including renames and untracked", () => {
    expect(parsePorcelain(" M pack/skills.jsonc\n?? attachments/stage-plan/new.md\nR  a.md -> b.md\n")).toEqual([
      { path: "pack/skills.jsonc", status: "M" },
      { path: "attachments/stage-plan/new.md", status: "??" },
      { path: "b.md", status: "R" },
    ]);
  });
});

describe("inScope", () => {
  test("pack files are in scope, a README is not", () => {
    expect(inScope("pack/skills.jsonc")).toBe(true);
    expect(inScope("attachments/stage-plan/SKILL.md")).toBe(true);
    expect(inScope("surface.jsonc")).toBe(true);
    expect(inScope("README.md")).toBe(false);
  });
});

describe("bindingChanges", () => {
  test("lists rebinds, new bindings and removed bindings", () => {
    const before = { bindings: { "mattstack:stage-plan": { domain: "acme:plan-policy" }, "mattstack:review": { criteria: "acme:review-criteria" } } };
    const after = { bindings: { "mattstack:stage-plan": { domain: "acme:plan-policy-strict" }, "mattstack:ship": { domain: "acme:ship-domain" } } };
    expect(bindingChanges(before, after)).toEqual([
      { engineRef: "mattstack:review", slot: "criteria", from: "acme:review-criteria", to: null },
      { engineRef: "mattstack:ship", slot: "domain", from: null, to: "acme:ship-domain" },
      { engineRef: "mattstack:stage-plan", slot: "domain", from: "acme:plan-policy", to: "acme:plan-policy-strict" },
    ]);
  });
  test("a missing or malformed file reads as no bindings", () => {
    expect(bindingChanges(null, { bindings: {} })).toEqual([]);
  });
});

describe("surfaceChanges", () => {
  test("public list additions and removals become flips", () => {
    expect(surfaceChanges({ public: ["work", "review"] }, { public: ["work", "ship"] })).toEqual([
      { skill: "review", from: "public", to: "internal" },
      { skill: "ship", from: "internal", to: "public" },
    ]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test lib/skills/__tests__/changes.test.ts`

- [ ] **Step 3: Implement** `lib/skills/changes.ts`:

```ts
export const PACK_SCOPE = ["pack", "skills", "attachments", ".claude-plugin", "surface.jsonc"] as const;

export type PendingFile = { path: string; status: string };
export type BindingChange = { engineRef: string; slot: string; from: string | null; to: string | null };
export type SurfaceChange = { skill: string; from: "public" | "internal"; to: "public" | "internal" };
export type ChangesPayload = { pack: string; packDir: string; dirty: boolean; files: PendingFile[]; outsideScope: PendingFile[]; bindings: BindingChange[]; surface: SurfaceChange[] };

export function parsePorcelain(stdout: string): PendingFile[] {
  return stdout.split("\n").filter((l) => l.length > 3).map((l) => {
    const status = l.slice(0, 2).trim();
    const rest = l.slice(3);
    const arrow = rest.indexOf(" -> ");
    return { path: arrow >= 0 ? rest.slice(arrow + 4) : rest, status };
  });
}

export function inScope(path: string): boolean {
  return PACK_SCOPE.some((root) => path === root || path.startsWith(`${root}/`));
}

function bindingsOf(doc: unknown): Record<string, Record<string, string>> {
  const b = (doc as { bindings?: unknown } | null)?.bindings;
  return b && typeof b === "object" ? (b as Record<string, Record<string, string>>) : {};
}

export function bindingChanges(before: unknown, after: unknown): BindingChange[] {
  const a = bindingsOf(before);
  const b = bindingsOf(after);
  const out: BindingChange[] = [];
  for (const engineRef of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const slots = new Set([...Object.keys(a[engineRef] ?? {}), ...Object.keys(b[engineRef] ?? {})]);
    for (const slot of [...slots].sort()) {
      const from = a[engineRef]?.[slot] ?? null;
      const to = b[engineRef]?.[slot] ?? null;
      if (from !== to) out.push({ engineRef, slot, from, to });
    }
  }
  return out;
}

function publicOf(doc: unknown): Set<string> {
  const p = (doc as { public?: unknown } | null)?.public;
  return new Set(Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : []);
}

export function surfaceChanges(before: unknown, after: unknown): SurfaceChange[] {
  const a = publicOf(before);
  const b = publicOf(after);
  const out: SurfaceChange[] = [];
  for (const skill of [...new Set([...a, ...b])].sort()) {
    if (a.has(skill) && !b.has(skill)) out.push({ skill, from: "public", to: "internal" });
    if (!a.has(skill) && b.has(skill)) out.push({ skill, from: "internal", to: "public" });
  }
  return out;
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Implement `skillsChanges(args)`** in `commands/skills.ts`: resolve `packDir` the way `skillsComposition` does; run `git -C packDir status --porcelain=v1 --untracked-files=all` through the same spawn helper sync uses (`childEnv()` env); split files by `inScope`; for `pack/skills.jsonc` and the surface file (`surfaceFileFor(packDir)`), parse the working copy with `jsonc-parser`'s `parse` and the `HEAD` copy from `git -C packDir show HEAD:<relative path>` (a non-zero exit means the file is new: treat as `null`); build `ChangesPayload` with `dirty: files.length + outsideScope.length > 0`; print with `out.json`. Register leaf `changes` ("List this pack's changes that are not synced yet", `--pack`, `--json`).

- [ ] **Step 6: Command test** in `commands/__tests__/skills.test.ts`: `git init` the temp pack dir, commit it, edit `pack/skills.jsonc` to rebind a slot, write `README.md`, run `changes --json`, expect one binding change, `pack/skills.jsonc` in `files`, `README.md` in `outsideScope`, `dirty: true`.

- [ ] **Step 7: Run** `bun test lib/skills/__tests__/changes.test.ts commands/__tests__/skills.test.ts` and `bun run docs:gen` **expect PASS**.

- [ ] **Step 8: Commit**

```bash
git add lib/skills/changes.ts lib/skills/__tests__/changes.test.ts commands/skills.ts lib/command-tree-def.ts commands/__tests__/skills.test.ts docs
git commit -m "skills: changes verb lists unsynced pack edits"
```

### Task 5: `sync --commit-pending` and `rt skills discard`

**Files:**
- Modify: `lib/skills/sync.ts` (guards at :253-259, early return at :385-386, commit-push at :435-445)
- Modify: `commands/skills-sync.ts` (flag), `commands/skills.ts` (`skillsDiscard`), `lib/command-tree-def.ts`
- Test: `lib/skills/__tests__/sync.test.ts`, `commands/__tests__/skills-sync.test.ts`, `commands/__tests__/skills.test.ts`

**Interfaces:**
- Consumes: `inScope`, `parsePorcelain`, `PACK_SCOPE` (Task 4).
- Produces: `syncPack(deps, { ...existing, commitPending?: boolean })`; a new `SyncStep` named `commit-pending`; CLI `rt skills sync --pack <p> --commit-pending [--json]`; CLI `rt skills discard --pack <p> --json` printing `{ pack, packDir, discarded: PendingFile[] }`.

- [ ] **Step 1: Write failing sync tests** in `lib/skills/__tests__/sync.test.ts` using `fixturePack()` and `makeDeps(pack, engine, world)`; give the fake git world a dirty pack (`pack/skills.jsonc` modified):

```ts
test("commit-pending commits in-scope pack edits, then bumps, pushes and updates the cache", async () => {
  const world = /* existing world builder */ ({ packStatus: " M pack/skills.jsonc\n" });
  const report = await syncPack(makeDeps(pack, engine, world), { pack: "acme", commitPending: true });
  expect(report.steps.find((s) => s.name === "commit-pending")?.status).toBe("ran");
  expect(report.steps.find((s) => s.name === "commit-push")?.status).toBe("ran");
  expect(report.steps.find((s) => s.name === "update-pack")?.status).toBe("ran");
  expect(world.gitCalls).toContainEqual(["add", "--", "pack"]);
});

test("commit-pending refuses when the pack has edits outside its scope", async () => {
  const world = ({ packStatus: " M README.md\n M pack/skills.jsonc\n" });
  const report = await syncPack(makeDeps(pack, engine, world), { pack: "acme", commitPending: true });
  const step = report.steps.find((s) => s.name === "guards")!;
  expect(step.status).toBe("refused");
  expect(step.detail).toContain("README.md");
});

test("without commit-pending a dirty pack is refused as before", async () => {
  const report = await syncPack(makeDeps(pack, engine, { packStatus: " M pack/skills.jsonc\n" }), { pack: "acme" });
  expect(report.steps.find((s) => s.name === "guards")!.detail).toContain("pack checkout dirty");
});
```

(Adapt `world` fields to how `makeDeps` models git status and records git calls; add a `gitCalls` recorder to the fake if it has none.)

- [ ] **Step 2: Run, expect FAIL.** `bun test lib/skills/__tests__/sync.test.ts`

- [ ] **Step 3: Implement in `lib/skills/sync.ts`.** In the guards, where a dirty pack is refused today, when `opts.commitPending`:

```ts
const pending = parsePorcelain(packStatus.stdout);
const outside = pending.filter((f) => !inScope(f.path));
if (outside.length > 0) {
  return refused(`pack checkout has changes outside the pack: ${outside.map((f) => f.path).join(", ")}; commit or discard those and re-run`);
}
```

then after the guards pass, a new step:

```ts
steps.push(await step("commit-pending", async () => {
  if (!opts.commitPending || pending.length === 0) return skipped("nothing pending");
  const roots = PACK_SCOPE.filter((r) => existsSync(join(pack.dir, r)));
  await deps.git(pack.dir, ["add", "--", ...roots]);
  await deps.git(pack.dir, ["commit", "-m", `skills: ${pack.name} changes from console`]);
  published = true;
  return ran(`committed ${pending.length} file(s)`);
}));
```

Declare `let published = false;` before the guards. Make the early no-op return (:385-386) and the commit-push skip (:436) both fire only when `!published`, so a published change always bumps, pushes and updates the installed cache. (Use the file's real step/outcome helpers; the names above stand for them.)

- [ ] **Step 4: Run, expect PASS**, including the existing sync tests.

- [ ] **Step 5: Wire the flag** in `commands/skills-sync.ts`: parse `--commit-pending` and pass `commitPending: true`; register it on the `sync` leaf's args. Add a wiring test in `commands/__tests__/skills-sync.test.ts` asserting the flag reaches `syncPack`.

- [ ] **Step 6: Implement `skillsDiscard(args)`** in `commands/skills.ts`: resolve `packDir`; read porcelain; keep in-scope files; if none, print `{ pack, packDir, discarded: [] }`; otherwise run `git -C packDir restore --source=HEAD --staged --worktree -- <in-scope roots that exist in HEAD>` and `git -C packDir clean -fd -- skills attachments pack` and print the discarded list. Never touch out-of-scope files. Register leaf `discard` ("Throw away this pack's changes that are not synced yet", `--pack`, `--json`). Test in `commands/__tests__/skills.test.ts`: a git-initialised temp pack with a modified `pack/skills.jsonc`, an untracked `attachments/x/SKILL.md` and a modified `README.md`; after discard the first two are gone and `README.md` is still modified.

- [ ] **Step 7: Run** `bun test lib/skills commands/__tests__/skills-sync.test.ts commands/__tests__/skills.test.ts` and `bun run docs:gen`, `bun run picker:check` **expect PASS**.

- [ ] **Step 8: Commit**

```bash
git add lib/skills/sync.ts commands/skills-sync.ts commands/skills.ts lib/command-tree-def.ts lib/skills/__tests__/sync.test.ts commands/__tests__ docs
git commit -m "skills: sync can commit pending pack edits; discard verb"
```

---

## Part B: console server and data hooks

### Task 6: Server routes for anatomy, source, changes, discard

**Files:**
- Modify: `apps/console/src/server/skills.ts`
- Test: `apps/console/src/server/skills.test.ts`

**Interfaces:**
- Consumes: rt verbs from Tasks 3-5.
- Produces routes: `GET /api/skills/anatomy?pack&skill` (rt JSON passthrough, cached), `GET /api/skills/source?pack&path` (`{ path, content, lines }`), `GET /api/skills/changes?pack` (rt JSON, not cached), `POST /api/skills/discard {pack}` (rt JSON, clears the pack's cache keys), and `POST /api/skills/sync` accepting `commitPending?: boolean` (appends `--commit-pending`).

- [ ] **Step 1: Write failing tests** in `skills.test.ts` (node environment, `fakeRtHandler`):

```ts
describe('/api/skills/anatomy', () => {
  it('runs rt skills anatomy for the pack and skill', async () => {
    const rt = fakeRt({ code: 0, stdout: JSON.stringify({ pack: 'acme', skill: 'stage-plan', parts: [] }), stderr: '' });
    const app = mountSkills(new Hono(), rt.run);
    const res = await app.request('/api/skills/anatomy?pack=acme&skill=stage-plan');
    expect(res.status).toBe(200);
    expect(rt.calls[0]).toEqual(['skills', 'anatomy', '--pack', 'acme', '--skill', 'stage-plan', '--json']);
  });
  it('400s without a skill', async () => {
    const app = mountSkills(new Hono(), fakeRt({ code: 0, stdout: '{}', stderr: '' }).run);
    expect((await app.request('/api/skills/anatomy?pack=acme')).status).toBe(400);
  });
});

describe('/api/skills/source', () => {
  const composition = { pack: 'acme', packDir: '/packs/acme', verbs: [{ sourcePath: '/cache/mattstack/0.30.4/attachments/pipeline/work/SKILL.md' }], fills: [], binders: [], targets: [] };
  const handler = fakeRtHandler(argv => argv[1] === 'composition' ? { code: 0, stdout: JSON.stringify(composition), stderr: '' } : { code: 1, stdout: '', stderr: '' });
  const files: Record<string, string> = { '/packs/acme/attachments/stage-plan/SKILL.md': 'a\nb', '/cache/mattstack/0.30.4/attachments/gate-protocol/SKILL.md': 'g' };
  const read: ReadPackFile = async p => { if (p in files) return files[p]!; throw new Error('ENOENT'); };
  const realpath = async (p: string) => p;

  it('serves a markdown file under the pack', async () => {
    const app = mountSkills(new Hono(), handler.run, fakeGit(), read, realpath);
    const res = await app.request('/api/skills/source?pack=acme&path=' + encodeURIComponent('/packs/acme/attachments/stage-plan/SKILL.md'));
    expect(await res.json()).toEqual({ path: '/packs/acme/attachments/stage-plan/SKILL.md', content: 'a\nb', lines: 2 });
  });
  it('serves a markdown file under the engine plugin root', async () => {
    const app = mountSkills(new Hono(), handler.run, fakeGit(), read, realpath);
    const res = await app.request('/api/skills/source?pack=acme&path=' + encodeURIComponent('/cache/mattstack/0.30.4/attachments/gate-protocol/SKILL.md'));
    expect(res.status).toBe(200);
  });
  it.each(['/packs/acme/../other/SKILL.md', '/etc/passwd', '/packs/acme/notes.txt'])('404s %s', async path => {
    const app = mountSkills(new Hono(), handler.run, fakeGit(), read, realpath);
    expect((await app.request('/api/skills/source?pack=acme&path=' + encodeURIComponent(path))).status).toBe(404);
  });
  it('404s a symlink whose real path leaves the roots', async () => {
    const app = mountSkills(new Hono(), handler.run, fakeGit(), read, async () => '/elsewhere/SKILL.md');
    const res = await app.request('/api/skills/source?pack=acme&path=' + encodeURIComponent('/packs/acme/attachments/stage-plan/SKILL.md'));
    expect(res.status).toBe(404);
  });
});

describe('/api/skills/changes and discard', () => {
  it('changes is never cached', async () => {
    const rt = fakeRt({ code: 0, stdout: JSON.stringify({ dirty: false }), stderr: '' });
    const app = mountSkills(new Hono(), rt.run);
    await app.request('/api/skills/changes?pack=acme');
    await app.request('/api/skills/changes?pack=acme');
    expect(rt.calls).toHaveLength(2);
  });
  it('discard posts rt skills discard', async () => {
    const rt = fakeRt({ code: 0, stdout: JSON.stringify({ discarded: [] }), stderr: '' });
    const app = mountSkills(new Hono(), rt.run);
    const res = await app.request('/api/skills/discard', { method: 'POST', body: JSON.stringify({ pack: 'acme' }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(200);
    expect(rt.calls[0]).toEqual(['skills', 'discard', '--pack', 'acme', '--json']);
  });
  it('sync passes --commit-pending when asked', async () => {
    const rt = fakeRt({ code: 0, stdout: JSON.stringify({ steps: [] }), stderr: '' });
    const app = mountSkills(new Hono(), rt.run);
    await app.request('/api/skills/sync', { method: 'POST', body: JSON.stringify({ pack: 'acme', commitPending: true }), headers: { 'content-type': 'application/json' } });
    expect(rt.calls[0]).toContain('--commit-pending');
  });
});
```

(Match the existing sync route test's request and argv conventions; if the sync route's argv differs, assert `--commit-pending` is present rather than the full list.)

- [ ] **Step 2: Run, expect FAIL.** `cd apps/console && bunx vitest run src/server/skills.test.ts`

- [ ] **Step 3: Implement.** Add a `skillQuery` validator (`{ pack?: string; skill?: string }`) and a `sourceQuery` validator (`{ pack?: string; path?: string }`) shaped like `packQuery`. Add a fifth `mountSkills` parameter `realpath: (p: string) => Promise<string> = p => fsRealpath(p)` (from `node:fs/promises`). Add the routes in the chain, copying the composition route's error mapping:

```ts
.get('/api/skills/anatomy', skillQuery, async c => {
  const { pack, skill } = c.req.valid('query');
  if (!pack || !skill) return c.json({ error: 'pack and skill are required' }, 400);
  try {
    const { stdout, stderr } = await cachedRun(['skills', 'anatomy', '--pack', pack, '--skill', skill, '--json']);
    const payload = parseJsonPayload(stdout);
    if (payload === undefined) return c.json({ error: stderr.trim() || 'rt produced no output' }, 502);
    return c.json(payload as SkillsAnatomyResponse, 200);
  } catch (err) {
    if (err instanceof RtNotFoundError) return c.json({ error: err.message }, 503);
    return c.json({ error: (err as Error).message }, 502);
  }
})
.get('/api/skills/source', sourceQuery, async c => {
  const { pack, path } = c.req.valid('query');
  if (!pack || !path) return c.json({ error: 'pack and path are required' }, 400);
  const notFound = () => c.json({ error: 'not a skill file of this pack' }, 404);
  if (!path.endsWith('.md') || path.split('/').includes('..')) return notFound();
  try {
    const { stdout } = await cachedRun(['skills', 'composition', '--pack', pack, '--json']);
    const comp = parseJsonPayload(stdout) as SkillsCompositionResponse | undefined;
    if (!comp) return notFound();
    const roots = new Set<string>([comp.packDir]);
    for (const v of comp.verbs) { const root = pluginRootOf(v.sourcePath); if (root) roots.add(root); }
    const real = await realpath(path);
    if (![...roots].some(r => real === r || real.startsWith(`${r}/`))) return notFound();
    const content = await readPackFile(real);
    if (content.length > 1_048_576) return c.json({ error: 'file too large' }, 413);
    return c.json({ path, content, lines: content.split('\n').length } as SkillsSourceResponse, 200);
  } catch {
    return notFound();
  }
})
```

`pluginRootOf` moves from `app/wiring/outline.ts` to `apps/console/src/shared/pluginRoot.ts` (exported, imported by both outline.ts and the server) so the server does not import app code. Add `changes` (uncached `runRt`), `discard` (POST, clears the pack's cache keys like the bind route), and the `commitPending` field on `syncBody` (append `'--commit-pending'` when true). Declare `SkillsAnatomyResponse`, `SkillsSourceResponse` (`{ path: string; content: string; lines: number }`), `SkillsChangesResponse`, `SkillsDiscardResponse` interfaces locally, mirroring the rt payload types from Tasks 2 and 4.

- [ ] **Step 4: Run, expect PASS**, full server file.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/server apps/console/src/shared apps/console/src/app/wiring/outline.ts
git commit -m "console: anatomy, source, changes and discard routes"
```

### Task 7: Client hooks

**Files:**
- Modify: `apps/console/src/app/wiring/useWiring.ts`
- Test: `apps/console/src/app/wiring/useWiring.test.tsx`

**Interfaces:**
- Produces:

```ts
export type SkillsAnatomy = InferResponseType<typeof client.api.skills.anatomy.$get, 200>;
export type SkillsSource = InferResponseType<typeof client.api.skills.source.$get, 200>;
export type SkillsChanges = InferResponseType<typeof client.api.skills.changes.$get, 200>;
export function useAnatomy(pack: string | null, skill: string | null): UseQueryResult<SkillsAnatomy, Error>;
export function useSkillSource(pack: string | null, path: string | null): UseQueryResult<SkillsSource, Error>;
export function usePendingChanges(pack: string | null): UseQueryResult<SkillsChanges, Error>; // refetchInterval 15_000, refetchOnWindowFocus true
export function useDiscardChanges(pack: string): UseMutationResult<unknown, Error, void>;
// useSkillsSync(pack).mutate({ commitPending?: boolean })
```

Query keys: `['skills','anatomy',pack,skill]`, `['skills','source',pack,path]`, `['skills','changes',pack]`. `invalidateSkillsQueries(qc, pack)` also invalidates `['skills','anatomy',pack]` and `['skills','changes',pack]`.

- [ ] **Step 1: Failing tests** in `useWiring.test.tsx` with the file's `vi.mock('../api')` pattern: `useAnatomy('acme','stage-plan')` calls `anatomy.$get({ query: { pack: 'acme', skill: 'stage-plan' } })`; `useAnatomy(null, 'x')` makes no call; a `bind` success invalidates the anatomy and changes keys (spy on `queryClient.invalidateQueries`); `useSkillsSync('acme').mutate({ commitPending: true })` posts `{ pack: 'acme', commitPending: true }`.

- [ ] **Step 2: Run, expect FAIL.** `cd apps/console && bunx vitest run src/app/wiring/useWiring.test.tsx`

- [ ] **Step 3: Implement** following `useSkillsCheck`'s shape for the three queries and `useSkillsSync`'s for discard; extend the sync mutation variables to `{ commitPending?: boolean } | void`.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** `git commit -am "console: hooks for anatomy, source and pending changes"`

---

## Part C: design assets and parity tooling

### Task 8: Design file, exports and board-fix list in the repo

Prerequisite: Matt has saved `~/Documents/console pipeline.pen` in pen.dev.

**Files:**
- Create: `docs/apps/design/console/console.pen`, `docs/apps/design/console/README.md`, `docs/apps/design/console/parity/<slug>.<light|dark>.html`, `docs/apps/design/console/renders/<slug>.<light|dark>.png`

- [ ] **Step 1: Move the file:** `mv "$HOME/Documents/console pipeline.pen" docs/apps/design/console/console.pen`, then `open docs/apps/design/console/console.pen` so Pencil's active canvas is the repo copy (confirm with `get_app_state`).

- [ ] **Step 2: Prune exploration boards with Matt's OK** (ask once): delete every top-level frame whose name does not start with `Template ·`, `Drawer ·` or `Unsynced ·`. Matt saves.

- [ ] **Step 3: Export.** For each slug and frame id below, run `Export([id], "html-css", "docs/apps/design/console/parity/<slug>.<scheme>.html", { includeLayerNames: true })` and `Export([id], "png", "docs/apps/design/console/renders", { scale: 1 })` (rename the PNG to `<slug>.<scheme>.png`), each export in its own `execute` call:

| slug | light | dark | route |
|---|---|---|---|
| template-work | `lC5eZ` | `T2xm1n` | `/wiring?tab=graph&focus=pipeline:feature` |
| template-plan | `I4dEtA` | `E3EwS` | `/wiring?tab=graph&focus=stage-plan` |
| drawer-text-range | `BdTVo` | `kDP83` | `...&focus=pipeline:feature&select=row:1` |
| drawer-include-row | `dXMWN` | `Z5jhtb` | `...&focus=stage-plan&select=row:140` |
| drawer-input-card | `JG4X2` | `S30e79` | `...&focus=stage-plan&select=input:include:gate-protocol&drawerTab=used-by` |
| drawer-history | `vS78O` | `MlMLL` | `...&focus=stage-plan&select=output&drawerTab=history` |
| drawer-rebind | `arHq7` | `yyN81` | `...&focus=stage-plan&select=row:136&rebind=1` + action: open the Select, pick `plan-policy-strict` |
| unsynced-banner | `S9Mvq` | `sNfzF` | scenario `unsynced`, `...&focus=stage-plan` |
| unsynced-confirm | `dkOZg` | `V9BST` | scenario `unsynced`, `...&focus=stage-plan` + action: click "Sync changes" |

(Frame ids are from the scratch file; after the move, list frames with `Get(n => n.type === "frame" && Print(n.id, n.name), { depth: 0 })` and use the ids it prints.)

- [ ] **Step 4: Write `docs/apps/design/console/README.md`** with: the board table above; "Kit chrome is not compared" (rail, app bar, PageShell tab bar, Drawer frame, Modal frame, Select dropdown); and the **board-fix list** (kit wins; each item is expected in parity, not fixed in the app): Drawer shadow and border (Mantine Drawer), Modal frame and button sizes (kit `modals.confirm`), Select chevron and dropdown shadow (Mantine Select), Badge/Alert padding (Mantine defaults), SegmentedControl track (Mantine). Add any further kit-vs-board differences found in later tasks to this list in the task that finds them, never silently.

- [ ] **Step 5: Purity and commit.** `bun run purity`; then

```bash
git add docs/apps/design/console
git commit -m "design: console pipeline viewer boards, exports and renders"
```

### Task 9: Lift the parity harness to `scripts/parity`

**Files:**
- Move: `apps/boxscore/scripts/parity/{collect.js,run.js,compare.ts,pen.ts,compare.test.ts,pen.test.ts}` to `scripts/parity/`
- Keep: `apps/boxscore/scripts/parity/{boards.ts,harness.ts,run.md}`
- Modify: boxscore imports, `run.md` paths, turbo inputs if a test reads moved files

- [ ] **Step 1:** `git mv` the six files to `scripts/parity/`. Run `rg -n "parity/(collect|run|compare|pen)" apps scripts docs` and update every import and path (boxscore `harness.ts`, `run.md`).
- [ ] **Step 2:** Anything in the moved files that names boxscore (port numbers, board table import, output stem prefix) becomes a parameter read from the per-app `harness.ts` config the runner already receives; boxscore's `harness.ts` passes its current values. No behaviour change for boxscore.
- [ ] **Step 3:** Run `bun test scripts/parity` and the boxscore parity unit tests from their new location; run `bun run boxscore:test`. **Expect PASS.**
- [ ] **Step 4: Commit** `git commit -m "parity: lift the board harness to scripts/parity for every app"`

### Task 10: Console design fixtures and parity config

**Files:**
- Create: `apps/console/src/server/fixtures/design/{composition.json,check.json,changes.clean.json,changes.unsynced.json,anatomy.work.json,anatomy.stage-plan.json,anatomy.stage-plan.unsynced.json,history.json}` and `apps/console/src/server/fixtures/design/files/**` (the template and rendered texts the boards show)
- Create: `apps/console/src/server/fixtures/design/fixtureRt.ts`
- Modify: `apps/console/src/server/index.ts`
- Create: `apps/console/scripts/parity/{boards.ts,harness.ts,run.md}`
- Test: `apps/console/src/server/fixtures/design/fixtureRt.test.ts`

**Interfaces:**
- Produces: `fixtureRt(scenario: 'clean' | 'unsynced'): { runRt: RunRt; readPackFile: ReadPackFile; realpath: (p: string) => Promise<string> }`; env `CONSOLE_FIXTURE=design`, `CONSOLE_FIXTURE_SCENARIO=clean|unsynced`.

- [ ] **Step 1: Author the fixtures to match the boards exactly**, pack `acme`, pack dir `/fixture/packs/acme`, engine root `/fixture/mattstack`:
  - composition: pipeline `feature` = the 8 `mattstack:stage-*` refs; verbs `work`, `shepherdr`, `review`, `self-review`, `receive-review`, `ship`, `watch-ci`, the 5 unwired verbs; board binders; fills and binders as on the boards (`acme:plan-policy`, `acme:plan-policy-strict`, `acme:plan-policy-lite` all `plan-domain@1`); `targets` with the template placeholder lines the boards show (work: L29-36 verb.path, L40, L242, L246, L250; stage-plan: L16, L76, L136, L140, L144).
  - check: `in-sync` for all but `work`, `review`, `stage-evidence`, `stage-ship`, `stage-watch-ci` (`staleBecause: ["source"]`).
  - anatomy.work: template 250 lines, rendered 824, parts exactly the work board rows (text L1-28; 8 verb.path rows with targets and line counts 777, 780, 212, 1152, 91, 105, 1091, 1116; text L37-39; L40; text L41-241; L242 slot tiering; text L243-245; L246 include; text L247-249; L250 include).
  - anatomy.stage-plan: template 144 lines, built 0.28.10, installed 0.30.4, rendered 780; parts L1-15, L16, L17-75, L76 (149 lines), L77-135, L136 (80 lines, rendered L223-302), L137-139, L140 (450 lines, rendered L303-752), L141-143, L144 (28 lines); links `../../attachments/gates/SKILL.md`, `../../attachments/evidence/SKILL.md`, `../../attachments/dev-servers/SKILL.md`.
  - anatomy.stage-plan.unsynced: the same with slot `domain` bound to `acme:plan-policy-strict` (64 lines, rendered share 8%).
  - changes.unsynced: one binding change `mattstack:stage-plan` `domain` `acme:plan-policy` to `acme:plan-policy-strict`, `files: [{ path: 'pack/skills.jsonc', status: 'M' }]`.
  - files: `work/SKILL.md` lines 1-44 as in the drawer board; `stage-plan` rendered lines 288-330 as in the include-row board (plan-policy text then the gate-protocol opening); other lines padded with plain prose so line counts match.
- [ ] **Step 2: Write `fixtureRt.ts`** mapping argv (`composition`, `check`, `anatomy --skill X`, `changes`, `discard`, `sync`) to the JSON for the scenario, and `readPackFile`/`realpath` to `files/` under the fixture root. Test: each argv maps to its file; an unknown argv returns exit 1.
- [ ] **Step 3: Mount it** in `server/index.ts`: when `process.env.CONSOLE_FIXTURE === 'design'`, pass the fixture runner, reader and realpath to `mountSkills`. Never active otherwise (test: without the env var the live runner is used).
- [ ] **Step 4: Parity config.** `apps/console/scripts/parity/boards.ts` lists the nine slugs from Task 8 with route, scenario, roots (`Focus list` is kit `PageShell.Sidebar` content and IS compared; roots: `Focus list`, `Focus header`, `Stage` for canvas boards, plus `Drawer` contents and `Banner · unsynced` / `Modal · sync changes` contents where present) and actions. `harness.ts` starts `CONSOLE_FIXTURE=design CONSOLE_FIXTURE_SCENARIO=<scenario> PORT=11097 bun src/server/index.ts` and `bunx vite --port 5307 --strictPort` with `/api` proxied to 11097. `run.md` is the console runbook: the same steps as boxscore's, with console ports and slugs.
- [ ] **Step 5: Run** `cd apps/console && bunx vitest run src/server/fixtures` **expect PASS**; `bun run purity`.
- [ ] **Step 6: Commit** `git commit -m "console: design fixtures and parity config"`

---

## Part D: UI

Every task in Part D ends with this **parity step** for the slugs it lists:

1. Start the fixture server and Vite per `apps/console/scripts/parity/run.md`.
2. In one Fast Browser `browser_run_code_unsafe` call, run `scripts/parity/run.js` with `{ slug, scheme }` for each listed slug in `light` and `dark` (load `http://localhost:5307/...`; `page.emulateMedia({ colorScheme })`).
3. Run `bun scripts/parity/compare.ts <design.json> <app.json> <slug>` for each.
4. Take a Fast Browser screenshot of each slug and scheme and view it beside `docs/apps/design/console/renders/<slug>.<scheme>.png`.
5. **0 mismatches** outside the README's board-fix list, or the task is not done. Fix and rerun. Any new kit-vs-board difference goes on the board-fix list with a one-line reason.

### Task 11: Kit `CodeLines`

**Files:**
- Create: `packages/ui/src/core/code-lines/CodeLines.tsx`, `CodeLines.module.css`, `CodeLines.stories.tsx`, `CodeLines.test.tsx`
- Modify: `packages/ui/src/core/index.ts` (named export)

**Interfaces:**
- Produces:

```ts
export type CodeLinesBand = { from: number; to: number; label: string; tone?: 'accent' | 'muted' };
export interface CodeLinesProps {
  lines: string[];
  firstLine?: number;              // line number of lines[0], default 1
  highlight?: [number, number] | null;
  bands?: CodeLinesBand[];         // gutter label column; omitted when empty
  tintPattern?: RegExp;            // lines matching render in accent text (placeholders)
  height: number;                  // viewport height in px
  scrollTo?: number | null;        // line number to bring to the top
}
export function CodeLines(props: CodeLinesProps): JSX.Element;
```

Built from `ScrollArea` (Mantine) with a virtualised row list (render only the rows in view plus 20 overscan; row height 19px), `Text` with `ff="monospace"` and `size="xs"`, and a CSS module for layout. Highlighted rows use `--tk-wash-accent`-equivalent role through the module (`background-color: var(--mantine-color-accent-light)`), band column `border-right: 2px solid var(--mantine-color-accent-filled)` for the active band; no raw colours.

- [ ] **Step 1: Failing tests** `CodeLines.test.tsx`: renders line numbers from `firstLine`; rows inside `highlight` carry `data-highlighted`; a band's label renders once at its first row; with 2,000 lines only rows near `scrollTo` are in the DOM (`queryByText('line 1990')` present after `scrollTo: 1980`, `queryByText('line 10')` absent).
- [ ] **Step 2: Run, expect FAIL.** `cd packages/ui && bunx vitest run src/core/code-lines`
- [ ] **Step 3: Implement** with tree-shake rules (`/* @__PURE__ */` on any top-level factory call; no top-level mutations). Story: plain, highlighted, banded, 2,000 lines.
- [ ] **Step 4: Run** tests, `bun run treeshake`, `bun run build-storybook` **expect PASS**.
- [ ] **Step 5: Commit** `git commit -m "kit: CodeLines for line-numbered text with highlights and bands"`

### Task 12: Pure view models

**Files:**
- Create: `apps/console/src/app/wiring/graph/model/{focusModel.ts,templateModel.ts,drawerContent.ts}` and `__tests__/` for each
- Test fixtures: import the Task 10 design JSON (it is invented data)

**Interfaces:**
- Consumes: `buildSpine`, `WiringSpine`, `SpineEntry` (outline.ts), `SkillsComposition`, `SkillsCheck`, `SkillsAnatomy`, `SkillsChanges` (Task 7).
- Produces:

```ts
// focusModel.ts
export type FocusItem = { key: string; label: string; skill: string; icon: 'workflow' | 'terminal' | 'lock' | 'layoutDashboard'; step: number | null; attention: boolean; children: FocusItem[] };
export type FocusGroups = { pipelines: FocusItem[]; onDemand: FocusItem[]; board: FocusItem[]; unwired: { count: number; attention: boolean }; empty: 'no-pipeline' | null };
export function buildFocusGroups(composition: SkillsComposition, check: SkillsCheck | undefined): FocusGroups;
export function onlyAttention(groups: FocusGroups): FocusGroups;
export function findFocus(groups: FocusGroups, key: string): FocusItem | null;
// keys: `pipeline:<workType>` (skill = orchestrator), `<skill name>` for steps, verbs and board binders, `unwired`

// templateModel.ts
export type RowState = 'ok' | 'optional-unbound' | 'required-unbound' | 'no-matching-fill' | 'resolve-error' | 'referenced' | 'unsynced';
export type TemplateRow =
  | { id: string; kind: 'text'; gutter: string; label: string; templateLines: [number, number]; renderedLines: [number, number] | null }
  | { id: string; kind: 'placeholder'; placeholder: 'include' | 'slot' | 'verb.path' | 'variable'; gutter: string; code: string; templateLine: number; renderedLines: [number, number] | null; state: RowState; name: string | null };
export type InputCard = { id: string; rowId: string; title: string; subtitle: string; icon: 'fileText' | 'cpu'; path: string | null; subtitleTone: 'dimmed' | 'accent'; state: RowState };
export type LinkCard = { id: string; rowId: string; skill: string; title: string; subtitle: string; status: 'in-sync' | 'stale' | 'never-compiled' };
export type OutputCard = { step: number | null; title: string; lines: number; status: 'in-sync' | 'stale' | 'never-compiled' | 'unsynced'; parts: { id: string; label: string; lines: number; share: number; own: boolean }[]; links: { label: string; path: string }[] };
export type TemplateView = { skill: string; templateFile: string; templateMeta: string; rows: TemplateRow[]; inputs: InputCard[]; links: LinkCard[]; output: OutputCard | null; textNoun: 'orchestrator' | 'step' | 'verb' };
export function buildTemplateView(input: { anatomy: SkillsAnatomy; composition: SkillsComposition; check: SkillsCheck | undefined; changes: SkillsChanges | undefined; step: number | null }): TemplateView;

// drawerContent.ts
export type DrawerTarget = { kind: 'row'; line: number } | { kind: 'input'; id: string } | { kind: 'output'; part: string | null } | { kind: 'link'; path: string };
export type DrawerTab = 'text' | 'used-by' | 'history';
export type DrawerContent = { filePath: string; fileLabel: string; badge: 'template' | 'partial' | 'pack text' | 'rendered'; canToggle: boolean; view: 'template' | 'rendered'; chip: string | null; sentence: string; highlight: { template: [number, number] | null; rendered: [number, number] | null }; bands: { from: number; to: number; label: string; tone: 'accent' | 'muted' }[]; tabs: DrawerTab[]; slot: { name: string; contract: string | null } | null };
export function parseTarget(select: string | null): DrawerTarget | null; // 'row:140' | 'input:include:gate-protocol' | 'output' | 'output:include:gate-protocol' | 'link:<path>'
export function drawerContent(target: DrawerTarget, view: TemplateView, anatomy: SkillsAnatomy, requestedView: 'template' | 'rendered' | null): DrawerContent;
```

Copy rules (all derived, and they must equal the boards):
- text row label: `"N lines of <noun> text"` for N > 3, else `"N lines"`; gutter `L<a>-<b>` (hyphen) or `L<a>` for one line.
- placeholder code: `{{include:<name>}}`, `{{slot:<name>}}`, `{{verb.path:<name>}}`, variables `{{<name>}}`.
- input title `<name>/SKILL.md`; variable cards titled `run fields` (`stage.fields`) or `run flags` (`run-start.flags:*`) with subtitle `variable · rt fills this in for each run`; include subtitle `partial · <plugin> · <lines> lines`; slot subtitle `written by <pack> · <lines> lines` (accent) when the fill's plugin is the pack, else `<plugin> default · picked by this pack`.
- link title `stage-<name>/SKILL.md`, subtitle `step N · rendered · L lines`, or for stale `step N · stale: its template changed` (`source`), `a pasted file changed` (`include`), `its pack text changed` (`fill`), `its header changed` (`frontmatter`), `its files changed` (`structure`, `vendored`).
- output parts: own text first labelled `step text`, then each include/slot by name with lines and share (rounded percent of rendered lines); links labelled by the file's directory name plus `/SKILL.md`.
- drawer sentences: text row `"<N> lines of <noun> text, as written in the template."`; include row `"<name> is pasted here: <lines> lines, <share>% of what the agent reads in this step."`; slot row `"The <slot> slot. This pack fills it with <fill>: <lines> lines."`; input card `"A <plugin> partial. <n> skills in this pack paste it in."` (pack text: `"Written by <pack>. <n> skills in this pack use it."`); output `"In sync. <lines> lines, rendered from <files> files."` (stale: `"Stale: <reason>."`; unsynced: `"Rebuilt here, not synced yet."`).
- chip: text row `L1-28`; include or slot row `L140 -> L303-752`.

- [ ] **Step 1: Failing tests** (one file per module). focusModel: the design composition gives one pipeline with 8 children labelled `provision` to `watch-ci` numbered 1-8, on-demand `shepherdr, review, self-review, receive-review, ship, watch-ci` with `review` flagged, board `board:review, board:respond, board:doctor`, unwired count 6; a pack whose manifest declares two pipelines yields two pipeline items; a pack with no pipeline sets `empty: 'no-pipeline'`; `onlyAttention` keeps `work`, its stale children, `review` and unwired. templateModel: `anatomy.work` yields 17 rows whose gutters and labels equal the work board's rows exactly, 4 inputs and 8 links with the board's subtitles (stale ones per check); `anatomy.stage-plan` yields 10 rows, 5 inputs and an output card whose parts are `step text 64 · 8%`, `execution-strategy 149 · 19%`, `plan-policy 80 · 10%`, `gate-protocol 450 · 58%`, `wrap-up-form 28 · 4%`; a slot with `mode: 'reference'` gives state `referenced`; a required slot with no source gives `required-unbound`; the unsynced changes give the slot row and input state `unsynced`; a legacy anatomy (templateLines null) gives rows with gutter `rendered L5-6`; a never-compiled anatomy gives output status `never-compiled`. drawerContent: each board's chip and sentence; `row:140` defaults to `rendered` with highlight `[303, 752]` and bands for `plan-policy` and `gate-protocol`; an input defaults to tab `text`; `parseTarget('row:1')` is `{ kind: 'row', line: 1 }`.
- [ ] **Step 2: Run, expect FAIL.** `cd apps/console && bunx vitest run src/app/wiring/graph/model`
- [ ] **Step 3: Implement** the three modules (pure, no React). `buildFocusGroups` classifies through `buildSpine` per work type so it agrees with today's spine (orchestrator, stages, outside, external, unwired, orphans).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "console: pure focus, template and drawer models"`

### Task 13: URL state

**Files:**
- Create: `apps/console/src/app/wiring/graph/useWiringUrl.ts`, `__tests__/useWiringUrl.test.ts`
- Modify: spec's URL section to name `focus`, `select`, `drawerTab`, `view`, `rebind`

**Interfaces:**

```ts
export type WiringUrl = { tab: 'graph' | 'surface' | 'health'; pack: string | null; focus: string | null; select: string | null; drawerTab: DrawerTab; view: 'template' | 'rendered' | null; rebind: boolean; attention: boolean };
export function parseWiringUrl(search: string): WiringUrl;
export function formatWiringUrl(state: WiringUrl): string; // omits defaults
export function useWiringUrl(): [WiringUrl, (patch: Partial<WiringUrl>) => void];
```

Defaults: `tab: 'graph'`, `drawerTab: 'text'`, others null/false. `attention=1` maps to `attention: true` (the rail badge's existing link). Changing `focus` clears `select`, `rebind` and `view`.

- [ ] **Step 1: Failing tests:** round-trip of every field; `?attention=1` parses; unknown values fall back to defaults; `patch({ focus: 'stage-plan' })` clears `select`.
- [ ] **Step 2: Run, expect FAIL.** `cd apps/console && bunx vitest run src/app/wiring/graph/__tests__/useWiringUrl.test.ts`
- [ ] **Step 3: Implement** with wouter's `useSearch` and `navigate` from `wouter/use-browser-location` (`replace: true` for `select`/`drawerTab`/`view`, push for `focus`/`tab`).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "console: wiring URL state"`

### Task 14: React Flow dependency, icons and layout

**Files:**
- Modify: root `package.json` (`workspaces.catalog["@xyflow/react"]: "^12"`), `apps/console/package.json` (`"@xyflow/react": "catalog:"`), `bun.lock`
- Create: `apps/console/src/app/icons.ts`, `apps/console/src/app/app-icons.d.ts`; modify `apps/console/src/main.tsx` (`import './app/icons';` first)
- Create: `apps/console/src/app/wiring/graph/layout/templateLayout.ts`, `__tests__/templateLayout.test.ts`

**Interfaces:**
- Produces: icons `workflow, layoutDashboard, fileText, fileCode, cpu, circleDot, replace, arrowUpRight, squareTerminal` registered (lucide `Workflow, LayoutDashboard, FileText, FileCode, Cpu, CircleDot, Replace, ArrowUpRight, SquareTerminal`), following `apps/chat/src/app/icons.ts`.

```ts
export const LAYOUT = { inputX: 40, inputW: 330, cardH: 40, templateX: 470, templateW: 420, headerH: 40, textRowH: 24, placeholderRowH: 30, linkRowH: 46, rightX: 990, rightW: 330 } as const;
export type LayoutResult = { nodes: Node[]; edges: Edge[]; height: number };
export function layoutTemplate(view: TemplateView): LayoutResult;
```

Nodes: `template` (type `'template'`, position `{ x: templateX, y: 0 }`, data `{ view }`), one `'input'` per input card centred on its row (`y = rowCentre - cardH / 2`), one `'link'` per link card centred on its row, `'output'` at `{ x: rightX, y: 0 }` when `view.output`. Edges: input to template `targetHandle: 'row:<rowId>'`; template `sourceHandle: 'row:<rowId>'` to link; template `sourceHandle: 'out'` to output with `label: 'render'`. All edges `type: 'default'`, `markerEnd: { type: MarkerType.ArrowClosed }`. Row heights: text `textRowH`, placeholder `placeholderRowH`, verb.path placeholder `linkRowH`.

- [ ] **Step 1: Add the dependency:** edit both `package.json` files, run `bun install` at the root (no member lockfile).
- [ ] **Step 2: Register icons** and type them; `bun run console:typecheck` passes.
- [ ] **Step 3: Failing layout tests:** for the work view, the `run flags` input's centre equals the L40 row's centre; link cards sit at `rightX`; every edge's handle id names an existing row; for the plan view, an output node exists and the `render` edge leaves handle `out`.
- [ ] **Step 4: Run, expect FAIL**, implement, **run, expect PASS.** `cd apps/console && bunx vitest run src/app/wiring/graph/__tests__/templateLayout.test.ts`
- [ ] **Step 5: Commit** `git commit -m "console: react flow dependency, icons and template layout"`

### Task 15: Graph tab shell, focus list and header

**Files:**
- Create: `apps/console/src/app/wiring/graph/{GraphTab.tsx,FocusList.tsx,FocusHeader.tsx,graph.module.css}`, `__tests__/GraphTab.test.tsx`
- Modify: `apps/console/src/app/wiring/WiringMap.tsx`

**Interfaces:**
- Consumes: `useWiringUrl`, `buildFocusGroups`, `onlyAttention`, `findFocus`, `useComposition`, `useSkillsCheck`, `useAnatomy`, `buildTemplateView`.
- Produces: `<GraphSidebar pack />` (rendered by `WiringMap` as `PageShell.Sidebar` content when `tab === 'graph'`) and `<GraphTab pack />` (rendered in `PageShell.Content` with `bg="var(--tk-bg)"`, `contentContainer={false}`, children as `(height) => ...`).

Implementation notes:
- `WiringMap`: tabs become `graph` (label `Graph`, icon `workflow`), `surface`, `health`; tab state moves to `useWiringUrl().tab`; Health's `onOpenSkill(name)` patches `{ tab: 'graph', focus: name }`. Root `PageShell` gets `sidebarWidth={216}` and `drawerStateKey="console-wiring-focus"`; render `<PageShell.Sidebar hideCollapseButton>` only for the graph tab, before `PageShell.Main`, exactly as `SettingsPage.tsx:243-257` does.
- `FocusList`: Mantine `NavLink` rows (`active`, `leftSection` with `Icon`, `rightSection` with a count `Text` and an attention dot `ColorSwatch`-free `Indicator`-free plain `Box` dot from the CSS module using `--tk-dot-warn`); group labels `Text size="xs" tt="uppercase" c="dimmed"`; pipeline items expand to numbered step `NavLink`s (`childrenOffset`); an `Unwired` row at the bottom; a `Switch` "Needs attention" bound to `attention`. Loading: `Skeleton`s; error: `Alert` with Retry `Button`; `empty: 'no-pipeline'`: `Text` "This pack declares no pipeline."
- `FocusHeader`: title `Title order={3}`, `Badge variant="light" color="gray"` (e.g. `feature pipeline · 8 stages`, `stage 2 of 8 · work · feature`, `public verb`), description `Text size="sm" c="dimmed"`, status `Badge variant="outline"` on the right (`in sync with installed mattstack 0.30.4` with `circleCheck`, `stale: <reason>` with `circleDot` color `warn`, `rebuilt here, not synced yet` color `warn`); column headers (three `Text` pairs) positioned by the canvas, not the header.
- `GraphTab` holds the `Suspense` + `React.lazy(() => import('./TemplateCanvas'))` boundary and passes `layoutTemplate(view)`.

- [ ] **Step 1: Failing tests** (vi.mock the api with the design fixtures): Graph tab renders the focus list with the board's groups; clicking `plan` sets `focus=stage-plan` in the URL; `?attention=1` checks the switch and hides in-sync items; Health's open-skill lands on the Graph tab with that focus; the old Pipeline and On-demand tabs are gone.
- [ ] **Step 2: Run, expect FAIL.** `cd apps/console && bunx vitest run src/app/wiring/graph/__tests__/GraphTab.test.tsx src/app/wiring/__tests__`
- [ ] **Step 3: Implement**, updating the existing WiringMap tab tests to the new tab set.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "console: graph tab shell with focus list in PageShell sidebar"`

### Task 16: Template canvas and nodes

**Files:**
- Create: `apps/console/src/app/wiring/graph/TemplateCanvas.tsx`, `nodes/{TemplateNode.tsx,InputCardNode.tsx,LinkCardNode.tsx,OutputNode.tsx,nodes.module.css}`, `__tests__/TemplateCanvas.test.tsx`

**Interfaces:**
- Consumes: `LayoutResult`, `TemplateView`, `useWiringUrl`.
- Produces: `TemplateCanvas({ layout, view, height, onSelect(select: string) })` default export; clicking a row calls `onSelect('row:<firstLine>')`, an input `onSelect('input:<id>')`, the output or a part `onSelect('output' | 'output:<partId>')`, a link card navigates `focus=<skill>`, a links chip `onSelect('link:<path>')`.

Implementation notes:
- `ReactFlow` with `nodeTypes` (stable object outside the component), `fitView`, `fitViewOptions={{ padding: 0.08 }}`, `nodesDraggable={false}`, `nodesConnectable={false}`, `proOptions={{ hideAttribution: true }}`, `colorMode` from `useComputedColorScheme()`; `<Background variant={BackgroundVariant.Dots} gap={22} size={2} color="var(--tk-line-2)" bgColor="var(--tk-bg)" />`; `<Controls showInteractive={false} position="bottom-left" />`. Import `@xyflow/react/dist/base.css` only.
- Nodes are Mantine `Paper` (`withBorder`, `radius="md"`) with a header `Group` on `bg="var(--tk-raised)"` via the CSS module; rows are `UnstyledButton` with `data-selected`; gutters `Text ff="monospace" size="xs" c="dimmed"`; placeholder code `Text ff="monospace" c="accent"`; state tags `Badge size="xs" variant="light" color="warn"` (`unsynced`, `required, nothing bound`), `color="bad"` for resolve errors. `Handle`s are React Flow handles styled by the CSS module as the board's 8px ring (`--tk-card` fill, `--tk-line-1` border).
- Input cards: `Paper withBorder radius="md"` with `Icon` (`fileText`/`cpu`), monospace title, `Text size="xs"` subtitle (`c="accent"` for pack text); link cards add the status dot and `chevronRight`.
- Output node: header with step number, `plan`, `780 lines`, status dot; body `Text size="xs" fw={500}` "What's in the N lines", `Progress.Root` with one `Progress.Section` per part (own text `color="accent"`, others `color="gray"`), the part list, and "Its text links to" with `Badge` chips (`leftSection` `arrowUpRight`).
- Column headers ("SUBSTITUTED IN", "TEMPLATE", "RENDERED" or "LINKS TO") render as a React Flow `Panel` row aligned to the layout's x positions at the current zoom (use `useViewport()`), copy as on the boards.

- [ ] **Step 1: Failing tests** (React Flow under jsdom needs `ResizeObserver` and `DOMMatrixReadOnly` stubs: add them to `vitest.setup.ts`): the plan view renders 10 rows with the board's gutters, 5 input titles, the output's part list; clicking the L140 row calls `onSelect('row:140')`; clicking the `stage-plan/SKILL.md` link card on the work view patches `focus=stage-plan`.
- [ ] **Step 2: Run, expect FAIL**, implement, **run, expect PASS.** `cd apps/console && bunx vitest run src/app/wiring/graph/__tests__/TemplateCanvas.test.tsx`
- [ ] **Step 3: Parity step** for `template-work`, `template-plan` (light and dark). 0 mismatches.
- [ ] **Step 4: Commit** `git commit -m "console: template canvas and nodes at board parity"`

### Task 17: Drawer shell and Text tab

**Files:**
- Create: `apps/console/src/app/wiring/graph/drawer/{SkillDrawer.tsx,TextTab.tsx,DrawerMenu.tsx,drawer.module.css}`, `__tests__/SkillDrawer.test.tsx`
- Modify: `GraphTab.tsx` (mount the drawer, wire `onSelect`)

**Interfaces:**
- Consumes: `parseTarget`, `drawerContent`, `useSkillSource`, `CodeLines` (Task 11), `useDrawerSurface`, `useWiringUrl`.
- Produces: `SkillDrawer({ pack, view, anatomy, url, setUrl })`; open when `url.select` parses.

Implementation notes:
- Mantine `Drawer` `opened`, `position="right"`, `size={600}`, `withOverlay={false}`, `lockScroll={false}`, `trapFocus={false}`, `onClose={() => setUrl({ select: null, rebind: false })}`, `styles` from `useDrawerSurface()`; title area: `Icon fileCode`, monospace path, `Badge variant="light" color="gray"` kind; `SegmentedControl` Template/Rendered when `canToggle` (disabled Rendered when `!anatomy.rendered.exists`); `DrawerMenu` (`Menu` + `ActionIcon variant="default"` with `moreHorizontal`: Copy rendered text, Copy path, Open in editor shown only when the file is under the pack's `packDir`); close.
- Context line: chip `Badge variant="light" color="accent" ff="monospace"`, sentence `Text size="sm" c="dimmed"`.
- `Tabs` with `Tabs.List` (Text, Used by · N when the target is a partial or pack text, History).
- `TextTab`: `useSkillSource(pack, path)` for the template or rendered file; `CodeLines` with `highlight`, `bands`, `tintPattern={/\{\{[^}]+\}\}/}`, `scrollTo={highlight[0] - 3}`; height from the drawer body.
- Keyboard: when the drawer is open, ArrowUp/ArrowDown move `select` to the previous/next template row (`useHotkeys` from `@mattstack/app-kit/hooks`); Escape closes.
- Copy rendered text reuses `splitCompiledBody` + `buildAgentContext` from `agentContext.ts` (today's Copy agent context) and reports with `notifications.success('Copied')`.

- [ ] **Step 1: Failing tests:** `select=row:1` on the work view opens the drawer on the template with lines 1-28 highlighted and the chip `L1-28`; `select=row:140` on plan opens on Rendered with band labels `plan-policy` and `gate-protocol` and the board's sentence; ArrowDown moves to the next row; Escape clears `select`; the menu hides Open in editor for an engine file under the plugin cache.
- [ ] **Step 2: Run, expect FAIL**, implement, **run, expect PASS.** `cd apps/console && bunx vitest run src/app/wiring/graph/__tests__/SkillDrawer.test.tsx`
- [ ] **Step 3: Parity step** for `drawer-text-range`, `drawer-include-row`.
- [ ] **Step 4: Commit** `git commit -m "console: compiled skill drawer with text tab at board parity"`

### Task 18: Drawer Used by and History tabs

**Files:**
- Create: `apps/console/src/app/wiring/graph/drawer/{UsedByTab.tsx,HistoryTab.tsx,BuiltFromTable.tsx}`, `__tests__/DrawerTabs.test.tsx`

**Interfaces:**
- Consumes: composition `targets[].placeholders` (Task 3) for include sites, `invertBindings`/binding sites (outline.ts) for slot sites, `buildFocusGroups` for grouping, `VersionTimeline` (props per `VersionTimeline.tsx:144`), `buildSpine` entry for the skill.
- Produces: `usedBySites(composition, groups, ref): { group: 'PIPELINE STEPS' | 'ON-DEMAND' | 'NOT WIRED INTO ANYTHING'; skill: string; line: number }[]` (pure, exported from `UsedByTab.tsx`'s sibling `usedBy.ts`).

Implementation notes:
- Used by: grouped `Stack`s with `Text size="xs" c="dimmed" tt="uppercase"` labels and `NavLink` rows (`leftSection` `fileText`, `label` monospace `<skill>/SKILL.md`, `rightSection` `Text size="xs" c="dimmed"` `pastes it at L<n>` and `chevronRight`); the current skill row `active` with `you are here · pastes it at L<n>`; clicking patches `focus`. A footer `Text size="xs" c="dimmed"`: "Edit it in the mattstack plugin. Every skill above picks up the change on its next compile." (pack text: "Edit it in this pack. Every skill above picks up the change when you sync.").
- History: `BuiltFromTable` is the kit `Table` (shadowed, `@mattstack/app-kit/core`) with columns file, built with, installed, status (`Icon check` + `unchanged`/`current`, or `Badge color="warn"` `changed`) from `anatomy.template` and each part's `source`; a note `Paper withBorder` with the plain sentence (unchanged-stamp case: "Its version stamp says <engine> <built>, but none of these files changed since. The text the agent reads is current; a rebuild would only update the stamp."); "ELSEWHERE IN THIS PIPELINE" lists stale steps as `NavLink`s with `stale: <reason>`; the command `Code` block `rt skills sync --pack <pack>` with the kit `CopyButton`; then `VersionTimeline` for the skill (existing component, unchanged).

- [ ] **Step 1: Failing tests:** `usedBySites` on the design composition gives 14 sites for `gate-protocol` grouped 6/5/3 with the lines on the board; History for plan shows five rows all `unchanged`/`current` and the note; for `stage-ship` it shows `changed` on the template row and no note.
- [ ] **Step 2: Run, expect FAIL**, implement, **run, expect PASS.** `cd apps/console && bunx vitest run src/app/wiring/graph/__tests__/DrawerTabs.test.tsx`
- [ ] **Step 3: Parity step** for `drawer-input-card`, `drawer-history`.
- [ ] **Step 4: Commit** `git commit -m "console: drawer used-by and history tabs at board parity"`

### Task 19: Rebind panel and public/internal switch

**Files:**
- Create: `apps/console/src/app/wiring/graph/drawer/RebindPanel.tsx`, `__tests__/RebindPanel.test.tsx`
- Modify: `SkillDrawer.tsx` (mount for slot rows when `url.rebind`, a "Change" `Button` on slot rows opens it; header `Switch` for public/internal on verbs, hidden for stages)

**Interfaces:**
- Consumes: `useSkillsApply(pack).bind`, `.surfaceApply`, composition fills (same-contract candidates), binding sites (where else each fill is bound), `modals.confirm`, `notifications`.
- Produces: `RebindPanel({ pack, skill, slot, composition, onDone })`.

Implementation notes:
- Layout per the rebind board: title row (`Icon replace`, `Text fw={700}` "Change what fills the <slot> slot"); facts (`Group` of three label/value pairs: contract, set by (layer via `layerLabel`), required); from/to row (current as a read-only `TextInput` with `leftSection` file icon and `rightSection` "now", `arrowRight`, then a `Select` of same-contract fills with `renderOption` showing `<plugin> · bound here now|bound nowhere|bound by N other skill(s)`); command `Code block` `rt skills bind <skill> <slot> <fill> --pack <pack>` plus "Writes the binding in this pack, then rebuilds <step>. Nothing is shared until you sync."; `Group justify="flex-end"` Cancel / Apply.
- Apply opens `modals.confirm({ title: 'Rebind the <slot> slot?', message: '<step> will use <fill> instead of <current>. Nothing is shared until you sync.', labels: { confirm: 'Apply' }, onConfirm: () => bind.mutate({ verb: skill, slot, fill }) })`; success `notifications.success('Rebound <slot> to <fill>')` and `setUrl({ rebind: false })`; error `notifications.error(message)` and the panel stays open.
- The switch: `Switch label="public"` checked from composition; change opens `modals.confirm` ("Make <skill> internal?" / "Make <skill> public?") then `surfaceApply.mutate`.

- [ ] **Step 1: Failing tests:** the Select lists only `plan-domain@1` fills with the board's descriptions; Apply opens a confirm and calls `bind.mutate({ verb: 'stage-plan', slot: 'domain', fill: 'acme:plan-policy-strict' })` only after confirming; Cancel in the confirm writes nothing; the switch is absent for stages and confirms before applying for verbs.
- [ ] **Step 2: Run, expect FAIL**, implement, **run, expect PASS.** `cd apps/console && bunx vitest run src/app/wiring/graph/__tests__/RebindPanel.test.tsx`
- [ ] **Step 3: Parity step** for `drawer-rebind`.
- [ ] **Step 4: Commit** `git commit -m "console: rebind panel and surface switch with kit confirms"`

### Task 20: Unsynced banner, Sync changes and Discard

**Files:**
- Create: `apps/console/src/app/wiring/graph/UnsyncedBanner.tsx`, `__tests__/UnsyncedBanner.test.tsx`
- Modify: `WiringMap.tsx` (banner across every tab via `PageShell` `topNotch={{ content: <UnsyncedBanner pack />, opened: changes.dirty }}`, or directly above `PageShell.Content` if `topNotch` does not span the sidebar; check `Content.tsx` and match the board)

**Interfaces:**
- Consumes: `usePendingChanges`, `useSkillsSync(pack).mutate({ commitPending: true })`, `useDiscardChanges`, `modals.confirm`, `notifications`.

Implementation notes:
- Mantine `Alert variant="light" color="warn" icon={<Icon name="circleDot" />}` with title "<n> unsynced change(s) in <pack>. Your Claude sessions still use the old version.", a change list (`Group` of monospace skill + description per binding/surface change, else file path), and actions `Button variant="default"` Discard and `Button leftSection={<Icon name="refreshCw" />}` Sync changes.
- Sync changes: `modals.confirm({ title: 'Sync <n> change(s)?', message: <Stack> with the board's copy, the change list in a `Paper withBorder`, and "Afterwards, run /reload-plugins in open Claude sessions to pick it up." </Stack>, labels: { confirm: 'Sync changes' }, confirmProps: { leftSection: <Icon name="refreshCw" /> }, onConfirm: () => sync.mutate({ commitPending: true }) })`. On a report whose `guards` step is `refused`, `notifications.error(detail)` (this is how out-of-scope edits surface); on success `notifications.success('Synced <pack>. Run /reload-plugins in open Claude sessions.')`.
- Discard: `modals.confirm({ destructive: true, title: 'Discard <n> change(s)?', message: 'This throws away the changes listed above in <pack>. It cannot be undone.', labels: { confirm: 'Discard' }, onConfirm: () => discard.mutate() })`.
- Unsynced tags come from Task 12's `state: 'unsynced'`; the header status from Task 15.

- [ ] **Step 1: Failing tests:** clean changes render no banner; the unsynced fixture renders the board's title and change line; Sync changes opens a confirm and posts `commitPending: true` only after confirming; a refused report shows the refusal detail in an error notification; Discard confirms destructively before posting.
- [ ] **Step 2: Run, expect FAIL**, implement, **run, expect PASS.** `cd apps/console && bunx vitest run src/app/wiring/graph/__tests__/UnsyncedBanner.test.tsx`
- [ ] **Step 3: Parity step** for `unsynced-banner`, `unsynced-confirm`.
- [ ] **Step 4: Commit** `git commit -m "console: unsynced banner with kit-confirmed sync and discard"`

### Task 21: Slot states, error and empty states

**Files:**
- Modify: nodes and drawer from Tasks 16-17; `GraphTab.tsx`
- Test: `apps/console/src/app/wiring/graph/__tests__/states.test.tsx`

Implementation notes (all copy from the spec's slot-state table):
- `optional-unbound`: row text "optional, nothing bound", no input card.
- `required-unbound`: warn row and warn input card "required, nothing bound" with a "Bind" `Button size="xs"` that opens the Rebind panel.
- `no-matching-fill`: warn card naming the missing fill.
- `resolve-error`: `color="bad"` card with rt's message.
- `referenced`: input subtitle "referenced: the rendered text links to it", row uses "links to" wording, drawer shows the rendered path line.
- Canvas errors: anatomy failure renders a centred `Alert color="bad"` with Retry; never-compiled output card "never compiled" with the Rendered toggle disabled; check failure keeps the canvas and shows an `Alert color="warn"` "Status unavailable: <message>" in the header.

- [ ] **Step 1: Failing tests** for each state above with fixture variants built from `anatomy.stage-plan.json`.
- [ ] **Step 2: Run, expect FAIL**, implement, **run, expect PASS.** `cd apps/console && bunx vitest run src/app/wiring/graph/__tests__/states.test.tsx`
- [ ] **Step 3: Visual check:** render each state in Fast Browser (fixture variants via `CONSOLE_FIXTURE_SCENARIO`), screenshot both schemes, and confirm each uses only the components and tokens named above; these states have no boards, so any doubt goes to Matt with the screenshots.
- [ ] **Step 4: Commit** `git commit -m "console: slot, error and empty states for the graph tab"`

### Task 22: Remove the old view, docs and full gates

**Files:**
- Delete: `SkillSplitLayout.tsx`, `SkillRow.tsx`, `SkillRow.module.css`, `OnDemandView.tsx`, `SummaryStrip.tsx`, `SkillDetailPanel.tsx`, `AttentionEmptyState.tsx`, `useSkillSelection.ts` (after moving `copyAgentContext` into `DrawerMenu`), and their tests
- Modify: `apps/console/AGENTS.md` (Wiring map section), `docs/apps/design/console/README.md`

- [ ] **Step 1:** Delete the files; `rg -n "SkillSplitLayout|SkillRow|OnDemandView|SummaryStrip|SkillDetailPanel|AttentionEmptyState|useSkillSelection" apps/console/src` returns nothing.
- [ ] **Step 2:** Update `apps/console/AGENTS.md`'s wiring section: the Graph tab, the template model, the drawer, the parity runbook path, and that `CONSOLE_FIXTURE=design` is the parity data source.
- [ ] **Step 3: Full gates:** `bun run test`, `bun run test:e2e`, `bun run console:test`, `bun run console:typecheck`, `bun run console:lint`, `bun run check`, `bun run purity`. All green.
- [ ] **Step 4: Final parity sweep:** all nine slugs, both schemes, 0 mismatches outside the board-fix list; screenshots of each beside its render posted in the PR.
- [ ] **Step 5: Commit** `git commit -m "console: retire the list-and-card wiring view"`
