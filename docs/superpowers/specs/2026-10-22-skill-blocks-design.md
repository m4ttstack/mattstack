# Skill blocks: skills as trees of blocks, read one at a time in console

Status: draft for review, 2026-10-22.

Design boards: the pen.dev document `Skill Packs.pen`. The reference boards
are the three `L1`/`L2`/`L3` boards in light and dark; everything else in
that document is exploration. Renders are in
`docs/apps/design/console/skill-blocks/` (`skill`, `parent-block`, `block`,
each `.light.png` and `.dark.png`). The boards were drawn before props
replaced the `{{fills}}` marker: read a board's `{{fills}}` box as the
block's prop, and its "Open" badge as "has props".

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
- A block takes **props**, the way a React component does. A pack passes
  values to them, and a team's or org's text lands inside the block it
  changes.
- Console reads **one skill at a time**, at three zoom levels (the skill, a
  parent block, a single block), with the layers visible at a glance.
- Changes still go through Claude, with the same before-and-after testing.

## Non-goals

- No editing skill text in console.
- No change to what makes Claude follow a process: the compiled verb stays
  one `SKILL.md` with its graphs as dot digraphs.
- The Graph tab's map between skills (`work` and its stages, shared files)
  stays.
- Converting existing team packs automatically. Today there are two team
  packs, both maintained by the mattstack maintainer; they are converted by
  hand as part of the rollout.

## Anti-goals

- A layer replacing mattstack's own text in a block. A pack only ever passes
  props; text outside a `{{props.x}}` marker belongs to mattstack, and a
  replaced block would stop receiving mattstack's fixes, the drift a pack
  exists to prevent.
- Wiring that only works by convention (a fill found by mirroring a path).
  The contract stays written down and checkable.

## Decisions

These were settled in brainstorming.

1. **A block is a file, the way a component is.** It has one title (its
   top heading), or none for a headless block, and the title sets where it
   sits in the outline. Inside, it can
   be as large or small as its content needs: paragraphs, tables and
   sub-headings. A skill is a tree of blocks; a block with child blocks is a
   folder. Compile walks the tree and writes markdown.
2. **Decompose by default, not by dogma.** Aim for the decomposition
   headings give today: a section that stands on its own becomes its own
   block. Keep a cohesive chunk in one block where splitting it would make
   it harder to understand. Two rules are fixed: a graph node with prose
   gets its own block (the graph links to it), and a part that needs its
   own identity (sidebar row, history, owner) gets its own block. A block
   may also be headless (no title), rendering inline where it's used.
3. **Heading levels come from depth.** A block stores its title, never `#`
   marks; compile assigns the level from its depth in the tree.
4. **A block takes props.** A `{{props.x}}` marker in a block's text is
   where a pack's value for prop `x` goes. A block can have any number of
   props. Props replace both of today's mechanisms: named slots
   (`{{slot:tiering}}`, `{{slot:domain}}` and the rest) and the
   `{{fills}}` marker from earlier drafts.
5. **There is one kind of prop. Each declares how it merges and whether it
   has a default**, the way rt settings declare `merge` per key:
   - `merge: add`: every layer's value stacks, org first, then team.
     Today's domain rules.
   - `merge: replace`: the last layer wins. Today's tiering, forge and
     reviewer slots.
   - `default`: used when no layer passes a value. `default: ""` makes the
     prop optional and empty. No `default` makes it required: compile stops
     if no layer passes one.
6. **A prop may name a contract**, the type of value it accepts
   (`contract: model-tiering@1`), checked against the fill's `provides`
   exactly as slots are checked today. Contracts keep their version; a
   block's prop list (its signature) does not get one.
7. **Bindings stay explicit in `pack/skills.jsonc`**, keyed by block, then
   by prop. Compile reports a binding whose fill is missing, whose block no
   longer exists, or whose prop the block doesn't declare.
8. **A team can clear a lower layer's value** for a prop with an empty
   binding (`""`), as slots allow today. A cleared prop falls back to its
   `default`; clearing a required prop (no `default`) stops compile.
   Replacing mattstack's own text stays impossible.
9. **Graphs stay in the compiled output as dot, and are authored in
   Mermaid.** Compile turns Mermaid into dot Claude reads the way it does
   today. A graph lives in its parent block, and each child block is tied to
   a node in that graph (see "Graphs").
