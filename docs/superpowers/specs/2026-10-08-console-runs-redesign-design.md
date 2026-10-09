# Console runs redesign

The UI half of the console runs redesign: the live run page with gate
answering, the record view of a finished run, and the runs pages (Lanes and
the Day timeline). It builds on the run data foundations spec
(`2026-10-08-run-data-foundations-design.md`, merged in #770), which added
the gate filters, `meta.stage`, the richer `RunSummary`, the evidence image
route and the pure selectors in `apps/console/src/app/runs/derive/`.

The designs are the pen.dev boards in `console work runs.pen`:

| Board | Page |
|---|---|
| Run · A · Live story | live run page |
| Run · A · Gate open | live run page with a gate waiting |
| Run · B · Stage browser | source of the Plain/Annotated evidence viewer only |
| Run · A · Record (finished run) | record view |
| Runs · A · Lanes | runs page, default view |
| Runs · B · Day timeline | runs page, timeline view |

## Problem

Matt opens the console's runs UI for three reasons: to see the status of a
live run, to answer a gate, and to look back at a finished run and
understand its full history, above all every decision made and the evidence
captured. Today's run page is a summary card over three tabs of raw output
(Pipeline, Run context, Effective inputs), and the runs page is a list. Neither
answers those three questions at a glance, and a finished run hides its
answered gates.

## What a run is (the ground this design stands on)

Observed on the maintainer's Mac (213 runs): most runs are not work runs.

| Kind | `work_type` | Stages | Gates live on | Evidence |
|---|---|---|---|---|
| Work | `feature`, `work` | the eight-stage chain (provision, plan, gates, evidence, implement, self-review, ship, watch-ci); implement..watch-ci re-run in about 1 run in 7 | `run:<id>` | work runs only, legacy shape today |
| Review | `review` | one (`review`) | `mr:<ref>`, linked by `origin.runId` | none |
| Respond | `receive-review` | one (`receive-review`) | `mr:<ref>`, linked by `origin.runId` | none |
| Utility | `watch-ci`, `ship`, `sync-open-mrs`, others | one or two | rarely any | none |

Facts every part below respects:

- Stage status is one of `running`, `done`, `failed`, `redirected`. "Held" is
  not a status: a hold is a `hold:<stage>:<attempt>` decision (`heldSpans`).
  Some finished runs still have a stage marked `running`; such a stage is
  treated as ending at the run's `ended_at`.
- A field is one row per key: `produced_by` and `at` are the last writer's.
- Most run gates are answered by a shepherd, not by Matt; `answer.by` and the
  gate's `owner` (`herd:*`) say which. The console's own answers set
  `overridden`.
- Stage skills put their recommended option first and leave it unmarked, so
  today almost no run-gate question names a recommendation.
- `RunSummary.decision_count` counts decision-table rows, which include
  non-gate rows (`execution-strategy@1`, `hold:`, `redirect:`, `off-script:`).
  The UI never shows it; every decision count in the UI is a count of
  answered gates linked to the run.

## Rules that bind every part

- **Kit first.** `docs/apps/ui-authoring.md`: a Mantine component as it
  ships, then a CSS module through `classNames`, then a kit question. Name the
  Mantine component that owns an interaction before composing one. Pages
  render in `PageShell` inside the kit chrome. Confirmations go through the
  kit's `modals.confirm`.
- **Board parity, checked in Fast Browser.** Every UI task ends with Fast
  Browser screenshots in light and dark, compared against its refined boards;
  any difference is a failure fixed before the task completes. A final pass
  repeats this for every board.
- **Console tokens.** Font weights 400/500/700 only; colors are console role
  tokens, never literals; every surface works in light and dark.
- **Pure selectors.** Derived facts come from `derive/` or new pure,
  unit-tested functions beside it, never computed inside a component.
- **Kind-aware.** Every element that does not apply to a run's kind is
  omitted, not shown empty or as zero.

## Boards first

Before page code, the boards are refined in Pen to the console rules
(weights 400/500/700, console role tokens, a dark variant of every board) and
to what rt can provide. The refinement removes what this spec rules out:

- the Now card's task checklist and the Lanes card's "task 3 of 5 · editing
  X" (replaced by the current stage's latest field);
- "pipeline #8812 · 41 of 56 jobs" (replaced by the CI state);
- "3 throwaway runs hidden · show" and "See all decisions →";
- "4 comments" / "approved" on review rows (replaced by the review outcome,
  section D);
- "Picked at the evidence gate" and the image's "1440 × 900";
- stage-named buckets in "Where today's time went" (replaced by the legend's
  categories).

It adds boards for states the mocks do not draw:

- a review run, live with its post gate waiting (the board hand-off card),
  and finished;
- a live work run whose current stage has written nothing yet;
- two gates open at once, one of them herd-owned;
- a failed stage and a redirected stage in the story;
- legacy evidence (links, no images);
- an abandoned work run's record;
- the runs page with nothing live and nothing waiting.

The refined boards follow the console's existing parity setup
(`docs/apps/design/console/README.md`, `apps/console/scripts/parity/run.md`):
each board is exported in light and dark as `html-css` with layer names to
`docs/apps/design/console/parity/runs-<slug>.<scheme>.html` and as a 1x PNG
to `docs/apps/design/console/renders/runs-<slug>.<scheme>.png`, listed in a
"Runs redesign" section of that README with frame ids, route and fixture
scenario. The app side runs on the design fixture (`CONSOLE_FIXTURE=design`)
extended with runs scenarios whose data matches each board, and components
carry `data-parity` keys named after the board layers. Matt saves the `.pen`
as `docs/apps/design/console/runs.pen`. Boards draw
Inter; the console renders the system sans, so text width differences
against a board are expected and are not parity failures. Kit chrome and kit
controls follow `docs/apps/ui-authoring.md` over the board; each such
difference goes on the board-fix list in that README.

## A. Live run page

Route `/runs/:repo/:runId`, while the run's status is `running`.
`RunDetail` becomes a shell: `PageShell` with the breadcrumb and the
`rt runs show` hint, and a two-column grid. Units live in
`apps/console/src/app/runs/run-page/`, one per board region.

### Header and stage rail

- `RunHeader`: the ticket link with its `t` hotkey, the work type, start time
  and elapsed time over the title. The title is the ticket's title when
  enrichment has one, else the branch, else the reviewed MR's title for a
  review or respond run, else `<work type> · <run id>`. On the right,
  `LivenessChip`, a Focus pane `Button`, and an overflow `Menu` with Resume and
  Abandon (Abandon confirms). Focus pane, Resume and Abandon keep today's
  visibility rules (`RunDetail.tsx` 349-353).
- `StageRail`, work runs only (a one-stage run shows no rail): one column per
  stage. The list is the run's `pipeline-stages` field (section E) merged with
  the executed stages, so stages not yet started render grey; a run without
  that field shows its executed stages only. Each column is a Mantine
  `Progress` bar colored by status token (done, running, failed, redirected,
  held, not started), the name with its status icon, and under it the
  duration and the count of gates placed there by `gateStage`. A stage that ran
  more than once shows `×N`.

### Now card

Shown while the run is live and no gate is answerable.

- Strip: `Now · <current stage>`, `started <ago>`, `last event <ago>`.
- Body: the fields written during the current stage's current attempt (by the
  field-placement rule below), each through `FieldValue`. With none: "Nothing
  recorded yet this stage."

