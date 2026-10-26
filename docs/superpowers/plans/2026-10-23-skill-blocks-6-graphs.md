# Skill blocks, plan 6: the block map and Around restyle

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to run this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the console's full-graph view with the block map (blocks only, other steps folded into dotted links that open in place), give "Around this block" the same look, and lay both out with elkjs.

**Architecture:** A pure model, `blockMap()`, turns a parent block's Mermaid graph into map nodes and links. A small engine layer turns any node/edge set into an ELK graph, runs elkjs (in a web worker in the browser, bundled in tests) and reads back positions. React Flow draws the result with shared card nodes and one edge type. The hand-written layout in `blocks/model/aroundLayout.ts` goes away.

**Tech stack:** React 19, `@xyflow/react`, elkjs (new, through the catalog), Vitest + Testing Library, the `@mattstack/app-kit` kit, Fast Browser for shots.

**Spec:** `docs/superpowers/specs/2026-10-23-skill-block-graphs-design.md` (Matt approved it on 2026-10-23). It extends `docs/superpowers/specs/2026-10-22-skill-blocks-design.md`. Boards: `docs/apps/design/console/skill-blocks/block-map.light.png` and `block-map-interactions.light.png`, plus the boards Task 2 adds.

## Global Constraints

- **Kit:** chrome and role tokens only, per `docs/apps/ui-authoring.md`; no raw colours. Tints use `color-mix(in srgb, var(--tk-…) var(--ui-wash), transparent)`, as `.propCard[data-layer]` in `blocks/blocks.module.css` does. The end badge mixes `--tk-dot-ok`.
- **Cards:** 40px tall, 9px radius, `--tk-card` surface, `--tk-border-soft` border, soft shadow.
- **Kind badges:** 20px, with a 6px radius:

  | Kind | Badge fill | Icon |
  |---|---|---|
  | step | accent mix | circle, accent |
  | question | `--tk-raised` | diamond, `--tk-text-2` |
  | gate | `--tk-dot-warn` mix | flag, `--tk-dot-warn` |
  | end | `--tk-dot-ok` mix | check, `--tk-text-ok` |

- **Card text:** title 13px, weight 500, `--tk-text-1`. Layer dots are 6px: `--tk-fill-purple` (org base), `--tk-fill-cyan` (team).
- **Links:** 1.5px `--tk-line-1`, right-angled with a 10px corner radius, filled arrowheads. A folded link is dotted: round 2.4px dots every 5px.
- **Jump pill:** 22px tall, `--tk-fill-accent` mix fill. A ↩ icon (`corner-up-left`) marks a back link and → (`arrow-right`) a forward one. Target text is 11px, weight 500, `--tk-text-accent`. An exit label comes first, in 11px `--tk-text-2`.
- **Canvas:** React Flow `Background` with `BackgroundVariant.Dots`, gap 16, on `--tk-panel`, with a 12px radius and a `--tk-border-soft` border.
- **Layout:** elkjs `layered`, direction `DOWN`, `ORTHOGONAL` edge routing, 36px between node rows. It loads only with a graph view: a dynamic import, with a web worker in the browser.
- **Copy:** rt:ui-copy short clauses, e.g. "Block map", "<n> blocks · <m> steps folded", "Every step", "Close", "<n> steps", "Fold", "Click to unfold", "from <block>", "Back".
- **Labels:** graph-only node labels go through `shortLabel(label, skill)` (ruling R123; Task 6 moves it to `blocks/model/labels.ts`). An exit label shown on a pill or a branch is cut at its first colon.
- **URL:** views live in the URL. `select: 'graph'` opens the block map and `select: 'graph-steps'` opens Every step (`graph/useWiringUrl.ts`, `BlockView.tsx`). An open fold and a jump trail are local state.
- **Names:** invented names only in committed files. Screenshots stay out of the repo, because their top bar shows real account names.
- **Gates on each task's final commit:** `bun run console:test`, `bun run console:typecheck`, `bun run console:lint`, `bun run purity`, and `bunx prettier --check src AGENTS.md` in `apps/console`. Add `bun run console:build` for Tasks 3 and 6, and the docs build when `website/` changes.
- **Git:** plain single git commands, never inside compound commands, loops or variables. No command line may contain the word b-i-n-d.
- **Parity:** strict parity measures the look against the boards: styling, the label conventions, a straight main column, side branches, and no label over another line. ELK owns the exact positions.