10. **Console is for reading; Claude makes changes.** Each block offers
    "Copy for Claude", which copies a brief to paste into a session. Open in
    editor stays as a secondary action.
11. **The console view** is as drawn on the L1 to L3 boards and described
    in "Console" below.
12. **Every engine converts in the first build.** All of mattstack's
    engines and shared includes move to blocks together, so there is no
    period where engines come in two formats.
13. **Testing the conversion.** `ship` gets the full before-and-after test
    with fresh agents (superpowers:writing-skills). Every other engine gets
    a reviewed diff of its compiled output (see "Testing").
14. **Breaking changes to props are caught in mattstack's CI**, not by
    versioning signatures (see "Prop signature check").
15. The word is **block**.
16. **A language server for blocks**, VS Code first, and Claude Code where
    it's the same server (see "Language server").

## Approaches considered

| Question | Options | Picked, and why |
|---|---|---|
| How to teach packs | A 3D or spatial explorer; diagrams about packs (layer stacks, metro maps, run replays); an editor that knows its layers | The editor. It borrows conventions people already know: template inheritance (Jinja `extends`/`block`), the CSS cascade inspector in browser DevTools, and inline Peek. The diagram boards explained the system from outside and didn't land. |
| Where a team's text goes | One named slot per skill (today); inside the block it changes | Inside the block. It's what real packs already fake with `## At: <step>` sections. |
| How a fill finds its block | Same path in the team's pack; an entry in `skills.jsonc` | `skills.jsonc`. A moved file silently stops applying under path-matching; an explicit binding can be checked. |
| How a block marks where text goes | `open: true` in frontmatter; a `{{fills}}` marker; separate `{{fills}}` (add) and `{{swap}}` (replace) markers; props | Props. One mechanism covers adding, replacing, defaults, several spots in one block, and today's named slots. It borrows React's component props and rt settings' `merge`. |
| Several spots in one block | Split into more blocks; named spots | Props: a block declares as many as it needs. |
| Versioning | A version on each block's prop signature; contract versions only, plus a CI check | Contract versions plus a CI check. A signature version would make every team re-pin bindings on every release, even when nothing they use changed. |
| How graphs are written | Hand-written dot (today); generated from per-block edge lists; Mermaid compiled to dot | Mermaid. Generating from blocks scatters the edges and hides the shape from the author. Mermaid declares nodes where they're used: `ship`'s graphs go from 73 to 37 lines and from 301 to 175. The dot Claude reads doesn't change in meaning. |
| Editing in console | In-console editing; read-only with Edit opening the editor; read-only with a hand-off to Claude | Hand-off to Claude. Nearly every skill edit is made with Claude, and the extending-a-pack round carries the testing a text box would skip. |
| Showing the layers | A text list per layer; a chart | A chart. A part-to-whole job is a stacked bar, not a pie: in `ship` the fills are about 1% of the text, and a pie would read as one solid circle. |

## The model

### Files

`ship` as blocks:

```
ship/
  index.block.md                    the skill: frontmatter, title, intro
  run/
    index.block.md                  Run's text and its graph (Mermaid)
    resume-offer.block.md
    recapture-asked.block.md
    …
  flow/
    index.block.md                  Flow's text and its graph (Mermaid)
    commit-named.block.md
    fast-checks.block.md
    write-title.block.md
    …
  graph-notes.block.md
  budgets.block.md
  domain-rules.block.md
```

A block with children is a folder with an `index.block.md`, the convention
Hugo, Docusaurus and Next use (`index.md` there). A plain `.block.md` file
is a leaf. Fill files a pack passes as values stay plain `.md`.

Only graph nodes with prose get a block. Most nodes are one-line commands
that live only as Mermaid labels, so `ship` becomes 36 blocks, not one per
node (its two graphs have 144 nodes).

A block's id is its path without `.block.md`, with `/index` dropped:
`ship/flow/fast-checks`.

### A block file

```markdown
---
node: domain_fast_checks
label: Fast checks
props:
  rules: { merge: add, default: "" }
---
# Run the domain's fast checks (none when unbound)

Only the checks the domain names, on the changed files; revert generated
drift they leave. A full suite the domain rules out stays out. …

{{props.rules}}
```

```markdown
---
label: Tiering
order: 1
props:
  tiering: { merge: replace, default: mattstack:model-tiering, contract: model-tiering@1 }
---
# Tiering

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

{{props.tiering}}
```

