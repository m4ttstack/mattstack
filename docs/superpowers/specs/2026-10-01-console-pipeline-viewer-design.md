# Console pipeline viewer: skills as templates

Status: draft for review, 2026-10-01.

Design boards: `docs/apps/design/console/console.pen` (boards named
`Template · *` and `Drawer · *`; everything else in the file is exploration).

## Problem

The Wiring page's Pipeline tab is a list of stage names beside a detail card.
Clicking a stage shows little, and one tab is wrong: it says a stage "compiles
into the orchestrator, so it has no compiled artifact of its own", but every
stage compiles to `<pack>/attachments/stage-<name>/SKILL.md`. Console misses it
because `rt skills composition --json` lists stages only as binders, with no
artifact path.

The deeper problem is that the page never shows what a skill is made of. A
compiled skill is a template rendered with values: the engine's own text,
partials pasted in by `{{include:...}}`, pack text dropped into
`{{slot:...}}`, paths filled by `{{verb.path:...}}`, and variables rt fills
per run. A person looking at a step cannot see which text came from where, how
much of it each piece is, or what it links to.

## Goals

- Look at one step or compiled skill and see what it is made of and what it
  references, in the templating engine's own terms.
- One focus at a time: a pipeline, a single step, an on-demand verb, a board
  skill.
- A reusable drawer that shows any file's text with the clicked part
  highlighted.
- Keep every capability today's Pipeline and On-demand tabs and detail panel
  have (see "Coverage").

## Non-goals

- The Surface and Health tabs do not change, beyond Health's "open skill"
  links opening the new view.
- No editing of skill text in the browser.

## The model: a template view

Every skill on the canvas is drawn as a template being rendered, left to
right:

| Column | Holds |
|---|---|
| Substituted in | One card per placeholder value: a partial (`gate-protocol/SKILL.md`), a pack's slot value (`plan-policy/SKILL.md`, "written by acme"), or a variable rt fills (`run fields`) |
| Template | The engine file as written (`stage-plan/SKILL.md`): its placeholders shown literally with their line numbers, and the text between them as clickable line ranges ("L17-75, 59 lines of step text") |
| Rendered / Links to | For a step: the rendered output card (line count, what fills it, the files its text links to). For `work`: one card per `{{verb.path:stage-*}}` line, each a rendered step |

Edges run from each input card to its exact placeholder row, and from each
`verb.path` row to the step it names. Every input and link card reads as a
skill file: file icon, path, and a one-line subtitle (kind, owner, size).

The pipeline is not a separate concept: it is the `work` template, whose
`verb.path` lines link to the 8 rendered steps.

Boards: `Template · work · light/dark`, `Template · plan · light/dark`.

## Navigation

A focus list on the left of the canvas replaces the Pipeline and On-demand
tabs (one `Graph` tab; Surface and Health stay):

- **Pipeline**: one entry per pipeline the pack declares (`work · feature`,
  `work · bugfix`), each expanding to its numbered steps. This replaces
  today's work-type picker.
- **On-demand**: each verb invoked by name.
- **Board**: each board skill this pack binds (`board:review` and others).
- **Unwired**: verbs that bind nothing and fills nothing binds.
- A **Needs attention** toggle filters the list to items with a status dot.

Selecting an entry swaps the canvas to that skill's template view. Back
returns to the previous focus.

## Click rules

Cards navigate; rows and parts open the drawer.

| Click | Result |
|---|---|
| A focus entry, or a step card (`stage-plan/SKILL.md`) | Canvas switches to that skill's template view |
| A text-range row (`L1-28`) | Drawer, Template view, that range highlighted |
| An include row (`{{include:gate-protocol}}`) | Drawer, Rendered view, scrolled to where the partial landed (`L140 -> L303-752`) |
| A slot row (`{{slot:domain}}`) | As an include row, plus Rebind |
| A link row (`{{verb.path:stage-plan}}`) | Drawer shows the template line and what it rendered to |
| A variable row (`{{stage.fields}}`, `{{run-start.flags:work}}`) | Drawer shows what rt rendered in its place |
| An input card | Drawer, that file's own text (Text tab; Used by and History one click away) |
| The rendered output card, or one of its parts | Drawer, Rendered view, scrolled to that part |
| A "links to" chip (`gates.md`) | Drawer, that file; offers its own view when it is a skill |
| A status chip or dot | Drawer, History tab |

Keyboard: Esc closes the drawer; up and down step through template rows with
the drawer following.

## The drawer

One component, opened from every click above. Boards: `Template · work ·
drawer`, `Drawer · include row`, `Drawer · input card`, `Drawer · output ·
history`.

- **Header**: file path; kind badge (template, partial, pack text, rendered);
  owner and version; a Template | Rendered toggle for steps only; close.