### Gate panel

Takes the Now card's slot while a `run:` gate on this run is `open` or
`parked`. Several answerable gates stack, oldest first.

Review and respond gates (`review-post`, `respond-plan`, `respond-post`, on
`mr:` subjects) are answered in the board, which owns their structured
contexts (findings@1, carryover@1, skipped@1) and the edited-reply `text`
answer. On a review or respond run the slot shows a read-only `HandoffCard`
instead: the gate's kind, its questions with their options, a one-line
summary of each structured context (`structuredContextSummary`, section E),
and "Answer in the board" linking to the board app's page for that MR when the
board exposes one, else plain text.

- Header: "The <stage> stage needs <N> answer(s)", "Opened <ago>". When the gate is mine
  (`isMine`), the needs-you tone and "The agent is paused until you submit."
  When it is herd-owned, a neutral tone and "A shepherd owns this gate";
  submitting it first confirms through `modals.confirm` that it overrides the
  shepherd.
- Step chips: a Mantine `Stepper` with `allowStepSelect`, one step per
  question; hidden for a one-question gate.
- Left, "What the agent found": the active question's own `context` when it
  has one, else the gate's `context`, as markdown. "expand" opens it full
  width in a kit modal. Always open; no toggle. Hidden when there is no
  context.
- Right: "<n> of <N>", the question, options as `Radio.Card` (or
  `Checkbox.Card` for multi-select), the recommended badge when an option is
  recommended, a number `Kbd` on the first nine options, a note `Textarea`,
  "Open the pane", "draft saved", and Next (Submit on the last step) with a
  `⌘↵` `Kbd`. Option parsing, recommendation stripping and the answer payload
  come from `@mattstack/gate-kit`, as today's questionnaire uses them
  (skippable multi-select included).
