# Skill blocks: skills as trees of blocks, read one at a time in console

Status: draft for review, 2026-10-22.

Design boards: the pen.dev document `Skill Packs.pen`. The reference boards
are the three `L1`/`L2`/`L3` boards in light and dark; everything else in
that document is exploration. Renders are in
`docs/apps/design/console/skill-blocks/` (`skill`, `parent-block`, `block`,
each `.light.png` and `.dark.png`).

## Problem

People other than the author of mattstack struggle to understand team
packs: what a pack adds over plain skills, how the layers (mattstack, org
base, team) stack, and where a team's own text ends up.

Three things make that hard today.

1. **A skill is one long file.** `ship`'s engine is 796 lines. About 375 of
   them are digraph source, and four includes add another 1,279 lines, so
   the compiled verb is over 2,000 lines. The console viewer shows the
   template as one scroll.
2. **Team text lands far from the step it changes.** A pack adds text through
   a named slot such as `{{slot:domain}}`, which sits in one section near
   the end of the skill. Real packs already work around this: one team's
   domain fill has 10 sections titled `## At: <step name>`, each a rule for
   one step, and all 10 still render 150 to 700 lines away from the step
   they're about.
3. **Heading levels break at compile.** Includes and fills keep their own
   `#` levels, so a compiled verb has an H1 nested under an H2 (`## Gate
   protocol` followed by `# Gate protocol`), and its outline is scrambled.

The console Graph tab shows how one template file is assembled. It does not
answer "what does this skill do, step by step, and who shaped each step?"

## Goals

- A skill is a tree of **blocks**, each one a file, compiled into one
  markdown file for Claude.
- A team's or org's text lands **inside the block it changes**.
- Console reads **one skill at a time**, at three zoom levels (the skill, a
  parent block, a single block), with the layers visible at a glance.
- Changes still go through Claude, with the same before-and-after testing.

## Non-goals

- No editing skill text in console.
- No change to what makes Claude follow a process: the compiled verb stays
  one `SKILL.md` with its graphs as dot digraphs.
- The Graph tab's map between skills (`work` and its stages, shared files)
  stays.

## Anti-goals

- A layer replacing mattstack's text in a block. A replaced block stops
  receiving mattstack's fixes: the drift a pack exists to prevent.
- Wiring that only works by convention (a fill found by mirroring a path).
  The contract stays written down and checkable.

## Decisions

These were settled in brainstorming.

1. **A block is a markdown heading section.** A heading owns everything up
   to the next heading at the same or a higher level; deeper headings are
   its children. A skill is a tree of blocks. Compile walks the tree and
   writes markdown.
2. **Each block is a file.** A block with children is a folder.
3. **Heading levels come from depth.** A block stores its title, never `#`
   marks; compile assigns the level from its depth in the tree.
4. **Fills sit inside the block they change.** Org and team text compiles
   into the block it targets, not into one pile at the end.
5. **A block is open to fills if and only if its text contains a
   `{{fills}}` marker.** The marker also sets where fills go. When both
   layers add to a block, org text comes first, then team text, at the one
   marker. Teams don't choose the position: needing a different position is
   a request to mattstack (or the org base) to move or add a marker. A block
   that needs fills in two places should be two blocks.
6. **Bindings stay explicit in `pack/skills.jsonc`, keyed by block id.**
   Compile can then report a binding whose fill file is missing, or whose
   block no longer exists or is closed.
7. **Graphs stay in the compiled output as dot, and are authored in
   Mermaid.** Compile turns Mermaid into the same dot Claude reads today. A
   graph lives in its parent block, and its node ids are that block's
   children's ids.
8. **Console is for reading; Claude makes changes.** Each block offers
   "Copy for Claude", which copies a brief to paste into a session. Open in
   editor stays as a secondary action.
9. **The console view** is as drawn on the L1 to L3 boards and described in
   "Console" below: one skill at a time, three zoom levels, a short-label
   block tree, folded section lists, a Layers panel drawn as charts, and a
   small graph around a single block.
10. The word is **block**.

## Approaches considered