Frontmatter fields:

| Field | Meaning |
|---|---|
| `node` | Ties the block to its node in the parent's graph (see "Graphs"). |
| `label` | The short name console shows. Without it, console uses the id in plain words (`fast-checks` → "Fast checks"). |
| `order` | Position among siblings that aren't ordered by a graph (see "Order"). |
| `kind` | `gate` for a block that stops and asks the human through a form. Steps and questions come from the graph's shapes; gates need saying. |
| `props` | Each prop's `merge`, `default` and optional `contract`. |

The `#` line is the title; its level is ignored. A block without one is
headless: its text renders inline at its parent's level, with no heading of
its own, and any sub-headings in it sit one level below the parent's. A
headless block still gets a sidebar row, labelled by `label` or its id. Sub-headings inside a block belong to it: they get levels from
depth like everything else, and they are not blocks (they don't show in the
sidebar and have no history of their own). Props make a spot inside a block
addressable, so a sub-heading never needs to become a block just to take a
pack's text.

### Placeholders inside a block

| Placeholder | Meaning | Change |
|---|---|---|
| `{{props.x}}` | Where prop `x`'s value goes | New. Replaces `{{slot:x}}`. |
| `{{include:x}}` | A shared block, the same for everyone | Unchanged in meaning (see "Includes"). |
| `{{team.x}}`, `{{team.section:x}}` | Values an org base asks each team for | Unchanged. |
| `{{verb.path:x}}` | A path to another compiled verb | Unchanged. |
| `{{run-start.flags:x}}` | Filled by rt for each run | Unchanged. |

### Fills and bindings

A fill stays a skill folder, and its `SKILL.md` frontmatter keeps what a
fill carries today: `description`, `version`, `allowed-tools` and
`metadata.provides`. A value passed to a prop is either:

- **a whole skill**, `plugin:skill`: its `SKILL.md` body is the value (how
  `mattstack:model-tiering` fills tiering today), or
- **one file beside a skill's `SKILL.md`**, `plugin:skill/file`: that file is
  the value, and the `SKILL.md` carries only frontmatter. This is how a team
  splits its rules across steps:

```
teams/widgets/plugin/attachments/ship-lint/
  SKILL.md            frontmatter only: description, allowed-tools
  fast-checks.md
  commit-named.md
```

The pack binds values in `pack/skills.jsonc`, keyed by engine ref plus block
path, then by prop:

```jsonc
"mattstack:ship/flow/fast-checks": { "rules": "widgets:ship-lint/fast-checks" },
"mattstack:shepherdr/tiering": { "tiering": "widgets:our-tiering" }
```

- A per-file value is inlined at its marker. A whole-skill value follows
  today's rule: a registered public skill renders as a one-line reference
  to invoke it (how `mattstack:model-tiering` reaches `shepherdr` today,
  which keeps that context small), and any other whole skill is inlined.
- The `plugin:skill/file` form is new, so the bindings schema moves to the
  next version and its value pattern allows one `/`.
- Layering per prop follows its `merge`: `add` stacks org then team;
  `replace` keeps the last layer's value. An empty binding (`""`) clears the
  lower layers' values for that prop.
- Per-pipeline bindings and stage copies carry over unchanged, now keyed by
  block and prop.
- Engines that repeat the same steps (`ship` and `stage-ship`) keep separate
  block trees. A pack binds each one.
- mattstack's defaults live on the props (`default:`), so mattstack's own
  `pack/skills.jsonc` no longer needs default lines.

Compile refuses:

- a required prop (no `default`) that no layer passes;
- a binding whose fill is missing;
- a binding whose block doesn't exist (for example, renamed in a newer
  mattstack), or whose prop the block doesn't declare;
- a value whose `provides` doesn't match the prop's `contract`. A
  `plugin:skill/file` value is checked against its skill's `provides`, so
  a skill whose files feed several contracted props must satisfy each
  one;
- an old-style binding to a `{{slot:x}}` that no longer exists. The error
  names the engine and lists its props, since one old slot (`domain`)
  maps to many props.

### Prop signature check