- Keys: 1-9 pick an option on the active question and `⌘↵` advances, while
  the panel holds focus.
- Draft: picks and notes persist per gate id in `localStorage`, every access
  in try/catch, cleared on a successful submit or once the gate is no longer
  answerable.
- Submit reuses today's answer mutation. A parked gate keeps its `parked`
  badge and today's resume note. The `#gate-<id>` deep link keeps working.

### Story so far

Every executed stage attempt except the current one, in run order. Each
`StorySection`:

- status icon, name, attempt (`attempt 2` when re-run), duration, and a "stage
  doc" link to the compiled doc (today's stage-doc route) in a kit modal;
- its fields by the field-placement rule, through `FieldValue`;
- its answered gates as `DecisionRow`s: question, the pick, who answered and
  when (`answeredBy`, section E): "you · 1:41 PM" or "shepherd · 1:41 PM",
  the time alone when `by` is missing, and the surface (console, pane, board)
  in the row's tooltip; expanded, the note, the other
  options, and a "went against the recommendation" mark when
  `tookRecommendation` is false;
- closed and superseded gates as muted rows ("closed: <reason>",
  "superseded");
- holds from `heldSpans`: "held <duration> · <reason>";
- a failed stage shows its reason and today's `FailureExcerpt`; a redirected
  stage shows the redirect decision;
- `EvidenceCard` in the evidence section, with the AFTER shown in the ship
  section.

A one-stage run (review, respond, utility) has no story sections: the page
shows its fields and decisions in one block under the header.

**Field-placement rule.** A field belongs to the stage attempt whose window
holds its `at` (window: the attempt's `started_at` to the next attempt's or
stage's `started_at`, else the run's `ended_at`, else now). `evidence` is never
shown as a field; it renders only through `EvidenceCard`. Plumbing keys are
never shown: `hold`, `gate`, `waiting-gate`, `claude-session`, `herdr-pane`,
`agent`, `pipeline-stages`, and every `extra.*` key. `ticket`, `branch`,
`worktree`, `mr` and `commits` render in the side card, not in the story.

### Evidence card

- A `SegmentedControl` for Plain/Annotated showing only the variants present,
  and a second one for Before/After when both exist.
- A Mantine `Image` from `GET /api/runs/:repo/:runId/evidence/:key`, the file
  name as caption; click opens it full size in a modal.
- An image that fails to load shows an "image unavailable" placeholder.
- Legacy evidence (`parseEvidence` version 0, every run recorded so far) shows
  its links as a list.

### Side cards

