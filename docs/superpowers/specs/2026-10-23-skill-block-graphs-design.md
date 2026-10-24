# Skill block graphs: the block map and Around this block

Extends `2026-10-22-skill-blocks-design.md` (the console block view). This
design replaces that spec's full-graph view and restyles its "Around this
block" chart.

## Intent

The full graph behind "View graph" (on a parent block) and "View whole graph"
(under Around this block) reads as a wall of crossing lines and stacked
labels. Ship's Flow has 112 steps and 174 links, and only 19 of those steps
are blocks. Matt ran a design pass on the canvas and picked a block map: the
blocks in flow order, with every other step folded into the links between
them. Both graphs also get a polished look. The current one reads as "flat
grey on grey" and "drab and rough".

## Goals

- The full graph shows a skill's shape at a glance: its blocks, in flow order.
- Any folded stretch can be opened in place to see every step and exit.
- No label ever sits over another line.
- Around this block and the block map share one look.
- A layout engine places the nodes and routes the lines. Hand-written code
  no longer does.

## Non-goals

- No rt change. Everything comes from the parent block's Mermaid and the
  blocks payload that the console already reads.
- No editing in the graph.
- The pipeline map (`work · feature`) is out of scope.

## Anti-goals

These count as failures even if everything else works:

- a label on top of another edge's line;
- text chips stacked between nodes;
- long loop-back channels running down the side of the graph.

## Constraints

- **Kit:** chrome and role tokens only (`docs/apps/ui-authoring.md`). Tints
  mix a role colour with `--ui-wash`
  (`color-mix(in srgb, var(--tk-…) var(--ui-wash), transparent)`), the way
  the block view's prop cards already do. The end badge mixes
  `--tk-dot-ok`, so no new token is needed.
- **Drawing:** React Flow (`@xyflow/react`), already a console dependency.
- **Layout:** elkjs, a new dependency added through the catalog. It loads
  with the graph view only.
- **Copy:** rt:ui-copy (short clauses).
- **Names:** fixtures use invented names only.
- **Shots:** Fast Browser shots in light and dark before any UI milestone
  counts as done.

## Approaches considered

| Choice | Options | Picked |
|---|---|---|
| The full graph | A, exit ports: every step kept, exits as chips on the question card, loops as jumps · B, folded plumbing: A with budget pairs merged and commands hidden · C, block map: blocks only, other steps folded into the links | **C** ("easiest to understand") |
| How a folded link shows | a count circle on the line · a dotted line · a chevron handle under the block | **Dotted line**: the calmest. The count shows on hover. |
| Layout | elkjs (layered, routes right-angled lines itself) · dagre (layers only, no routing) · adapt our own `aroundLayout.ts` | **elkjs**. Every parity round so far was spent in the hand-written layout. |
| Around this block | adopt the new look · keep its current board | **Adopt the new look.** Its board gets redrawn. |

The boards for A, B and the fold markers stay in `Skill Packs.pen` as the
record (frames "Whole graph · options" and "Fold marker options").

## The block map

Board: `docs/apps/design/console/skill-blocks/block-map.light.png` (frame
"C · Block map · polished").

### Where it opens

It replaces today's full-graph view, in the same place in the main column,
from the same two entry points.

### Header

- "Block map", then "<n> blocks · <m> steps folded".
- A segmented control: Blocks | Every step.
- Close.

### Nodes

- **Which nodes:** one node per block that names a graph node (`node:`), plus
  the success end (the Mermaid node with the `:::done` class).
- **Card:** 40px tall, 9px radius, the card surface, a soft border and a soft
  shadow.
- **Kind badge:** a 20px badge per kind:

  | Kind | Badge |
  |---|---|
  | Step | accent tint, circle |
  | Question | raised fill, diamond |
  | Gate | warn tint, flag |
  | End | `tk-tint-ok`, check |

- **Title:** 13px, weight 500, primary text.
- **Layer dots:** purple when the org base passes a value to a prop in the
  block, cyan when the team does. This is the sidebar's rule.
- **Width:** blocks on the main column share one width, set by the widest.
  Side blocks size to their content.

### Links

The model, `blockMap()`, decides which links exist and how each is drawn.
The boards decide the look. Where the hand-drawn board and the model
disagree on content, the model wins, and the board is redrawn from the
model's output on ship's Flow (see Boards).

- **Exit nodes.** An end is a node with no outgoing edges or a Mermaid end
  (`(((…)))`). A graph-only node is an exit node when every path out of it
  reaches an end without passing a block. In ship that is `which_exit` and
  everything after it.