## Review Focus

1. **A graph with no blocks in it** (every node graph-only): the map shows "No blocks here" and a link to Every step, never an empty canvas. (Task 4 test; Task 6 makes it a link.)
2. **A cycle among graph-only nodes with no block on it:** `blockMap()` returns, and the cycle's nodes appear in no link. (Task 1 test.)
3. **A graph with no success end** (no `:::done` node): there is no end node and no end link, and nothing throws. (Task 1 test.)
4. **A block whose path loops straight back to itself:** a jump-back pill to its own name. (Task 1 test.)
5. **elkjs failing to load or lay out:** the graph shows "The graph didn't lay out" with Retry, never a blank canvas. (Task 4 test.)

---

## File structure

| File | Responsibility |
|---|---|
| `apps/console/src/app/wiring/blocks/model/blockMap.ts` (new) | the block map model: nodes, links, flow order, layers, `formatBlockMap` |
| `.../blocks/model/foldBand.ts` (new) | a folded link's steps as a small graph: commands, questions with exits, merged budget pairs |
| `.../blocks/model/labels.ts` (new) | `shortLabel` (moved from `aroundLayout.ts`) and `cutLabel` |
| `.../blocks/model/elkGraph.ts` (new) | `LayoutInput` ↔ ELK JSON: options, compound nodes, ports, labels, read-back |
| `.../blocks/layoutEngine.ts` (new) | `loadLayoutEngine()` (worker, lazy) and `bundledEngine()` (tests) |
| `.../blocks/useGraphLayout.ts` (new) | layout hook: loading, ready, error, retry |
| `.../blocks/graphCards.tsx` (new) | `BlockCard`, `StepCard`, `EndCard`, `JumpPill`: the shared node look |
| `.../blocks/graphEdges.tsx` (new) | `FlowEdge` (solid, dotted, hot, dim) and `roundedPath` |
| `.../blocks/BlockMap.tsx` (new) | the block map view: header, canvas, key, interactions |
| `.../blocks/FlowGraph.tsx` (new) | any node/edge set with labelled edges: Every step and Around |
| `.../blocks/AroundGraph.tsx` | becomes a thin wrapper over `FlowGraph`; `WholeGraph` goes |
| `.../blocks/BlockView.tsx` | mounts `BlockMap` and Every step from the URL |
| `.../blocks/model/aroundLayout.ts`, `aroundLayout.test.ts` | deleted in Task 6 |
| root `package.json`, `apps/console/package.json` | elkjs in the catalog and the console |
| `website/docs/apps/console.mdx`, `apps/console/AGENTS.md` | docs (Task 7) |

---

### Task 1: The block map model

**Files:**
- Create: `apps/console/src/app/wiring/blocks/model/blockMap.ts`, `apps/console/src/app/wiring/blocks/model/labels.ts` (only `cutLabel` here; Task 6 moves `shortLabel` in)
- Test: `apps/console/src/app/wiring/blocks/model/blockMap.test.ts`, file snapshot `apps/console/src/app/wiring/blocks/model/__snapshots__/blockMap.ship.txt`

**Interfaces:**
- Produces:

```ts
type Graph = BlocksPayload['graphs'][number];
export type MapKind = 'step' | 'question' | 'gate' | 'end';
export type MapNode = { id: string; blockId: string | null; label: string; kind: MapKind };
export type MapLink = {
  id: string;
  from: string;
  alsoFrom: string[];      // sibling sources sharing this jump
  to: string[];            // one target, or several for a grouped jump
  folded: string[];        // graph-only node ids, in flow order
  kind: 'line' | 'jump-back' | 'jump-forward';
  label: string | null;    // already cut at the first colon
  trunk: { group: string; splitAt: string; main: boolean } | null;
};
export type BlockMap = { nodes: MapNode[]; links: MapLink[]; order: string[]; layers: Record<string, number>; foldedSteps: number };
export const JUMP_LAYERS = 3;
export function blockMap(graph: Graph, blockOf: (blockId: string) => { label: string; kind: Exclude<MapKind, 'end'> }): BlockMap;
export function formatBlockMap(map: BlockMap): string;   // one line per node, then per link
export function cutLabel(label: string): string;         // in labels.ts: text before the first ':', trimmed
```