- **Context line**: the range chip and one plain sentence ("gate-protocol is
  pasted here: 450 lines, 58% of what the agent reads in this step").
- **Text tab**: line numbers, the selected range highlighted, placeholders
  tinted. In Rendered view each pasted part gets a band with its source name
  in a gutter column.
- **Used by tab** (partials and pack text): every skill in the pack that
  pastes it in, grouped (pipeline steps, on-demand, not wired), each with the
  template line, each navigating. Replaces today's Used by tab and "Show in
  map".
- **History tab**: a "Built from" table (each source file, the version built
  with, the version installed, and whether its content changed), then today's
  commit timeline, working-tree state and Compare 2 commits diff
  (`VersionTimeline`, `SeamCompare`), reused.
- **Actions**, shown only where they apply:
  - Open in editor: files in a pack checkout only, never the installed
    mattstack copy, which the header labels "installed copy, read only".
  - Rebind: slot values; today's `Rebind` flow (same-contract picker, confirm
    listing other sites, staged `rt skills bind` command, Apply).
  - Public/internal switch: verbs; disabled for stages; applies through
    `surface/apply` as today.
  - Copy rendered text: the compiled body, today's "Copy agent context".
  - Copy path.

## Unsynced changes

Rebind and the public/internal switch write into the pack's checkout and
recompile there; Claude sessions keep loading the installed copy until a sync.
Today `rt skills sync` refuses a dirty pack checkout, so Rebind followed by
Sync fails unless the change is committed by hand.

- **Banner**: whenever the pack checkout has changes not yet synced, a banner
  sits at the top of the Wiring page on every focus: "2 unsynced changes in
  acme. Your Claude sessions still use the old version." It stays until a
  sync or a discard.
