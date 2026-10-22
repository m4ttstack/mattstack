# Skill blocks, plan 3 of 4: the console block view

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Console's Graph tab reads one skill at a time as a tree of blocks at three zoom levels, with a Layers panel, an "Around this block" graph and a Copy for Claude brief, replacing the template canvas, the side drawer and the Rebind panel.

**Architecture:** A `/api/skills/blocks` route passes `rt skills blocks --json` (plan 1, Task 10) through. Pure model modules under `apps/console/src/app/wiring/blocks/model/` turn that payload plus the URL into view data (zoom level, sidebar tree, section bands, layer charts, the small graph, the brief); components under `apps/console/src/app/wiring/blocks/` render them with kit chrome. The Graph tab keeps today's between-skills map as the "All skills" home: a focused pipeline (`work · feature`) still renders today's `TemplateCanvas` with its links to the stages; only a focused skill opens the block view.

**Tech Stack:** React, `@mattstack/app-kit` (core, icons, hooks), `@xyflow/react` for the small graph, vitest with `renderWithProviders`, Fast Browser for the mandatory render check in both schemes, the `dataviz` skill for the Layers charts.

**Spec:** `docs/superpowers/specs/2026-10-22-skill-blocks-design.md`, section "Console", and the renders in `docs/apps/design/console/skill-blocks/` (`skill`, `parent-block`, `block`, light and dark). The boards predate props: read a `{{fills}}` box as the block's prop and "Open" as "has props".

Depends on plan 1 Task 10's `BlocksPayload`. Plan 2 need not have landed: a slot engine simply has no block tree, and the view shows the fallback in Task 8.

## Global Constraints

