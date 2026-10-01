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
| An input card | Drawer, that file's own text |
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

`/wiring?focus=<ref>&range=<L>&tab=<text|used-by|history>`; every view is a
link. `?attention=1` (the rail badge's link) turns on the Needs attention
toggle. Pack and pipeline selection join the URL too.

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
| Loading, composition failed, check failed, no pipeline, no packs | Same messages in the focus list and canvas |

## Testing

- Unit: `templateModel` and `templateLayout` from fixture compositions (a
  pipeline, a verb with ten includes, a referenced slot, an unbound required
  slot, a resolve error, a stale step with an unchanged stamp).
- Component: click rules open the right drawer state; URL round-trips.
- Server: the source route refuses a path the composition does not name.
- UI: rendered in Fast Browser and screenshotted in both schemes against the
  boards before any milestone is called done.