| Question | Options | Picked, and why |
|---|---|---|
| How to teach packs | A 3D or spatial explorer; diagrams about packs (layer stacks, metro maps, run replays); an editor that knows its layers | The editor. It borrows conventions people already know: template inheritance (Jinja `extends`/`block`), the CSS cascade inspector in browser DevTools, and inline Peek. The diagram boards explained the system from outside and didn't land. |
| Where fills go | One named slot per skill (today); inside the block they change | Inside the block. It's what real packs already fake with `## At: <step>` sections. |
| How a fill finds its block | Same path in the team's pack; an entry in `skills.jsonc` | `skills.jsonc`. A moved file silently stops applying under path-matching; an explicit binding can be checked. |
| How a block says it's open | `open: true` in frontmatter; a `{{fills}}` marker in its text | The marker. One mechanism answers both "can I add here?" and "where does it go?", and you can see both by reading the block. |
| How graphs are written | Hand-written dot (today); generated from per-block edge lists; Mermaid compiled to dot | Mermaid. Generating from blocks scatters the edges and hides the shape from the author. Mermaid declares nodes where they're used: `ship`'s graphs go from 73 to 37 lines and from 301 to 175. It also renders on GitHub and GitLab. The dot Claude reads doesn't change; changing that would need its own before-and-after test. |
| Editing in console | In-console editing; read-only with Edit opening the editor; read-only with a hand-off to Claude | Hand-off to Claude. Nearly every skill edit is made with Claude, and the extending-a-pack round carries the testing a text box would skip. |
| Showing the layers | A text list per layer; a chart | A chart. A part-to-whole job is a stacked bar, not a pie: in `ship` the fills are about 1% of the text, and a pie would read as one solid circle. |

## The model

### Files

`ship` as blocks:

```
ship/
  index.md                    the skill: frontmatter, title, intro
  run/
    index.md                  Run's text and its graph (Mermaid)
    resume-offer.md
    recapture-asked.md
    …
  flow/
    index.md                  Flow's text and its graph (Mermaid)
    commit-named.md
    fast-checks.md
    write-title.md
    …
  graph-notes.md
  budgets.md
  domain-rules.md
```

A block with children is a folder with an `index.md`, the convention Hugo,
Docusaurus and Next use. A plain `.md` file is a leaf.

Only graph nodes with prose get a block. Most nodes are one-line commands
that live only as Mermaid labels, so `ship` becomes 36 blocks, not one per
node (its two graphs have 144 nodes).

A block's id is its path without `.md`, with `/index` dropped:
`ship/flow/fast-checks`.

### A block file

```markdown
---
label: Fast checks
---
# Run the domain's fast checks

Only the checks the domain names, on the changed files; revert generated
drift they leave. A full suite the domain rules out stays out. …

{{fills}}
```

- The `#` is ignored for level; it marks the title line.
- `label` is the short name console shows. Without it, console uses the id
  in plain words (`fast-checks` → "Fast checks").

### Placeholders inside a block

| Placeholder | Meaning | Change |
|---|---|---|
| `{{fills}}` | Org and team text goes here | New. Marks the block open. |
| `{{include:x}}` | A shared block, the same for everyone | Unchanged. Compiles in as a child, with levels from depth. |
| `{{team.x}}`, `{{team.section:x}}` | Values an org base asks each team for | Unchanged. |
| `{{verb.path:x}}` | A path to another compiled verb | Unchanged. |
| `{{run-start.flags:x}}` | Filled by rt for each run | Unchanged. |

### Fills and bindings

A fill is a folder in the pack holding one file per block it adds to:

```
teams/widgets/plugin/attachments/ship-lint/
  fast-checks.md
  commit-named.md
```

The pack binds each file to a block in `pack/skills.jsonc`:

```jsonc
"ship/flow/fast-checks": "widgets:ship-lint/fast-checks"
```

Compile refuses a binding when:

- its fill file is missing;
- its block doesn't exist (for example, renamed in a newer mattstack);
- its block has no `{{fills}}` marker.

### Compile

1. Walk the block tree in order.
2. Give each block's title a heading level from its depth.
3. At each `{{fills}}` marker, insert the bound org fill, then the bound team
   fill. Insert nothing when there are none.
4. Turn each Mermaid graph into dot, in the same place.
5. Write one `SKILL.md`, as today.

The order of a graph's children comes from the graph. The order of other
siblings (Run, Flow, the notes blocks) is an open question, below.

## Console

### Placement

The Graph tab keeps its map between skills as the "All skills" home.
Clicking a skill opens the block view, which replaces today's template
canvas and side drawer for reading a single skill. The drawer's Used by and
History tabs move into the block view: Used by on shared blocks, History per
block. The Rebind panel goes away, since bindings change through Claude. The
unsynced banner stays.

### Three zoom levels

The sidebar selection sets the zoom level.

- **The skill (board L1).** The page title is the skill. Every section shows
  as a folded list, one row per block. The Layers panel covers the whole
  skill.