- Links: MR · CI, branch (its sub-line is "<n> commits @ <head sha>", the
  count from `countCommits`, section E), worktree, each with its hotkey `Kbd`
  and a `CopyButton` (today's hotkeys). On a review or respond run the MR row
  is "REVIEWED MR".
- Decisions: the count of answered gates linked to the run and one row per
  answer (stage badge, pick); each row scrolls to its `DecisionRow`. "Open log
  →" scrolls to the first decision while the run is live.
- Effective inputs: pack version and sync state, setting and stage-doc
  counts, "View inputs →" opening a Mantine `Drawer` with `EffectiveInputs`;
  the drawer state is in the URL as `?inputs`.

### Data

- The run detail query as today.
- `useRunGates(runId)`: `GET /api/gates?run=<id>`, every gate linked to the
  run in every status (section E).
- Live updates through today's websocket invalidation (`run-updated`,
  `gate/*`).

### Removed

The Pipeline and Run context tabs, `Timeline`'s rendering, `SummaryCard`,
`StageProgress`, and `activeGatesForRun`'s hiding of answered gates. Logic
they hold that is still needed moves into `derive/`.

## B. Record view

Same route, when the run's status is anything but `running`. The page swaps
the Now/gate slot and the live story for the record layout.

- Header: ticket link, work type, `<start> → <end>` span, title (same fallback
  as the live header); outcome badges from `RunSummary.outcome` on the right.
- Stats row, each stat shown only when it applies:
  - duration: start to end, or start to merge when the run's own MR merged;
  - decisions: answered gates linked to the run;
  - "<k> of <n> took the recommendation", only when at least one answered
    question had a recommendation;
  - evidence: image count, or "<n> links" for legacy evidence; work runs only;
  - commits (`countCommits`), work runs only;
  - waiting on you: `waitingOnYou` over the gates that are mine.
- Mantine `Tabs`. Decisions is the default tab when the run has any answered
  gate, else Story.
  - **Story**: the live page's `Story` units.
  - **Decisions**: a "By stage" nav (work runs) with counts and a mark where
    the answer went against the recommendation. One `DecisionCard` per gate:
    one block per question, then the gate-level context once at the bottom
    as "What the agent found · <n> lines" (collapsed, as run-record draws
    it). Each question block lists every option, the
    pick highlighted, the recommended badge, "overrode recommendation", the
    note (or the edited reply `text` on a review or respond answer), who
    answered and when (`answeredBy`), and the question's own context when it
    has one. A structured JSON context shows its `structuredContextSummary`
    line with the raw JSON in a collapsed monospace block, never rendered as
    markdown. Closed and superseded gates appear muted with their reason. The
    evidence column on the right (work runs): Before/After cards, "Compare
    full size" (a modal with a Before/After toggle and arrows), the
    transcript, and "Case used" (`evidence.case`). "attached to !iid" shows
    when `evidence.attach` is `ship` and the run's own MR exists.
  - **Evidence** (work runs): the evidence column at full width.
  - **Inputs**: `EffectiveInputs`.
- Transcript: fetched as text; a `.md` file renders as markdown, anything
  else as a monospace code block, first 40 lines with "show all".
- On a finished run, the Decisions side card's "Open log →" selects the
  Decisions tab.

## C. Runs pages

Route `/runs`, with `?view=timeline` for the timeline.

### Lanes (default)

- Controls: an All/Live/Waiting/Done `SegmentedControl` and today's repo
  picker.
- Stat cards: waiting on you (gates that `countsForConsoleBadge`, and the
  oldest's age), live (count and current stages), finished today (work runs
  merged and abandoned, from `outcome`; reviews posted), median work run over
  the last 30 finished work runs.
- Waiting banner for my oldest answerable `run:` gate: run, question, options
  shown read-only with their numbers. "Answer gate" and the `g` key open that
  run's page at its gate panel. Nothing is answered from this page. Herd-owned
  gates never appear here. Review and respond gates waiting on Matt are the
  board's to badge and answer; on this page they show only as a "waiting in
  the board" marker on their run's row, and they do not count in the waiting
  stat.