- **What links.** Walk forward from each block through graph-only nodes.
  Stop at the first block, and also stop on entering an exit node. Each
  block reached is a link. Paths that reach the same block merge into one
  link, and its folded steps are the union of the graph-only nodes they pass
  through. Paths that enter an exit node are dropped, with one exception: a
  block with no links, or whose only links loop back to itself, links to
  the success end (Mark ready → Shipped, whose only other path loops back
  to itself). The other ends never appear in the map.
- **Solid or dotted.** A link that passes no graph-only node is a solid
  line. Any other link is dotted: round 2.4px dots every 5px. This applies
  even to a link that only passes plumbing; Reopened → Domain steps is
  dotted.
- **Line style.** Both kinds are 1.5px in `tk-line-1`, right-angled with a
  10px corner radius, with filled arrowheads.
- **Flow order and layers.** Flow order is the reverse postorder of a
  depth-first walk of the full graph from the trigger, taking each node's
  edges in Mermaid declaration order. An edge to a node still on the walk's
  stack is a back edge, which is exactly an edge that goes backwards in
  that order, so a link whose target sits at or before its source is a
  back link. Layers are longest-path layers of the block map with its back
  links removed. Both are computed in the model, before ELK runs.
- **Jumps.** A back link is not drawn as a line. It becomes a jump pill
  beside its source: accent tint, a ↩ icon and the target. A forward link
  that skips three or more layers becomes a → pill the same way.
  - **Label:** the pill leads with the label of the source block's own
    first edge on the path, cut at its first colon ("iterate ↩ Domain
    steps", "yes → Capture"). With no such label it shows just the target
    ("↩ Fast checks"). Budget loops show too: Fast checks gets "↩ Ship gate"
    for when fix rounds run out. Hovering a pill lists its folded steps, the
    same way a dotted link does.
  - **One target or several:** when a jump reaches several blocks through
    one folded question, it is one pill. It is named by the targets' shared
    leading word when they have one ("Capture"), else by that question's
    short label. Clicking it pans to fit all its targets and rings each one.
  - **Several sources:** sibling blocks with the same jump (same label, same
    targets) share one pill, beside the last sibling. Jumps that differ in
    label or target keep their own pills.
- **Shared trunks.** Two forward links from one block that share folded
  steps are drawn as one trunk that splits at the folded question where
  their paths part. The main line follows each split question's
  first-declared edge and stays a line however many layers it skips. A
  branch stays in the trunk unless it skips three or more layers and more
  than the main line does; then it leaves the trunk and follows the jump
  rule (Reopened's "yes → Capture"). The split is a junction node in the ELK graph, with no
  visible box. The branch carries that question's exit label, cut at its
  first colon ("refused or errored" on Rebases unfinished → Push refused,
  where it leaves the push steps). By the
  same rule, Which forge branches off the Rebases unfinished → Create MR
  trunk at the forge question, not out of Create MR as the hand-drawn board
  shows.
- **Shared splits.** When forward links from two or more blocks pass the
  same folded question and part there toward two or more blocks, that
  question becomes one split on the map, drawn as a small dot. Each block
  draws one dotted line into it, and the split draws one line per exit,
  labelled with the exit ("GitLab", "anything else"). Its long exits become
  pills beside the dot ("GitHub → Capture"). Budget questions never split,
  and a block whose line into the split would skip three or more layers
  keeps its own links unless that line is its main line. On ship's Flow the
  forge question, the browser-or-case question and "every named case
  tried?" become splits. Matt chose this over per-block trunks, which
  tangled where three blocks reach the forge question.
- **Main column.** It follows each block's main line and, from a split,
  the split's first-declared exit. It is not the longest path, which runs
  through the side branches.
- **Exit labels elsewhere.** A plain line carries no exit label.
- **The count.** The header counts the map's block nodes. For ship's Flow
  that is 21, not the board's 19.

### Canvas and key

- The canvas is React Flow's dot background (16px gap) on the panel
  surface, with a 12px rounded border.
- The key under the canvas reads: step, question, gate, org base adds, team
  adds, steps folded, loops back.

## Interactions

Board: `docs/apps/design/console/skill-blocks/block-map-interactions.light.png`
(frame "C · Interactions").

1. **Hover a dotted link.** The link turns accent. A dark tooltip lists its
   folded steps, each with its kind icon (a terminal icon for a command, a
   diamond for a question), and ends "Click to unfold".
2. **Click a dotted link.** Its steps open in place, inside an accent-tint
   band headed "<n> steps" with a Fold button. Inside the band:
   - a command shows as a mono line;
   - a question shows as a card with its exits. An exit that leaves the band
     is a jump row ("clean ↩ Fast checks"). An exit that continues inside
     the band is a pill on the card.
   - a `run_budget` step and its "spent?" question merge into one card,
     "<name> rounds left? · <limit>".

   The map below moves down to make room. One fold is open at a time;
   opening another closes the first. A band is a small graph of its own,
   laid out by ELK as a compound node, so a fold that splits and rejoins
   (the two pushes) keeps its shape.
3. **Every step.** This is the real full graph: all of a skill's steps, with
   blocks as cards and graph-only steps as muted cards. It uses the new look
   and ELK routing, and exit labels follow the board convention. It is not
   every band open at once, which would repeat the steps that folds share.
4. **Hover a block.** Its links and their dotted markers turn accent, and
   its border turns accent. Every other node and link fades to 40%.
5. **Click a block.** It opens that block's page (zoom level L3), as today.
6. **Click a jump pill.** The view pans to the target. An accent ring marks
   the target for about two seconds, and a "from <source> · Back" pill sits
   beside it. Back pans to the source. With reduced motion, the view moves
   without animating.

Blocks, dotted links and pills are buttons with labels, and you can reach
them with the keyboard.

## Around this block

- It uses the same cards, badges, dots, rounded lines and dotted canvas as
  the map.
- What it includes doesn't change: one hop in and out, plus cycles of three
  hops or fewer.
- Graph-only nodes show as muted cards: panel fill, no shadow, secondary
  text. These are the cards the unfolded band uses.
- Edge labels follow the board convention: beside the drop, or under the
  bend. elkjs places them as edge labels.
- Its board, the Around section of L3 in light and dark, is redrawn in the
  new look before implementation.

## Layout

- **Algorithm:** elkjs `layered`, direction down, orthogonal edge routing.
  Spacing matches the boards: 36px between node rows, and node placement
  that keeps the main path in one column.
- **Loading:** elkjs runs in a web worker and loads with the graph view
  only.
- **Old code:** the layout and routing in `blocks/model/aroundLayout.ts` are
  deleted. Its tests make way for tests on the graph model and on the ELK
  option mapping.
- **Parity:** the strict-parity rule measures the look against the new
  boards: styling, the label conventions, a straight main column, side
  branches, and no label over another line. elkjs sets the exact positions.

## Data

- **Inputs:** the parent block's parsed Mermaid (Around already parses it),
  the node-to-block mapping, the kinds and the layer colours, all from the
  blocks payload.
- **Model:** a pure function, `blockMap(graph, blocks)`, following the rules
  under Links. It returns:
  - the block nodes, plus the success end;
  - links as `{ from, to: blockId[], folded: nodeId[], kind: "line" |
    "jump-back" | "jump-forward", label?, trunk? }`, where `trunk` names the
    shared-trunk group and the folded node where this link splits off;
  - the flow order and the layers.

  It gets proven headless on ship's Flow before any UI is built on it.

## Boards

- **Committed:** `block-map.light.png` and `block-map-interactions.light.png`
  in `docs/apps/design/console/skill-blocks/`.
- **To draw:** the block map's content is redrawn from `blockMap()`'s output
  on ship's Flow once the model exists. That adds the budget-loop pills,
  makes some solid links dotted, and moves the Which forge branch. Then come
  the dark versions of both boards, and the Around section of
  `block.{light,dark}.png` in the new look.
- **Who draws:** I draw all of these in `Skill Packs.pen`, as plan steps
  between the model task and the UI tasks. The UI tasks wait for them.
- **Source:** frames in `Skill Packs.pen`.

## Relation to the earlier spec

- **Superseded:** the full-graph view, and steps 3-4 of "Around this block",
  the look and how it is laid out. The 2026-10-22 spec's other rules stand.
- **Answered:** that spec's open question on merging budget pairs. In an
  open fold and in Every step, a pair is one card. Its question on short
  labels for graph-only nodes keeps ruling R123: drop a trailing qualifier
  that names the skill.

## My calls (Matt to check)

- **The model over the hand-drawn board:** the model decides which links
  exist, and the board's content is redrawn from it. The look stays as
  approved, but the map gains loops the board left out (budget loops such
  as "↩ Ship gate"), some links turn dotted, and Which forge moves.
- **Exits:** the cut-off at exit nodes. Failure, hold and abort exits stay
  off the map; they show in an open fold and in Every step.
- **Jump threshold:** a forward link that skips three or more layers becomes
  a jump pill.
- **Jump grouping:** one pill for several targets, and one pill shared by
  sibling sources.
- **Open folds:** one at a time, with Every step as the real full graph.
  This replaces "several at once".
- **Parity:** measured against the boards' look and conventions. elkjs owns
  the exact positions.
- **Delivery:** this ships as plan 6 on this branch, inside the same PR as
  plans 2-5.