mattstack's CI compares every block's props with the tree at the last
release tag and fails on a breaking change unless the PR body names it, one
line per change in the form `props-change: <engine>/<block>.<prop>: <what
changed>` (the same pattern as today's `engine-floor:` line). Breaking
changes are:

- a prop removed or renamed;
- a new prop with no `default` (newly required);
- a prop's `merge` flipped (an `add` turning into `replace` would make a
  lower layer's text vanish silently);
- a prop's `contract` moved to a new version.

### Order

- A graph's children follow the graph: the order their nodes first appear in
  the parent's Mermaid source.
- Other siblings (Run, Flow, the notes blocks) follow `order`, lowest
  first. Siblings without `order` come after those with one, by filename.
- Converting an engine sets `order` so the compiled verb keeps today's
  section order.

### Graphs

- Node ids keep today's short-id rules (`check-dot.py --short-ids`):
  snake_case, command nodes start with their call word, STOP nodes start
  with `stop_`. A block names its node with `node:`, so block ids
  (kebab-case paths, used for bindings) and node ids (used in graphs) stay
  separate.
- The block's title is the node's label, as one source. In Mermaid a block
  node may omit its label; compile fills it from the title and refuses a
  label that disagrees.
- Shapes map one to one: `([…])` trigger (ellipse), `{…}` question
  (diamond), `[…]` step (box), `[/…/]` command (plaintext), `(((…)))` end
  (doublecircle). STOP nodes and the green done node use Mermaid classes
  (`:::stop`, `:::done`) that compile turns into today's octagon and fill
  attributes.
- The compiled dot must pass `check-dot.py --short-ids` with the same node
  ids and edges as today, so existing digraph fixtures stay valid. Its
  formatting doesn't have to match byte for byte.

### Includes

- Shared includes (`gate-protocol`, `browser-evidence` and the rest) become
  blocks like engines, decomposed by the same rule: a cohesive include can
  stay one block with sub-headings, and a heading-less one
  (`spawned-no-run-guard`) is a headless block.
- `{{include:x}}` renders the include's tree at the marker, as a child of
  the block that names it, with levels from depth. When the include's
  title repeats the title of the block that includes it (`## Gate
  protocol` holding `{{include:gate-protocol}}`), the repeat is dropped.
  Compile and `rt skills expand` apply the same rule.
- An include that carries headings must be the last thing in its block:
  text after it would fall under the include's last heading. Compile
  refuses text after such an include. An include with no headings
  (`spawned-no-run-guard` today) is inline text and may sit anywhere.
- Today, seven include sites in three engines have text after a
  heading-carrying include in the same section: `review` (after
  `review-core-body`, `review-dispatch-body` and `review-posting`),
  `self-review` (two sites) and `receive-review` (two sites). Converting
  them moves that trailing text into its own block right after the
  include's block (see "Testing"). The other sites, `run-identity` among
  them, already end their block.
- Skills outside mattstack that expand includes (the board's launcher
  skills) get the same flattened text.

### Compile

1. Walk the block tree in order.
2. Give each block's title a heading level from its depth.
3. At each `{{props.x}}` marker, insert the merged value: the default, or
   the layers' values merged by the prop's `merge`. A titled block whose
   text renders blank (only empty props, no children) is left out with its
   heading, as an unbound slot's heading is today.
4. Turn each Mermaid graph into dot, in the same place.
5. Write one `SKILL.md`, as today.

### Testing

- `ship` converts first and is tested before and after with fresh agents,
  following superpowers:writing-skills: the same scenarios against today's
  compiled verb and the block-compiled one.
- Every other engine and include converts with a reviewed diff of its
  compiled output. The expected differences are:
  - heading levels;
  - a pack's text moving from the old slot section into the block it's
    about;
  - dot formatting, compared after normalizing: the same node ids, labels,
    shapes and edges;
  - in `review`, `self-review` and `receive-review`, text that followed a
    heading-carrying include moving into its own block right after it,
    with the new block's heading (see "Includes");
  - an include's repeated title dropped (see "Includes").
  Anything else fails review.

### Rollout of the two team packs

Converting the engines removes `{{slot:domain}}` and the other named slots.
Compile then refuses each pack's old bindings, naming the engine and its
props. The two existing team packs are converted by hand, with
Claude, as part of the rollout: their domain rules split into per-block
files and rebound to props.

## Language server

Writing blocks gets editor support from one language server, built on
compile's own parser and checks so the two never disagree.

- **Files:** block files are named `*.block.md`. Forges still render them as
  markdown in MR diffs, and editors and the server target the pattern.
- **Diagnostics with ranges:** every compile check (unknown prop, required
  prop with no value, contract mismatch, text after a heading-carrying
  include, a node label that disagrees with the title, a binding to a
  missing block or prop) reports the file plus line and column. Compile
  prints them; the server shows them as you type.
- **Features, in order:**
  1. diagnostics;
  2. hover on `{{props.x}}`: its merge, default and contract, and each
     layer's value;
  3. go to definition: `{{include:x}}` to its block, `node:` to the Mermaid
     node, a binding in `skills.jsonc` to its block and prop;
  4. completion: prop names, include names, contract ids, and block ids
     and props in `skills.jsonc`;
  5. find references and rename for a prop: right-click a prop (in the
     block's frontmatter, at a `{{props.x}}` marker, or in a binding) to
     list or rename every use. Rename updates the declaration, every
     marker, and every binding in the open workspace. Bindings in packs
     outside the workspace can't be reached, so renaming a mattstack prop
     is still a breaking change for the prop signature check;
  6. rename a block: changing a block's id moves its file (or folder) and
     updates every binding keyed on it and every `{{include:x}}` naming
     it, in one workspace edit. `node:`, title and label are untouched.
     The same workspace limit applies, and the prop signature check
     treats a renamed block as a breaking change (its props were removed
     under the old id).
- **Editors:** VS Code first, through an extension that launches the
  server. Claude Code registers the same server through the mattstack
  plugin; that is in scope as long as it is only registration, with no
  second server. The extension ships inside mattstack.app beside
  `rt-context.vsix`, and setup installs it into every editor it installs
  `rt-context` into, on a fresh install and on every update, so existing
  users get it without a step of their own.
- **Skill paths:** a compiled source that reaches into another skill or
  attachment by a hand-typed path (`../`, `${CLAUDE_SKILL_DIR}/../`,
  `${CLAUDE_PLUGIN_ROOT}/`) is a compile error, `hand-typed-path`, whose
  diagnostic names the `{{pack.path:…}}` or `{{verb.path:…}}` to use. Hand-authored
  plugin skills, which compile never reads, get a `rt skills check` lint
  that each such path resolves. The server shows the error with a quick
  fix, completes and hovers both placeholders, opens their targets, and
  rewrites them when a target is renamed or moved. A file a built skill
  opens through `{{pack.path:…}}` is a rendered copy in that skill's own
  `references/` folder, so no agent reads unrendered pack source.
- **Not in scope:** renaming contracts, and other editors (Zed).

## Console

### Placement

The Graph tab keeps its map between skills as the "All skills" home.
Clicking a skill opens the block view, which replaces today's template
canvas and side drawer for reading a single skill. The drawer's Used by and
History tabs move into the block view: Used by on shared blocks, History per
block. The Rebind panel goes away, since bindings change through Claude. The
unsynced banner stays.

A skill that isn't a block tree (a team's hand-written skill) opens in the
same view, with its headings parsed into a read-only tree.

### Three zoom levels

The sidebar selection sets the zoom level.

- **The skill (board L1).** The page title is the skill. Every section shows
  as a folded list, one row per block. The Layers panel covers the whole
  skill.
- **A parent block (board L2).** A breadcrumb (`ship › Flow`), the block's
  own text, its graph as a one-line card ("112 steps · 174 links · View
  graph"), and its children as a folded list.
- **A single block (board L3).** A breadcrumb (`ship › Flow › Fast checks`),
  the full title, the path behind a ⋯ menu, the block's text with each
  prop's value at its marker, and "Around this block".

### Sidebar

- "All skills" back link, then a switcher for the current skill (name, kind,
  block count).
- The block tree, using short labels on one line each.
- Sections fold. Only the one holding the selection starts open.
- A kind glyph on each row: ○ step, ◇ question, ⚑ gate. Note blocks get a
  document icon. Top-level include blocks fold into one "Shared" row
  (`ship` has four); an include inside another block shows under that block.
- A purple dot when the org base passes a value to a prop in the block, a
  cyan dot when the team does.

### Main column

- Each section heads its own band (icon, title, block count, how many
  blocks have props), with its blocks in one bordered list, rows separated
  by lines.
- A folded row shows: kind glyph, short label, a one-line summary (the first
  sentence), layer dots, and a plug icon when the block has props.
- Paths and Open file appear only on the selected block.
- Prose is rendered: no raw backticks.
- On a single block, each prop shows as a framed box at its marker: the
  prop's name, its merge and default, and each layer's value in its layer's
  tint (org then team for `add`; the winning value for `replace`, with the
  default shown when nothing is passed).

### Layers panel

Titled "Layers".

- **Where they add** (L1, L2): a block map with one square per block,
  grouped by section. Gray means mattstack only, purple means the org base
  passes a value, cyan means the team does, and a split square means both.
  A legend gives the counts.
- **How much text** (L1, L2): a stacked bar of lines by layer, labelled
  with its total. mattstack's lines are its prose plus its Mermaid lines; a
  replaced default counts toward the layer that replaced it. In `ship`, the
  packs' text is about 1% of the total.
- **This block, top to bottom** (L3): a strip in the block's own order:
  mattstack's lines, then each prop's value at its marker, labelled with
  line counts.

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
4. A node whose id a block names (`node:`) is solid and opens that block.
   Every other node is a muted outline with nothing to open, and a key
   explains which is which.
5. "View whole graph" opens the full graph.

### Copy for Claude

The main action on a block. It copies a brief like:

```
Block: ship/flow/fast-checks
  "Run the domain's fast checks"
File: …/pipeline/ship/flow/fast-checks.block.md
Props: rules (add, optional)
  widgets: …/ship-lint/fast-checks.md
  acme-base: nothing passed
Pack: widgets, extends acme-base

Change a prop's value: mattstack:extending-a-pack
Change mattstack's text: mattstack:editing-skills
Write it with: superpowers:writing-skills

What I want:
```

A popover confirms the copy and shows the brief. It builds on console's
existing `buildAgentContext`, scoped to one block.

### Kit and tokens

Built from kit chrome (`MattstackShell`, `PageShell` with its sidebar and
content) and role tokens, per `docs/apps/ui-authoring.md`: Inter and
JetBrains Mono at weights 400, 500 and 700; hue tints for the layer
values; no raw colors.

## Open questions

- **Short labels for graph-only nodes.** Their labels are long sentences,
  which crowd the Around-this-block chart.
- **Merging budget pairs in the small graph.** A `run_budget` command and its
  "spent?" question read better as one "rounds left?" node. That needs a
  rule.
- **The board file.** Whether `Skill Packs.pen` is committed beside
  `console.pen`.

None of these block planning: the first two are console polish, the last is
housekeeping.

## Calls I made

Matt didn't pick these; check them while reading.

- A block with children is a folder with `index.block.md`.
- How `domain` converts (Matt chose spreading every engine now): in every
  engine with `{{slot:domain}}`, a `rules` prop goes on each step where the
  engine's own text says the domain acts ("(none when unbound)", a "Domain
  hook" paragraph, or text naming the domain), plus one on the block that
  held the slot for rules that aren't about one step.
- A titled block that renders blank (only empty props, no children) is left
  out with its heading, as an unbound slot's heading is today.
- An include that is also a fill (`execution-strategy`) stays a skill folder
  with a `SKILL.md` and is included as today, since a fill keeps that form.
- Block files are named `*.block.md` rather than `*.block`, so forges keep
  rendering them as markdown. (So a folder block's file is
  `index.block.md`.)
- The language server's feature list and what's out of scope.
- A block's id is its path; `label` gives the short name; `kind: gate`
  marks gates.
- Sibling order: graph order for a graph's children, `order` for the rest.
- Graphs: `node:` ties a block to its node, node ids keep today's short-id
  rules, the block title is the node label, the shape mapping above, and dot
  compared after normalizing rather than byte for byte.
- Headless blocks render inline at their parent's level.
- An include that carries headings must end its block; trailing text in
  `review`, `self-review` and `receive-review` moves into its own block.
- Bindings key on engine ref plus block path, then prop. A value is a whole
  skill or one file beside a skill's `SKILL.md`. `ship` and `stage-ship`
  are bound separately.
- An empty binding clears lower layers for a prop.
- What the prop signature check fails on.
- The Graph tab split: the skill map stays as home, and the block view
  replaces the template canvas and drawer. The Rebind panel goes away.
- The layer colors: purple for the org base, cyan for the team, neutral for
  mattstack.
- The small graph's rule: one hop each way plus cycles of three hops or
  fewer.
- The Copy for Claude brief's wording.
- The fills shown on the boards (widgets, acme-base) are invented. The
  blocks with props on the boards are the steps a real domain fill targets
  today.