These are the spec's rules under "Links", made exact:
- **End:** a node with no outgoing edges, or with shape `doublecircle`.
- **Exit node:** a graph-only node from which every path reaches an end without passing a block. It is a fixed point over the reverse graph.
- **Links:** walk forward from each block node through graph-only, non-exit nodes, keeping a visited set per walk. Stop at the first block. A block whose every path enters an exit node links to the success end, the node with `cls: 'done'`, when there is one.
- **Flow order:** a depth-first walk from the trigger, the first `ellipse` node or else the first node, taking edges in declaration order. A back edge goes to a node on the stack.
- **Layers:** longest-path layers of the map with back links removed.
- **Kind:** a link to a node at or before its source in flow order is `jump-back`. A forward link spanning `JUMP_LAYERS` or more layers is `jump-forward`. Everything else is `line`.
- **Grouping:** jumps from one source whose last folded node is the same merge into one link with several `to`. Identical jumps (same label, same `to`) from different sources merge, keeping the source latest in flow order as `from` and the others in `alsoFrom`.
- **Label:** a jump's label is the source's first edge label on the path, cut. A line has no label unless it is a trunk branch.
- **Trunks:** two or more line links from one source whose folded sets intersect form a trunk group. `splitAt` is the latest node in flow order in both folded sets. The link whose target comes first in flow order is `main: true` and carries no label. Every other link is a branch, labelled with the cut label of the edge out of `splitAt` toward its target.
- **Count:** `foldedSteps` is `graph.nodes.length - nodes.length`.

- [ ] **Step 1: Write the failing tests.** Small graphs use a local helper `g(nodes, edges)`; ship cases read `src/server/fixtures/design/blocks.ship.json`'s `ship/flow` graph, with `blockOf` taken from its blocks.

```ts
test('links two blocks through graph-only steps and folds them')        // A → x → y → B: one line A→B, folded [x, y]
test('a direct edge is a link with nothing folded')                    // A → B: folded []
test('stops on entering an exit node')                                 // A → q -no-> B, q -yes-> hub → end: only A→B
test('a block with only exit paths links to the success end')          // M → hub → done(:::done): M→done
test('with no success end there is no end node and no end link')       // Review Focus 3
test('a back edge is a jump back, labelled with the source exit cut at its colon') // B -iterate-> x -no: redo-> A: jump-back, label 'iterate'
test('a path back to its own block is a jump back to itself')          // Review Focus 4
test('a forward link spanning JUMP_LAYERS layers is a jump; fewer is a line')
test('one folded question reaching two blocks makes one jump with both targets')
test('sibling sources with the same jump share one link')              // alsoFrom
test('a trunk splits at the latest shared step; the first target is the main line')
test('a graph-only cycle with no block ends the walk')                 // Review Focus 2
test('ship flow: one node per block with a node, plus Shipped', () => {
  // expected count from the fixture: flow blocks whose node is set, + 1
});
test('ship flow: the links the spec names', () => {
  // domain_fast_checks → fix_test_first: line, folded [checks_pass, run_budget_fix_rounds, fix_rounds_spent]
  // fix_test_first → domain_fast_checks: jump-back, label null
  // gate_ship → domain_steps_before_gate: jump-back, label 'iterate'
  // domain_fast_checks → gate_ship: jump-back (the fix-rounds budget loop)
  // reopened_recapture → [capture_after_browser, capture_after_case]: jump-forward, label 'yes'
  // domain_rebases_unfinished → gate_push_refused: trunk branch, splitAt 'push_result', label 'refused or errored'
  // gate_mark_ready → shipped: line
  // no link's folded set contains which_exit or any run_close_* node
});
test('ship flow: the whole map', async () => {
  await expect(formatBlockMap(map)).toMatchFileSnapshot('./__snapshots__/blockMap.ship.txt');
});
```