- Kit chrome only: `MattstackShell`, `PageShell` with its sidebar and content; role tokens, no raw colors (`docs/apps/ui-authoring.md`; the `local/token-namespaces` lint fails anything else). Inter and JetBrains Mono at 400, 500, 700.
- Layer colors: mattstack is `--tk-line-1`; the org base is purple and the team is cyan from the kit's fill steps; accent only for links and selection; warn only for status.
- Sidebar glyphs: ○ step, ◇ question, ⚑ gate; a document icon for note blocks; top-level include blocks fold into one "Shared" row; an include inside another block shows under that block. A purple dot when the org base passes a value, cyan when the team does.
- Three zoom levels from the sidebar selection: the skill (every section a folded list, Layers for the whole skill), a parent block (breadcrumb, its text, its graph as a one-line card "N steps · M links · View graph", children as a folded list), a single block (breadcrumb, full title, path behind a ⋯ menu, text with each prop's value at its marker, Around this block).
- A folded row: kind glyph, short label, first-sentence summary, layer dots, a plug icon when the block has props. Paths and Open file only on the selected block. Prose rendered, never raw backticks.
- Each prop on a single block is a framed box at its marker: name, merge and default, each layer's value in its tint (org then team for `add`; the winning value for `replace`, the default shown when nothing is passed).
- Layers panel: "Where they add" (block map, one square per block, grouped by section, gray/purple/cyan/split, legend with counts), "How much text" (a stacked bar of lines by layer, labelled with its total; a replaced default counts toward the replacing layer), "This block, top to bottom" (L3 strip in block order, line counts).
- Around this block: one hop in and out plus cycles back to the block of three hops or fewer; layered layout on the React Flow canvas; a node matching a block is solid and opens it; others are muted outlines; a key; "View whole graph" opens the full graph.
- Copy for Claude: the brief in the spec's "Copy for Claude" section, verbatim shape; a popover confirms and shows it; built on `buildAgentContext` scoped to one block.
- Used by moves to shared blocks, History to every block; the Rebind panel goes; the unsynced banner stays.
- A non-block skill (a team's hand-written skill) opens in the same view with its headings parsed into a read-only tree.
- UI is not done until rendered in Fast Browser in both schemes and compared with the boards (`~/.claude/CLAUDE.md`, "UI validation is mandatory").

## Review Focus

1. A skill whose payload has a block with no title and no `label` (headless, id-labelled): the sidebar row must show the id in plain words, never an empty row. (Task 3.)
2. A block whose `node` is in a graph with a cycle longer than three hops back to it: Around this block must not include the far side of that loop, and must not loop forever building it. (Task 6 tests a 4-hop cycle.)
3. A URL `block=` naming an id that is not in the payload (a renamed block in a shared link): fall back to the skill level with a one-line note, not a blank page. (Task 2.)
4. A prop with `merge: replace`, an org value and a team `""`: the box shows the default as winning, the org value struck or absent, never both as if stacked. (Task 5.)
5. Copy for Claude on a block with no props: the brief omits the Props lines and the per-layer lines rather than printing "undefined". (Task 7.)

---

## File structure

Create under `apps/console/src/app/wiring/blocks/`:

| File | Responsibility |
|---|---|
| `model/zoom.ts` | URL + payload → `{ level: "skill" | "parent" | "block"; block: PayloadBlock | null; crumbs }` |
| `model/sidebar.ts` | payload → sidebar rows (glyph, label, dots, folded state, "Shared" fold) |
| `model/sections.ts` | payload → section bands and folded rows per zoom level |
| `model/layers.ts` | payload → block-map squares, line totals, the L3 strip |
| `model/around.ts` | graph + block → the subgraph |
| `model/aroundLayout.ts` | subgraph → React Flow nodes/edges (layered) |
| `model/brief.ts` | payload + block → the Copy for Claude text |
| `model/headingTree.ts` | a hand-written SKILL.md → a read-only `BlocksPayload`-shaped tree |
| `BlockView.tsx` | the stage: breadcrumb, main column, Layers panel, Around this block |
| `BlockSidebar.tsx` | the tree with the "All skills" back link and skill switcher |
| `SectionBand.tsx`, `BlockRow.tsx`, `PropBox.tsx`, `LayersPanel.tsx`, `AroundGraph.tsx`, `CopyForClaude.tsx`, `BlockText.tsx` (markdown via `react-markdown`, already a dependency) |
| `blocks.module.css` | layout; colors by token only |

Modify: `apps/console/src/server/skills.ts` (route), `apps/console/src/app/wiring/useWiring.ts` (`useBlocks`), `apps/console/src/app/wiring/graph/useWiringUrl.ts` (`block` key; drop `rebind`), `apps/console/src/app/wiring/graph/GraphTab.tsx`, `apps/console/src/app/wiring/WiringMap.tsx` (sidebar swap), `apps/console/src/app/wiring/agentContext.ts` (block scope), `apps/console/src/server/fixtures/design/` (a `blocks` scenario, Task 1). Keep: `graph/TemplateCanvas.tsx`, `graph/nodes/*`, `graph/layout/templateLayout.ts`, `graph/model/templateModel.ts` (the pipeline map). Delete after Task 8: `graph/drawer/RebindPanel.tsx`, `graph/drawer/rebind.ts`, `graph/drawer/SkillDrawer.tsx`, `graph/drawer/useDrawerMode.ts`, `graph/drawer/useDrawerWrap.ts`, `graph/drawer/DrawerMenu.tsx`, `graph/drawer/BuiltFromTable.tsx`, `graph/drawer/TabHeading.tsx`, `graph/drawer/TextTab.tsx`, `graph/drawer/drawer.module.css`, `graph/model/drawerContent.ts` and their tests, plus the per-skill (non-pipeline) branches of `templateModel.ts` that only the drawer read. Move under `blocks/`: `graph/drawer/HistoryTab.tsx` with `history.ts`, and `usedBy.ts` with the used-by list component.

Tests: beside each model file as `*.test.ts`; component tests under `blocks/__tests__/` with a `blocksFixture.ts` built from the `mini` fixture's real `rt skills blocks --json` output committed as JSON, which the design fixture's `blocks` scenario also serves.

---

### Task 1: The route and the hook

**Files:**
- Modify: `apps/console/src/server/skills.ts` (`.get('/api/skills/blocks', skillQuery, …)` mirroring the anatomy route: `cachedRun(['skills','blocks','--pack',pack,'--skill',skill,'--json'])`, 502 on no payload, 503 on `RtNotFoundError`, and 404 with the app-server error envelope when rt fails with code `not-a-block-tree` (plan 1 Task 10); invalidated with the anatomy answers), `apps/console/src/server/blocksPayload.ts` (new: a copy of plan 1's `BlocksPayload` type, since console's `tsconfig` covers only `src` and never imports rt's `lib/`; the route's response is typed with it), `apps/console/src/app/wiring/useWiring.ts` (`useBlocks(pack, skill)` like `useAnatomy`; `SkillsBlocks` is `InferResponseType` of the route, the way `SkillsAnatomy` is inferred today; a type test asserts the committed `blocks.mini.json` satisfies `BlocksPayload`, so the copy can't drift silently), `apps/console/src/server/fixtures/design/fixtureRt.ts` and `scenarios.ts` (a `blocks` scenario: `rt skills blocks --skill <name>` answers from `blocks.<name>.json`; `blocks.mini.json` is the committed payload of the `mini` fixture, so the render check and parity runs need no real pack)
- Test: `apps/console/src/server/skills.test.ts` (the route passes `--json` through and maps the two failure cases), `useWiring.test.tsx` (`useBlocks` is disabled without a skill), `fixtures/design/fixtureRoutes.test.ts` (the `blocks` scenario answers `/api/skills/blocks?skill=mini`)

- [ ] **Step 1: Write the failing tests** (same shape as the anatomy route's tests in that file)
- [ ] **Step 2: Run `bun run console:test` → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `console: /api/skills/blocks and useBlocks`**

---

### Task 2: Zoom level from the URL

**Files:**
- Modify: `useWiringUrl.ts` (`block: string | null` read from `block`; `rebind` removed from `WiringUrl`, `KEYS` and `parseWiringUrl`; `select` and `view` stay for the rendered-file links History uses)
- Create: `blocks/model/zoom.ts`
- Test: `useWiringUrl.test.ts` (existing), `blocks/model/zoom.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Zoom = { level: "skill" } | { level: "parent"; block: PayloadBlock } | { level: "block"; block: PayloadBlock };
  export function zoomOf(payload: BlocksPayload, blockId: string | null): { zoom: Zoom; missing: string | null };
  export function crumbsOf(payload: BlocksPayload, block: PayloadBlock | null): { id: string | null; label: string }[]; // [skill, …ancestors, block]
  ```
- A block with children (another block's `parentId` equals its id) is `parent`; a leaf is `block`; the root id or null is `skill`; an unknown id is `skill` with `missing` set.

- [ ] **Step 1: Write the failing tests** (root → skill; `mini/run` with children → parent; `mini/gate` → block; `mini/nope` → skill + `missing: "mini/nope"`; crumbs for `mini/run/check` are `[mini, Run, Check]`: the skill's name, then each block's label)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `console: block zoom level from the URL`**

---

### Task 3: Sidebar and section models

**Files:**
- Create: `blocks/model/sidebar.ts`, `blocks/model/sections.ts`
- Test: `sidebar.test.ts`, `sections.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Glyph = "step" | "question" | "gate" | "note" | "shared";
  export type SidebarRow = { id: string; depth: number; label: string; glyph: Glyph; dots: ("org" | "team")[]; count: number | null /* children, on a folder row */; open: boolean; selected: boolean };
  export function sidebarRows(payload: BlocksPayload, selectedId: string | null): SidebarRow[]; // top-level shared blocks fold into one row { id: "shared", label: "Shared", glyph: "shared", count }
  export type SectionBand = { id: string; title: string; glyph: Glyph; blockCount: number; propsCount: number; rows: FoldedRow[] };
  export type FoldedRow = { id: string; glyph: Glyph; label: string; summary: string; dots: ("org" | "team")[]; hasProps: boolean; selected: boolean };
  export function sectionsAt(payload: BlocksPayload, zoom: Zoom): SectionBand[]; // skill: one band per top-level block with children, plus one "Notes" band for top-level leaves; parent: one band of the block's children
  ```
- Folding: only the section holding the selection starts open; with no selection, none.

- [ ] **Step 1: Write the failing tests** (rows in preorder with the Shared fold last; a headless block labelled from its id; dots from `props[].values[].layer`; `sectionsAt` at skill level on the fixture gives bands `Run`, `Notes`; at `mini/run` one band with its children; `propsCount` counts blocks with at least one prop)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `console: sidebar rows and section bands for the block view`**

---

### Task 4: Layers model and charts

**Files:**
- Create: `blocks/model/layers.ts`, `blocks/LayersPanel.tsx`
- Test: `layers.test.ts`, `__tests__/LayersPanel.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type Square = { id: string; section: string; fill: "mattstack" | "org" | "team" | "both" };
  export function blockMap(payload: BlocksPayload, scope: PayloadBlock | null): { squares: Square[]; legend: { fill: Square["fill"]; count: number }[] };
  export function lineTotals(payload: BlocksPayload, scope: PayloadBlock | null): { layer: string; count: number }[]; // a replaced default counts for the replacing layer
  export function blockStrip(block: PayloadBlock): { layer: string; lines: number; label: string }[]; // in marker order: mattstack text before the first marker, each value, text between
  ```
- `LayersPanel` renders the three charts per the dataviz skill (load it before writing): stacked bar with its total label; squares in a CSS grid grouped by section with the legend; the L3 strip. Colors from the tokens named in Global Constraints only.

- [ ] **Step 1: Write the failing tests** (`blockMap` on the fixture with a team value on `mini` and a cleared `tiering`: squares `mini` = team, `mini/gate` = mattstack; `lineTotals` sums mermaid lines into mattstack; `blockStrip` on `mini/gate` gives `[mattstack n, mattstack(default) m]`; the panel renders a `data-testid="layers-bar"` with one segment per non-zero layer and a legend row per fill with its count)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `console: Layers panel`**

---

### Task 5: Block text and prop boxes

**Files:**
- Create: `blocks/BlockText.tsx`, `blocks/PropBox.tsx`
- Test: `__tests__/PropBox.test.tsx`, `__tests__/BlockText.test.tsx`

**Interfaces:**
- `BlockText({ block, payload })` renders `block.text` as markdown; at each prop marker position it mounts `PropBox`. Since `text` has the values inlined (plan 1 payload), the component splits on the prop seams the payload keeps as `<!-- part: prop:… -->` lines and renders the mattstack prose between them; a ```` ```mermaid ```` fence renders as the one-line graph card at parent level and is omitted at block level.
- `PropBox({ prop })` shows name, `merge · default` line, then one tinted card per value in layer order for `add`; for `replace` the winning value only, with "default" when `fromDefault`; an empty `add` prop shows "nothing passed" in muted text.

- [ ] **Step 1: Write the failing tests** (a replace prop with an org value cleared by the team shows one card labelled default and no org card; an add prop with two values shows two cards, org first; a block with no markers renders no box; backticks render as `<code>`, never literally)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `console: block text with prop boxes`**

---

### Task 6: Around this block

**Files:**
- Create: `blocks/model/around.ts`, `blocks/model/aroundLayout.ts`, `blocks/AroundGraph.tsx`
- Test: `around.test.ts`, `aroundLayout.test.ts`, `__tests__/AroundGraph.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function aroundBlock(graph: BlocksPayload["graphs"][number], nodeId: string): { nodes: typeof graph.nodes; edges: typeof graph.edges }; // one hop in, one hop out, plus every node on a cycle through nodeId of length ≤ 3
  export function layerNodes(sub: ReturnType<typeof aroundBlock>, focus: string): Map<string, number>; // longest-path layering from the focus's in-neighbours; the focus sits in the middle layer
  export function aroundLayout(sub, focus): { nodes: Node[]; edges: Edge[] }; // React Flow; node data { label, shape, blockId, focus: boolean }
  ```
- `AroundGraph` reuses the `ReactFlow` setup of `TemplateCanvas` (the `Background`, controls off, pan on scroll) with two node types: `BlockNode` (solid; click patches `{ block: data.blockId }`) and `GraphOnlyNode` (muted outline, not clickable); a key under the canvas ("Opens a block" / "Graph step only" as on the board) and a "View whole graph" link that sets `select: "graph"` so the full graph renders in place of the small one.

- [ ] **Step 1: Write the failing tests** (on `ship`-shaped fixture edges: `fast_checks` keeps `commit_named`, `stash_them`, `checks_pass`, `fix_test_first` (the 2-hop cycle), `fix_rounds_left` (3-hop) and not `rebase_this_pass`'s far side; a graph with a 4-hop cycle through the focus excludes the two far nodes and terminates; the layout puts in-neighbours above the focus and out-neighbours below; clicking a block node calls `onSelect` with its id, a graph-only node does nothing)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `console: Around this block`**

---

### Task 7: Copy for Claude

**Files:**
- Create: `blocks/model/brief.ts`, `blocks/CopyForClaude.tsx`
- Modify: `agentContext.ts` (`buildBlockContext(input: { payload: BlocksPayload; block: PayloadBlock }): string` beside `buildAgentContext`; the old one stays until Task 8 deletes its callers)
- Test: `brief.test.ts`, `__tests__/CopyForClaude.test.tsx`

**Interfaces:**
- `buildBlockContext` returns exactly the spec's brief: `Block: <id>` / `  "<title>"` / `File: <path>` / `Props: <name> (<merge>, optional|required)` per prop / `  <layer>: <value path>` or `  <layer>: nothing passed` per layer that is not mattstack / `Pack: <pack>, extends <base>` (`Pack: <pack>` with no base) / blank / `Change a prop's value: mattstack:extending-a-pack` / `Change mattstack's text: mattstack:editing-skills` / `Write it with: superpowers:writing-skills` / blank / `What I want:`. No `Props:` block when the block has none.
- `CopyForClaude` is the primary button; on click it writes the brief to the clipboard (`navigator.clipboard.writeText`) and opens a popover "Copied. Paste it into Claude" showing the brief in a `Code` block and the hint "Add what you want changed after the last line".

- [ ] **Step 1: Write the failing tests** (the brief for `mini/gate` equals the expected multi-line string; a block with no props has no `Props:` line; the popover shows after click and the clipboard mock received the brief)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit: `console: Copy for Claude`**

---

### Task 8: The view, the tab and the fallback

**Files:**
- Create: `blocks/BlockView.tsx`, `blocks/BlockSidebar.tsx`, `blocks/SectionBand.tsx`, `blocks/BlockRow.tsx`, `blocks/model/headingTree.ts`
- Modify: `graph/GraphTab.tsx` (a focused pipeline keeps today's `TemplateCanvas` map with its stage links; a focused skill or stage renders `BlockView`; `SkillDrawer` is gone from both), `WiringMap.tsx` (sidebar: `GraphSidebar` for the map, `BlockSidebar` when a skill is focused; the "All skills" link patches `{ focus: null, block: null }`, which lands on the pipeline map as today), `FocusHeader.tsx` (the block title, kind chip "step | question | gate", "has props" chip)
- Move: `graph/drawer/HistoryTab.tsx` → `blocks/HistoryTab.tsx` (file = the block's path), used-by list → `blocks/UsedBy.tsx` (shared blocks only: the skills whose payload `includes` name it)
- Delete: the files listed under File structure, with their tests
- Test: `__tests__/BlockView.test.tsx`, `__tests__/GraphTab.test.tsx` (rewrite), `headingTree.test.ts`

**Interfaces:**
- `headingTree(skillMd: string, skill: string): BlocksPayload` builds a read-only payload from a hand-written skill: one block per heading section, ids from slugified titles, no props, `kind: "note"`, empty `graphs`.
- `BlockView({ pack, payload, url, patch })` lays out: breadcrumb (L2/L3), title row with chips, the ⋯ menu with the path and Open file (`useEditorHref`), the `CopyForClaude` button, the `Blocks | Rendered` toggle (Rendered = the compiled file at `renderedLines`, as the drawer's view did), then by zoom level: sections (L1), text + graph card + children (L2), text with prop boxes + Around this block (L3); the Layers panel on the right at L1/L2 and the strip at L3; Used by on a shared block; History per block.

- [ ] **Step 1: Write the failing tests** (GraphTab with a focused block skill renders `BlockView` and no `canvas`; with a focused pipeline it renders `TemplateCanvas` with one link node per stage after plan 2's anatomy change (the fixture's anatomy parts use `kind: "prop"` where `slot` stood; `templateModel` maps both to a placeholder row); with a hand-written skill (the blocks route returns 404 "not a block tree") it fetches the source and renders the heading tree read-only; the "All skills" link clears focus; the unsynced banner still renders when `useUnsyncedBanner` says so; no `rebind` control anywhere: `screen.queryByText(/rebind/i)` is null)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement; delete the replaced files; fix every import the deletion breaks**
- [ ] **Step 4: Run `bun run console:test`, `bun run console:typecheck`, `bun run console:lint` → PASS**
- [ ] **Step 5: Commit: `console: block view replaces the template canvas and drawer`**

---

### Task 9: Render check against the boards

- [ ] **Step 1: Serve console from this worktree, not the deck-served main checkout: from `apps/console`, `CONSOLE_FIXTURE=design CONSOLE_FIXTURE_SCENARIO=blocks PORT=<a free port> bun run serve` (the server prints its URL). Open `mini` at L1, L2 (its parent block) and L3 (`gate`) in Fast Browser, screenshot each in light and dark into the scratchpad. When plan 2 has landed, repeat against a real pack by pointing the same server at this worktree's rt (`bun cli.ts` via the server's rt-bin setting) with `ship` at L1, `Flow` and `Fast checks`**
- [ ] **Step 2: Compare each with `docs/apps/design/console/skill-blocks/*.png`: sidebar glyphs and dots, the folded rows, the prop box tints, the Layers charts, the small graph's key. Write down what reads wrong, fix it, re-shoot**
- [ ] **Step 3: Commit the fixes: `console: block view polish from the render check`**

---

## Self-review notes

- Spec coverage: Placement (Tasks 8), Three zoom levels (2, 8), Sidebar (3, 8), Main column (3, 5, 8), Layers panel (4), Around this block (6), Copy for Claude (7), Kit and tokens (every component; Task 9 checks it by eye), the non-block skill fallback (8).
- The "All skills" home is today's pipeline map: `GraphSidebar` plus `TemplateCanvas` for a focused pipeline, kept as is. Only a focused skill or stage opens the block view.
- "View whole graph" renders the parent's full graph on the same canvas rather than a new page; the spec says only "opens the full graph".
- The render check serves console from this worktree with the design fixture's `blocks` scenario, because the deck-served console runs the shared main checkout's code.