- Live lanes: a card per running run that today's aging rules
  (`bands.ts`/`aging.ts`) do not call stale, with the compact `StageRail` (work
  runs), the current stage's latest field, the MR line and the decision count.
- Earlier: every other run grouped by day (stale running runs included, marked
  stale), each row with an outcome icon, the decision count, evidence (work
  runs; "—" in that column for other kinds, so the columns stay aligned),
  duration and end time. A review row's sub-line is "reviewed !<iid> ·
  <posted>". No runs are hidden.

Decision counts on this page come from one fetch of every gate linked to a
run, `GET /api/gates?linked=1` (section E), grouped by run id (the `run:`
subject's id, else `origin.runId`), never from `decision_count`.

### Day timeline

- Day navigation (previous, Today, next) and the Timeline/List toggle (List is
  Lanes).
- Legend: stage done, running now, waiting on you, waiting on CI, idle or
  held.
- One row per run active that day. Segments come from a pure selector
  `timelineSegments(run, gates, decisions, now)`: stage windows (a `running`
  stage on a finished run ends at `ended_at`); waiting on you from my gate
  spans (open to answered or closed); waiting on CI is the `watch-ci` stage;
  held from `heldSpans`; idle is any gap. Where spans overlap, precedence is
  waiting on you, then waiting on CI, then held, then the stage's own status.
  Hovering a segment shows its stage and gate.
- "Where today's time went": totals per legend category.
- "Decisions you made today": the day's answers across runs whose
  `answeredBy` is you (console, pane or board), never a shepherd's.

## D. Outcome

`RunSummary.outcome`, optional on the type like spec 0's additions:

```ts
outcome?: {
  status: "running" | "done" | "abandoned" | "failed";
  /** The run's own MR: set only when the `mr` field was written by ship or watch-ci on a work or ship run. */
  mr?: { iid: number; state: "opened" | "merged" | "closed" | "unknown"; url: string | null; mergedAt?: number };
  /** The MR a review or respond run reviewed: never counts as merged. */
  reviewed?: { iid: number; url: string | null; posted: string | null };
  ci?: string | null;
}
```

- `status` is the run's own status.
- `mr` vs `reviewed`: the `mr` field's `produced_by` decides. Written by
  `ship` or `watch-ci` on a work or ship run, it is the run's own MR; written
  by `review` or `receive-review`, it is the reviewed MR. `posted` is the
  `disposition` from the run's `post` decision row (`selection: { findings,
  disposition }`, written by the review skill), which the daemon reads when it
  builds the summary; failing that, the pick label of the post gate's
  `outcome` question (`review-post`) or `disposition` question
  (`respond-post`); else null.
- The `mr` field may be a URL, `!<iid>` or a bare iid; all three resolve to an
  iid against the run's repo.
- **Filling.** `listRuns` stays synchronous and never waits on the forge. A
  daemon outcome cache, keyed by run id, holds MR state and CI. It persists as
  one entry in the daemon's existing kv store (`lib/state/kv-blob.ts`), so no
  new table and no `SCHEMA_VERSION` bump. `listRuns` merges the cached value (or `state:
  "unknown"` before the first fill) into each summary. A background refresher
  resolves uncached and stale entries through the daemon's existing MR read
  (`mr:get`, GitLab), a few at a time: `opened` entries refresh every 10
  minutes while the run is under 7 days old, `merged` and `closed` entries are
  final. A run whose repo key has no repo identity or whose forge is not
  GitLab keeps `unknown`. A refresh that changes an entry emits `run-updated`.
- The UI shows `unknown` as no MR badge, never as an error.

## E. Other data additions

- **Gates by run.** `gate:list` gains `run: <id>`, matching `subject = 'run:<id>'`
  or `origin.runId = <id>`, and `linked: true`, matching every `run:` subject
  and every gate with an `origin.runId`. The console's `GET /api/gates`
  accepts `?run=<id>` and `?linked=1`, each returning every status, all pages.
  `useRunGates` uses `run`; the runs pages use `linked`.
- **`answeredBy(gate)`** in `derive/`: `{ you: true, via: "console" | "pane" |
  "board" }` for those `answer.by` values, `{ you: false, via: "shepherd" }`
  for a shepherd, `null` when `by` is missing.
- **`structuredContextSummary(context)`** in `derive/`: for a context that
  parses as JSON with a known schema (`findings@1`: "<n> findings";
  `carryover@1`: "<n> carried over"; `skipped@1`: "<n> skipped"), one line;
  for other JSON, "structured context"; for prose, null (render as
  markdown).
- **Pipeline stages.** The work orchestrator writes a `pipeline-stages` field
  (the compiled `{{pipeline.stages}}` list, space-separated) with
  `run_field_set` right after `run_start`. The edit goes through
  `superpowers:writing-skills` and `mattstack:editing-skills` and bumps the
  plugin version.
- **Recommended options labelled.** The stage skills that ask run gates
  (stage-plan, stage-evidence, stage-ship, and any other stage that asks with a
  recommended pick) mark that option with the ` (Recommended)` label suffix,
  which `tookRecommendation` and the gate form already read. The stage-end
  `next` question carries no recommendation: Proceed (and Done at close) is
  the default edge, not advice, so answering Hold, Iterate or Go back never
  reads as an override. Same skill process and version bump.
- **Transcript.** `runs:evidence` gains the `transcript` key: the path comes
  only from the run's own `evidence` field and is admitted by the same roots
  as the image keys (the worktree rt registered to the run's repo, rt's
  evidence folder, the run's evidence folder), through a text variant of the
  upload guard: realpath, regular single-link file, no symlinks, at most 256
  KB, valid UTF-8, and a `.md`, `.txt` or `.log` extension. The console relays
  it as `text/markdown; charset=utf-8` for `.md` and `text/plain;
  charset=utf-8` otherwise, so the client knows which to render as markdown.
- **`countCommits(value)`** in `derive/`: counts the shas in the `commits`
  field across its real formats (space-separated, comma-separated, `a..b (n):
  ...` using `n`, a single sha).

## Plan shape

1. **Base, in sequence:** refined boards and their PNG exports; the data
   additions (D, E) with their skill edits; shared units (`StageRail`,
   `FieldValue`, `DecisionRow`/`DecisionCard`, `EvidenceCard`, outcome badge,
   `useRunGates`); the new selectors (field placement, `timelineSegments`,
   `countCommits`).
2. **Pages:** the live run page (A), the record view (B), the runs pages (C).
   They may fan out through shepherdr once the base's interfaces are fixed;
   otherwise they run in sequence.
3. **Final pass:** every board in Fast Browser, light and dark.

## Testing

- Vitest and Testing Library for every unit against fixtures of each run kind
  (work, review, respond, utility); stories for every state the boards draw.
- Selector unit tests for every derived fact, including field placement across
  re-runs, timeline precedence, the finished-run clamp and the commit formats.
- Daemon tests for `outcome` (each status, own MR vs reviewed MR, the three
  `mr` formats, cache refresh and finality, unknown repo) and for the
  transcript key (served, too large, not UTF-8, wrong extension, symlink,
  unregistered root), and for `gate:list` with `run` and with `linked`.
- Fixtures for `answeredBy` (each `by`, missing) and
  `structuredContextSummary` (each named schema, a `gate-ctx` context of
  another schema, prose).
- Fast Browser screenshots in light and dark for every UI task, compared
  against the boards.

## Out of scope

- A recorded "doing now" activity line or plan-task progress.
- Answering a gate from the runs page.
- A cross-run decisions page.
- Hiding "throwaway" runs.
- Light/dark evidence variants (`after_light`/`after_dark`); `evidence@1` has
  one image per key.
- Review comment counts.
- Answering review and respond gates in the console (the board owns them).