- [ ] **Step 2: Run** `bun run console:test -- blockMap` → FAIL (module missing).
- [ ] **Step 3: Implement** `blockMap`, `formatBlockMap` and `cutLabel` to the rules above. Each `formatBlockMap` line reads like `link domain_fast_checks → fix_test_first · line · folded 3 · checks_pass, run_budget_fix_rounds, fix_rounds_spent`.
- [ ] **Step 4: Run** the same → PASS. Read the generated snapshot and check it against the Mermaid by hand for five links. In the report, list every link that surprised you (for example Rebases unfinished reaching the captures through the GitHub path).
- [ ] **Step 5: Commit** `console: block map model`.

### Task 2: Boards from the model (controller, no implementer)

The controller draws these in `Skill Packs.pen`. Visual work stays with whoever can see the pixels.

- [ ] Redraw "C · Block map · polished" from `blockMap.ship.txt`, in the approved look. Change the board's content only: links, dotted versus solid, pills, trunks, counts.
- [ ] Draw the dark versions of the block map and of "C · Interactions".
- [ ] Redraw the Around section of the L3 boards (`block.light.png`, `block.dark.png`) in the new look, for Fast checks.
- [ ] Export at 2x to `docs/apps/design/console/skill-blocks/`: `block-map.{light,dark}.png`, `block-map-interactions.{light,dark}.png`, `block.{light,dark}.png`.
- [ ] Show Matt the redrawn block map, since its content changed from the board he approved. Apply what he asks.
- [ ] Commit `docs: block map boards from the model, dark boards, Around in the new look`.

### Task 3: The layout engine

**Files:**
- Modify: the root `package.json` (`workspaces.catalog`: `"elkjs"` at the newest version that is at least two weeks old; check with `npm view elkjs time --json`), `apps/console/package.json` (`"elkjs": "catalog:"`), `bun.lock`
- Create: `apps/console/src/app/wiring/blocks/model/elkGraph.ts`, `apps/console/src/app/wiring/blocks/layoutEngine.ts`
- Test: `apps/console/src/app/wiring/blocks/model/elkGraph.test.ts`

**Interfaces:**
- Produces:

```ts
export type LayoutNode = { id: string; width: number; height: number; parent?: string; anchorX?: number }; // anchorX: x of the top and bottom ports, default width/2
export type LayoutEdge = { id: string; source: string; target: string; label?: { text: string; width: number; height: number } };
export type LayoutInput = { nodes: LayoutNode[]; edges: LayoutEdge[] };
export type Box = { x: number; y: number; width: number; height: number };
export type LaidOut = { width: number; height: number; nodes: Record<string, Box>; edges: Record<string, { points: [number, number][]; label: Box | null }> };
export interface LayoutEngine { layout(input: LayoutInput): Promise<LaidOut> }
export const ELK_OPTIONS: Record<string, string>;   // layered, DOWN, ORTHOGONAL, nodeNodeBetweenLayers 36, hierarchyHandling INCLUDE_CHILDREN, node placement keeping long paths straight
export function toElk(input: LayoutInput): ElkNode;
export function fromElk(root: ElkNode): LaidOut;     // absolute coordinates, compound children flattened
export function loadLayoutEngine(): Promise<LayoutEngine>;   // dynamic import of elkjs/lib/elk-api + Vite `?worker` import of elkjs/lib/elk-worker.min.js
export function bundledEngine(): LayoutEngine;               // elkjs/lib/elk.bundled.js, for tests
```

- [ ] **Step 1: Write the failing tests** (with `bundledEngine()`):
  - `toElk puts a node with a parent inside its parent's children`
  - `toElk gives a node fixed top and bottom ports at anchorX`
  - `fromElk returns absolute boxes for compound children`
  - `a three-node chain runs top to bottom, rows 36px apart`
  - `every edge segment is horizontal or vertical`
  - `an edge leaves its source at anchorX`
  - `a compound node's box contains its children`