- **A parent block (board L2).** A breadcrumb (`ship › Flow`), the block's
  own text, its graph as a one-line card ("112 steps · 174 links · View
  graph"), and its children as a folded list.
- **A single block (board L3).** A breadcrumb (`ship › Flow › Fast checks`),
  the full title, the path behind a ⋯ menu, the block's text with its fills
  at the marker, and "Around this block".

### Sidebar

- "All skills" back link, then a switcher for the current skill (name, kind,
  block count).
- The block tree, using short labels (`label`, or the id in plain words) on
  one line each.
- Sections fold. Only the one holding the selection starts open.
- A kind glyph on each row: ○ step, ◇ question, ⚑ gate. Note blocks get a
  document icon, and the four shared blocks fold into one "Shared" row.
- A purple dot when the org base adds to a block, a cyan dot when the team
  does.

### Main column

- Each section heads its own band (icon, title, block count, open count),
  with its blocks in one bordered list, rows separated by lines.
- A folded row shows: kind glyph, short label, a one-line summary (the first
  sentence), fill dots, and a plug icon when the block is open.
- Paths and Open file appear only on the selected block.
- Prose is rendered: no raw backticks.

### Layers panel

Titled "Layers".

- **Where they add** (L1, L2): a block map with one square per block,
  grouped by section. Gray means mattstack only, purple means the org base
  adds, cyan means the team adds, and a split square means both. A legend
  gives the counts.
- **How much text** (L1, L2): a stacked bar of lines by layer, labelled
  with its total. mattstack's lines are its prose plus its Mermaid lines.
  In `ship`, fills are about 1% of the text.
- **This block, top to bottom** (L3): a strip in the block's own order:
  mattstack's lines, then each fill at the marker, labelled with line
  counts.

Colors: mattstack is the neutral context color (`--tk-line-1`), the org base
is purple, and the team is cyan, using the kit's fill steps. Purple and
cyan pass the dataviz palette checks against the panel surface in both
schemes (colorblind separation ΔE 9.9 in light and 12.2 in dark). Accent
stays reserved for links and selection, and warn for status.

### Around this block (L3)

A small flowchart of the graph near the selected block.

1. Parse the parent's Mermaid into nodes and edges.
2. Keep every node one hop in and one hop out, plus any cycle back to the
   block of three hops or fewer, so loops like fix-and-recheck show.
3. Lay it out on the React Flow canvas the Graph tab already uses, with a
   layered layout.
4. A node whose id matches a block file is solid and opens that block. Every
   other node is a muted outline with nothing to open, and a key explains
   which is which.
5. "View whole graph" opens the full graph.

### Copy for Claude

The main action on a block. It copies a brief like:

```
Block: ship/flow/fast-checks
  "Run the domain's fast checks"
File: …/pipeline/ship/flow/fast-checks.md
Fills go: {{fills}}, at the end
widgets: …/ship-lint/fast-checks.md
acme-base: nothing here
Pack: widgets, extends acme-base

Change a fill: mattstack:extending-a-pack
Change mattstack's text: mattstack:editing-skills
Write it with: superpowers:writing-skills

What I want:
```

A popover confirms the copy and shows the brief. It builds on console's
existing `buildAgentContext`, scoped to one block.

### Kit and tokens

Built from kit chrome (`MattstackShell`, `PageShell` with its sidebar and
content) and role tokens, per `docs/apps/ui-authoring.md`: Inter and
JetBrains Mono at weights 400, 500 and 700; hue tints for the fill cards;
no raw colors.

## Open questions

- **Sibling order outside a graph.** Run, Flow and the notes blocks need an
  order. A position field in frontmatter, as Docusaurus does, is one way.
  Number prefixes on filenames would break the stable ids.
- **Named slots that aren't about a step.** `{{slot:domain}}` appears in 10
  engines and maps cleanly onto per-block fills. Others (`reviewer`,
  `criteria`, `tiering`, `forge`, `strategy`, `reply-rules`, `accounts`)
  swap in a capability, carry contracts such as `ship-domain@1`, and can be
  required. Whether each becomes a `{{fills}}` marker in a block or stays a
  named slot is undecided.
- **Moving existing packs.** Existing domain fills (including the
  `## At: <step>` pattern) have to be split into per-block fill files and
  re-bound. Whether compile reads the old form during a transition, or packs
  convert in one step, is undecided.
- **Marking gates.** Console infers a gate from its title in the mock. A
  real marker (a frontmatter `kind`, say) is needed.
- **Short labels for graph-only nodes.** Their labels are long sentences,
  which crowd the Around-this-block chart.
- **Merging budget pairs in the small graph.** A `run_budget` command and its
  "spent?" question read better as one "rounds left?" node. That needs a
  rule.
- **The board file.** Whether `Skill Packs.pen` is committed beside
  `console.pen`.

## Calls I made

Matt didn't pick these; check them while reading.

- A block with children is a folder with `index.md`.
- A block's id is its path; `label` in frontmatter gives the short name.
- The Graph tab split: the skill map stays as home, and the block view
  replaces the template canvas and drawer. The Rebind panel goes away.
- The layer colors: purple for the org base, cyan for the team, neutral for
  mattstack.
- The small graph's rule: one hop each way plus cycles of three hops or
  fewer.
- The Copy for Claude brief's wording.
- The fills shown on the boards (widgets, acme-base) are invented. The open
  blocks on the boards are the steps a real domain fill targets today.