- **Change list**: read from the pack checkout's git status, so it includes
  edits made in an editor, not only console's own actions. Each entry names
  the skill and the change ("plan: domain slot -> new-policy", "review: made
  internal") where console can say it, else the file path.
- **Sync changes**: commits the pending changes, then runs today's sync
  (rebuild, push, installed cache update). It confirms first, because the
  push shares the change with the team. Afterwards the "/reload-plugins" hint
  shows, as on the Health tab.
- **Discard**: reverts the pending changes after a confirm.
- **Canvas**: an edited slot row and its input card carry an "unsynced" tag.

Needs from rt: a way to list a pack's pending changes (`--json`), a sync that
commits pending pack changes instead of refusing, and a discard. Verb names
are settled in the plan.

## Slot and placeholder states

| State | Input card | Template row |
|---|---|---|
| Bound | File path, owner ("written by acme", "mattstack default"), contract, layer (`this pack`, `base: <name>`, `your override`, default) | Normal |
| Optional, unbound | No card | Row says "optional, nothing bound" |
| Required, unbound | Warn card "required, nothing bound" with Rebind | Warn row |
| No matching fill | Warn card naming the missing fill | Warn row |
| Resolve error | Error card with rt's message | Error row |
| Referenced, not inlined | Card marked "referenced": the rendered text holds a path, not the body | Row says "links to" instead of "pasted"; the drawer shows the rendered path line |

## Status

A skill's status comes from `rt skills check` (`status`, `staleBecause`),
never from comparing version stamps. A step built with mattstack 0.28.10 whose
sources are unchanged in 0.30.4 is in sync; the History tab says so in plain
words ("a rebuild would only update the stamp"). Stale skills show an amber
dot in the focus list and on their cards; History lists why
(`source`, `include`, `fill`, `frontmatter`, `structure`) and the
`rt skills sync --pack <pack>` command with a copy button.

## URL state

Every Graph view is a link: `/wiring?tab=graph&focus=<ref>&select=<ref>`.
Keys, in the order the formatter writes them, with defaults left out:

| Key | Values | Meaning |
|---|---|---|
| `tab` | `graph` (default), `surface`, `health` | The Wiring page tab |
| `pack` | pack name | The pack on screen; absent means the first pack |
| `focus` | `pipeline:<work type>` or a skill ref such as `stage-plan` | What the canvas shows: a whole pipeline, or one skill's template |
| `select` | `row:<line>`, `input:<kind>:<name>`, `output` | The drawer's subject: the template row starting at that line, an input card, or the output |
| `drawerTab` | `text` (default), `used-by`, `history` | The drawer's tab |
| `view` | `template`, `rendered` | Which body the drawer's text tab reads |
| `rebind` | `1` | The drawer's slot row is in rebind mode |
| `attention` | `1` | The Needs attention toggle (the rail badge's link) |

Changing `focus` clears `select`, `rebind` and `view`. A change to `tab`,
`pack` or `focus` pushes a history entry; `select`, `drawerTab`, `view` and
`rebind` replace the current one. An unknown value reads as the default.

## Data

New from rt (`rt skills composition --json` and `check`):

- each stage's rendered path and `compiled:` stamp (fixes the bug above)
- per skill, its placeholders in template order: kind (`include`, `slot`,
  `verb.path`, variable), template line, rendered line range, and the source
  file it resolved to (most of this is already in the compiled files' `part:`
  markers; variables and `verb.path` lines are not marked today)
- the links found in each rendered body (`../../attachments/*/SKILL.md`,
  vendored `parts/` files)
- per source file, whether its content changed since the build

New in console's server:

- `GET /api/skills/source?pack=&path=` returns one file's text, accepting only
  paths the composition names (templates, inputs, rendered files); anything
  else is a 404.

## Architecture

- `templateModel.ts` (pure): composition plus check to a focus's template
  view model (inputs, rows, links, statuses). Unit-tested against fixtures
  with invented names.
- `templateLayout.ts` (pure): three columns aligned to row centres; inputs
  and link cards placed at their row's centre.
- `TemplateCanvas.tsx`: React Flow (`@xyflow/react`), lazy-loaded, dotted
  `Background`, custom nodes `TemplateNode` (header plus rows, one handle per
  placeholder row), `InputCard`, `LinkCard`, `OutputCard`.
- `FocusList.tsx`: the left list and the attention toggle.
- `SkillDrawer.tsx`: Mantine `Drawer` on `useDrawerSurface()`; `CodeView` with
  part bands; tabs reuse `InverseIndex` data, `VersionTimeline`, `SeamCompare`
  and `Rebind`.
- Removed: `SkillSplitLayout`, `SkillRow`, `OnDemandView`, `SummaryStrip`,
  `SkillDetailPanel` and its tab shell. Dropped: the "same wiring as stage N"
  badge, which the template view makes redundant.

## Build rules

- **Kit first** (`docs/apps/ui-authoring.md`): every control is the Mantine
  component as it ships (rung 1), then a CSS module through `classNames` for
  layout only (rung 2), else a kit question to Matt (rung 3). Colour only
  through `color`/`variant` and role tokens. Nothing is hand-drawn that a kit
  or Mantine component already does: the drawer is `Drawer`, the toggle is
  `SegmentedControl`, the tabs are `Tabs`, the picker is `Select`, the
  banner is `Alert`, buttons are `Button`, chips are `Badge`, the code view
  is the kit's lazy code highlighter where it fits.
- **Page frame**: the Graph tab renders in `PageShell`; the focus list is
  `PageShell.Sidebar` (its `NavLink` rows); the canvas is
  `PageShell.Content`, which takes its own surface (`bg`, so
  `data-own-surface` opts it out of the theme's line grid) and paints the
  dotted paper with React Flow's `<Background variant="dots" />` in role
  tokens. The line grid stays everywhere else.
- **Dialogs**: every write confirms through the kit: `modals.confirm` for
  Apply rebind, the public/internal switch, Sync changes and Discard
  (`destructive: true` for Discard); results report through the kit's
  `notifications` shorthands. No bespoke dialogs.
- **Visual parity gate**: every milestone that changes UI ends with the page
  rendered in Fast Browser and screenshotted in both schemes beside its
  board. Any difference from the board (spacing, type, colour role, layout,
  copy) is a failure fixed in that milestone. Where a kit piece and the board
  disagree on kit chrome, the kit wins and the difference goes on the board
  fix list for Matt, per `ui-authoring.md`.

## Coverage of today's view

| Today | New home |
|---|---|
| Pack picker, Open pack, composition timestamp | Header, unchanged |
| Work-type picker | One focus entry per pipeline |
| Summary strip, attention filter, `?attention=1` | Focus list statuses and Needs attention toggle |
| Pipeline spine, health rings | `work` template view, step cards, status dots |
| On-demand list, external binders | Focus list groups |
| Unwired verbs, orphan fills | Focus list "Unwired" |
| Slots & bindings, includes, layer, sites, resolve errors | Template rows and input cards, slot states table |
| Compiled tab | Drawer Rendered view (stages included) |
| History, compare | Drawer History tab |
| Used by, Show in map | Drawer Used by tab |
| Rebind, public/internal switch, Open source, Copy agent context | Drawer actions |
| Sync (Health tab) | Unchanged on Health; also "Sync changes" in the unsynced banner |
| Loading, composition failed, check failed, no pipeline, no packs | Same messages in the focus list and canvas |

## Testing

- Unit: `templateModel` and `templateLayout` from fixture compositions (a
  pipeline, a verb with ten includes, a referenced slot, an unbound required
  slot, a resolve error, a stale step with an unchanged stamp).
- Component: click rules open the right drawer state; URL round-trips.
- Server: the source route refuses a path the composition does not name.
- UI: rendered in Fast Browser and screenshotted in both schemes against the
  boards before any milestone is called done.