- [ ] **Step 2: Run** `bun run console:test -- elkGraph` → FAIL.
- [ ] **Step 3: Implement.** Add elkjs, then `toElk`, `fromElk`, `ELK_OPTIONS`, `bundledEngine` and `loadLayoutEngine`. `loadLayoutEngine` caches its promise, and a rejection clears the cache so Retry can try again.
- [ ] **Step 4: Run** the tests → PASS. Then run `bun run console:build`: the build passes, the worker comes out as its own asset, and `grep -l elk dist/assets/index-*.js` finds nothing (the engine is not in the entry chunk).
- [ ] **Step 5: Commit** `console: elkjs layout engine`.

### Task 4: The block map view

**Files:**
- Create: `blocks/graphCards.tsx`, `blocks/graphEdges.tsx`, `blocks/useGraphLayout.ts`, `blocks/BlockMap.tsx`, plus styles in `blocks/blocks.module.css`
- Modify: `blocks/BlockView.tsx` (for `select === 'graph'`, mount `BlockMap` where `WholeGraph` mounts today, lines ~317 and ~365), `blocks/AroundGraph.tsx` (remove `WholeGraph`)
- Test: `blocks/__tests__/BlockMap.test.tsx`, `blocks/__tests__/graphEdges.test.ts`

**Interfaces:**
- Consumes: `blockMap`, `formatBlockMap`, `cutLabel` (Task 1); `LayoutInput`, `LaidOut`, `LayoutEngine`, `loadLayoutEngine` (Task 3).
- Produces:

```ts
export function roundedPath(points: [number, number][], radius?: number): string;   // radius default 10
export function useGraphLayout(input: LayoutInput | null, engine?: () => Promise<LayoutEngine>): { state: 'loading' | 'ready' | 'error'; laidOut: LaidOut | null; retry: () => void };
export function BlockCard(props: { label: string; kind: MapKind; dots: ('org' | 'team')[]; width: number; pills: JumpPillProps[]; hot?: boolean; dim?: boolean; ring?: boolean }): JSX.Element;
export function JumpPill(props: { label: string | null; target: string; direction: 'back' | 'forward'; pressed?: boolean; onClick: () => void }): JSX.Element;
export function BlockMap(props: { payload: BlocksPayload; graph: Graph; highlight: string | null; onSelect: (blockId: string) => void; onClose: () => void; engine?: () => Promise<LayoutEngine> }): JSX.Element;
```

- **Layout input:** a node's box is its card plus 8px plus its widest pill, so ELK keeps room for the pills. `anchorX` is the card's centre. Cards on the main column (the longest forward path from the first block to the end) share the widest of their widths; other cards size to their text, measured the way `AroundGraph.tsx`'s `measure` does today. Jump links are not ELK edges; they render as pills. Trunk groups get one junction node at `splitAt`, 1×1 and not drawn.
- **Edges:** a link with `folded.length > 0` gets `stroke-dasharray="0 5"`, round caps and a 2.4px width. A link with nothing folded is a solid 1.5px line. A trunk branch shows its label as a small chip beside its first drop.
- **Layer dots:** the same rule as the sidebar (`props[].values[].color`, ruling R111).

- [ ] **Step 1: Write the failing tests** (ship fixture, `bundledEngine`):
  - `renders a card per map node with its kind badge and label`
  - `the header counts blocks and folded steps` (expected values computed from `blockMap` in the test)
  - `a folded link is dotted and a direct one is solid`
  - `jump pills show the exit label and the target ("iterate", "Domain steps")`
  - `the main column's cards share one width`
  - `with no blocks in the graph it says "No blocks here"` (Review Focus 1)
  - `when layout fails it says "The graph didn't lay out" and Retry lays out again` (Review Focus 5: an engine that rejects once)
  - `Close calls onClose`
  - `roundedPath` gets its own test: `rounds each corner with radius 10 and keeps straight runs straight`
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the cards, the edge, the hook and the view, with the key under the canvas (step, question, gate, org base adds, team adds, steps folded, loops back). Wire `BlockView`.
- [ ] **Step 4: Run** → PASS. Shoot the block map at 1440 in light and dark, Read the shots, and measure against `block-map.{light,dark}.png`. Fix every difference except ELK's positions.
- [ ] **Step 5: Commit** `console: the block map`.

### Task 5: Interactions

**Files:**
- Create: `blocks/model/foldBand.ts`, `blocks/FoldBand.tsx`
- Modify: `blocks/BlockMap.tsx`, `blocks/graphEdges.tsx`, `blocks/graphCards.tsx`
- Test: `blocks/model/foldBand.test.ts`, `blocks/__tests__/BlockMapInteractions.test.tsx`

**Interfaces:**
- Produces:

```ts
export type BandNode =
  | { id: string; kind: 'command'; text: string }
  | { id: string; kind: 'question' | 'step'; label: string; jumps: { label: string; target: string; direction: 'back' | 'forward' }[]; pills: string[] }
  | { id: string; kind: 'budget'; label: string; jumps: { label: string; target: string; direction: 'back' | 'forward' }[]; pills: string[] };
export type Band = { nodes: BandNode[]; edges: { id: string; source: string; target: string }[] };
export function foldBand(graph: Graph, link: MapLink, map: BlockMap): Band;
export function budgetLabel(key: string, limit: number): string;   // 'ship:conflict-rounds', 4 → 'Conflict rounds left? · 4'; 'ship:after-attempts:<case id>', 3 → 'After attempts left? · 3'
```

- **Budget pair:** a `plaintext` node whose label starts `run_budget {key: K, limit: N`, with one out-edge to a `diamond` whose label ends in `spent (…)?` or `spent?`, merges into one `budget` node. Its exits are the question's exits with their meaning flipped: the "spent: no" exit is labelled "yes" and the "spent: yes" exit is labelled "no".
- **Exits:** an exit inside the band is a pill. An exit leaving the band becomes a jump to the first block a breadth-first walk reaches, skipping exit nodes, or to "Which exit" when the walk finds no block. Its label is cut.
- **Band layout:** the band is an ELK compound node that replaces the link's edge. The source block links to the band's first node, and the band's last node links to the target.

- [ ] **Step 1: Write the failing tests:**
  - `foldBand merges a budget pair`: on ship, Rebases unfinished → Resolve conflicts gives three band nodes:
    - the command `git_rebase {tree: <root>, onto: origin/<resolved target>}`;
    - `Rebase status?`, with jumps "clean ↩ Fast checks" and "error → Which exit", and pill "conflict";
    - the budget node `Conflict rounds left? · 4`, with jump "no ↩ Ship gate" and pill "yes".
  - `budgetLabel` cases as above
  - `hovering a dotted link lights it and lists its folded steps, ending "Click to unfold"`
  - `clicking a dotted link opens its band with "<n> steps" and Fold; Fold closes it`
  - `opening a second fold closes the first`
  - `hovering a block lights its links and fades every other node and link`
  - `clicking a block calls onSelect with its block id`
  - `clicking a jump pans to the target, rings it for 2000ms and shows "from <source>" with Back` (mock `useReactFlow().setCenter`, fake timers)
  - `Back pans to the source`
  - `with reduced motion the pan has no duration`
  - `cards, pills and dotted links are buttons with names, reachable by Tab`
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** The tooltip is the kit's `Tooltip` (`@mattstack/app-kit/core`), multiline. The ring is an accent outline plus a soft accent shadow (a `color-mix` of `--tk-fill-accent`).
- [ ] **Step 4: Run** → PASS. Shoot each interaction state in light and dark, and measure against `block-map-interactions.{light,dark}.png`.
- [ ] **Step 5: Commit** `console: block map interactions`.

### Task 6: Every step and Around this block on elkjs

**Files:**
- Create: `blocks/FlowGraph.tsx`
- Modify: `blocks/AroundGraph.tsx` (a wrapper over `FlowGraph` with `aroundBlock`), `blocks/BlockMap.tsx` (the header's `SegmentedControl` Blocks | Every step, from the kit), `blocks/BlockView.tsx` and `graph/useWiringUrl.ts` (`select: 'graph-steps'`), `blocks/model/labels.ts` (move `shortLabel` in, with its tests)
- Delete: `blocks/model/aroundLayout.ts`, `blocks/model/aroundLayout.test.ts`
- Test: `blocks/__tests__/FlowGraph.test.tsx`, plus updates to `AroundGraph`'s and `BlockView`'s tests

**Interfaces:**
- Consumes: `graphCards`, `graphEdges`, `useGraphLayout`, `elkGraph` (Tasks 3-4); `aroundBlock` (`model/around.ts`, unchanged).
- Produces: `FlowGraph(props: { graph: Graph | AroundGraphData; skill?: string; focus: string | null; onSelect: (blockId: string) => void; engine?: () => Promise<LayoutEngine> }): JSX.Element`. Blocks show as `BlockCard`. Graph-only nodes show as `StepCard`: panel fill, no shadow, `--tk-text-2`, `shortLabel` text. The focus gets an accent border. Edge labels are ELK edge labels, placed by the tail beside the drop, drawn as small chips.

- [ ] **Step 1: Write the failing tests:**
  - `Every step draws every node of the graph` (ship Flow: one card per node)
  - `the Blocks | Every step control switches the URL between graph and graph-steps`
  - `"No blocks here" links to Every step` (Review Focus 1, finished)
  - `Around keeps one hop in and out and short cycles` (the existing cases, moved off `aroundLayout`)
  - `no edge label overlaps another edge's line or any card`: ship Every step and Around Fast checks, at canvas widths 560 and 1100, checked against the laid-out boxes and segments
  - `every edge label sits within 40px of its own edge's start or first bend`
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Delete `aroundLayout.ts` and its test once nothing imports it. Check with `grep -rn aroundLayout apps/console/src`, which must find nothing.
- [ ] **Step 4: Run** → PASS, then `bun run console:build`. Shoot Around Fast checks at 1440 and 900 and Every step at 1440, light and dark, and measure against the redrawn `block.{light,dark}.png`.
- [ ] **Step 5: Commit** `console: Every step and Around this block on elkjs`.

### Task 7: Parity sweep and docs

**Files:**
- Modify: `website/docs/apps/console.mdx` (the block view section: the block map, its interactions, Every step), `apps/console/AGENTS.md` (Wiring map: the block map, elkjs, `FlowGraph`; no `aroundLayout`)
- Shots: under `~/.fast-browser/output/skill-blocks/graphs/`

- [ ] **Step 1:** Serve the console from this worktree on the design fixture (the `blocks` scenario), as in `.superpowers/sdd/2026-10-22-skill-blocks-3-console/t10-report.md`. Through `fast-browser:browser-driver` (haiku, medium), shoot in light and dark:
  - the block map at 1440 and 900;
  - a hovered dotted link, an open fold, a hovered block, and a jump with its ring and Back;
  - Every step;
  - Around Fast checks at 1440 and 900;
  - the error state and the "No blocks here" state.
- [ ] **Step 2:** Read every shot and compare it with its board. Fix every difference, or list it as allowed with a reason. The only allowed reason is ELK's exact positions.
- [ ] **Step 3:** Update the docs (rt:docs rules for `console.mdx`). Run the docs build.
- [ ] **Step 4:** Run the gates on the final commit.
- [ ] **Step 5: Commit** `console: block map parity and docs`.

## Self-review notes

- **Spec coverage:**
  - the block map's nodes, links, jumps, trunks and count: Task 1 (model) and Task 4 (view);
  - interactions 1, 2, 4, 5 and 6: Task 5. Interaction 3 (Every step): Task 6;
  - Around restyle: Task 6;
  - layout (elkjs, worker, lazy loading, `aroundLayout.ts` deleted): Tasks 3 and 6;
  - boards: Task 2;
  - parity and docs: Task 7.
- **Corrections to the spec, made while planning and folded back into it:**
  - no new tint token: the `color-mix` with `--ui-wash` covers it;
  - jump labels come from the source block's own first edge.
