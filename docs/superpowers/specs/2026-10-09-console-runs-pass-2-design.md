# Console runs, pass 2: polish and the bugs live use found

The second pass on the console runs UI that shipped in #777
(`2026-10-08-console-runs-redesign-design.md`). Matt used it on live runs
and found it "a good start, but pretty raw" and "extremely busy: a lot of
text, a lot of small text, a lot of things competing for your attention".
He also hit several surfaces no board drew, and several bugs.

This pass did three things:
- It captured every reachable surface: 44 live screenshots (local only),
  76 on the design fixture and 80 Storybook stories.
- It wrote an audit of 71 findings.
- It drew before/after boards that Matt approved on 2026-10-09.

Everything in the first spec still binds unless this one changes it,
including kit first, board parity in Fast Browser, console tokens, pure
selectors and kind-aware omission.

## The boards

The approved boards are the "Pass 2" section of `console work runs.pen`.
They sit below the first pass's boards: a header frame, then a "Before"
frame of screenshots and an "After" frame for each pair. The "After" frames
are the design. The "Before" frames are reference only.

| Pair | After frame | Replaces |
|---|---|---|
| Live run page | After · Live run page (quiet story) | Run · A · Live story |
| Answering a gate | After · Gate open | Run · A · Gate open |
| Finished run record | After · Record (finished run), stage timeline option C | Run · A · Record (finished run) |
| Effective inputs | After · Effective inputs drawer | (no board before) |
| Failure, loading and toasts | After · states | (no board before) |
| Runs page | After · Runs page | Runs · A · Lanes |
| Review run record | After · Review run record | the review header on Run · State · Record headers |
| Story details | After · Story details | (no board before) |
| Overlays | After · overlays | (no board before) |
| Search, ⌘K, 404, timeline hover | After · search etc | (no board before) |

The first pass's boards that this pass does not replace stay as they are:
- the Day timeline
- two gates
- story edges
- record headers, abandoned
- nothing live
- the dark variants

Each replaced board's dark variant is redrawn from its new light board.
Light is the base, and dark is derived from it.

## The rule this pass adds

**One thing leads; metadata recedes.**
- A screen shows the thing Matt came for at full weight. Everything else is
  one line of muted text, or folded behind a click.
- The same fact never appears twice on one screen.
- Copy-shortcut key chips on page metadata are removed (`t` on the ticket,
  `m`, `b` and `w` on the side links).
- Keyboard shortcuts on the gate form stay: `1`-`9` pick an option and ⌘↵
  submits. They render as small, neat key caps.

## A. Live run page

- **Header.**
  - Drop the `t` key chip.
  - The stage rail keeps each stage's duration and drops its decision count.
- **Story.**
  - A finished stage is one row: check bullet, name, duration, and a
    one-line summary ("3 decisions · Backend gap-fill + component work").
    Expanding the row shows the stage's fields, its decisions and its
    evidence.
  - The most recent finished stage starts expanded; the rest start folded.
  - The story is one bordered surface with hairline row dividers, not a
    card per item.
- **Decisions in the story** are plain rows: the question as a muted label,
  the answer, and "who · time".
- **An opened decision** shows, below the answer:
  - your pick
  - the options you passed on, as "Passed on" with a dash per option (not
    radio buttons)
  - your note
  - "What the agent found · N lines"
- **The "Stage doc" link** sits in the stage row's header. It opens the one
  stage doc drawer (section F).
- **The side column** keeps the MR · CI, Branch and Worktree facts (each with
  a copy button) and the Effective inputs card. The Decisions side card is
  removed, because the story is the decision log.
- **"Open log →" and decision-row clicks** are removed together with that
  card. The parts that remain (the stage row and the opened decision) need
  no scroll target.

## B. Gate panel

- **Placement.** The gate panel sits at the top of the main column. The side
  column keeps its place to the right, so it never drops below the gate.
- **Header.**
  - The header reads "The <stage> stage needs <n> answers", with "Opened 4m
    ago · the agent waits until you submit" underneath.
  - A compact step strip at the right of the header replaces the numbered
    circles. Each step shows its number and name, and the current step is
    raised.
- **Context column.** It keeps "What the agent found". When the context has
  "Label: text" points, they render as a label column. The "expand" modal is
  removed.
- **Option cards.**
  - Each card shows the title and a "Recommended" tag.
  - The description is muted text.
  - A command in the description renders on its own line as a mono chip,
    split from the prose.
  - A key cap with the option's number sits at the right. The selected
    option's cap takes the accent colour.
- **Footer.**
  - "Open the pane" is a quiet text button.
  - "Draft saved" is dim text.
  - The primary **Next** / **Submit** button carries a small ⌘↵ cap inside it.
- **Submit failure.**
  - The panel stays open with your picks and note intact.
  - An inline error strip above the footer says why, with **Try again**.
  - A lost race (409 from a real answer elsewhere) still shows "Answered
    elsewhere".
- **The design fixture refuses writes with 403, not 409.** Today the fixture
  answers 409, which the client reads as a lost race, so the read-only
  refusal looked like "Answered elsewhere".
- **No context.** A gate whose question has no agent context drops the
  context column and gives the question the full width (the eleven-options
  story renders an empty column today).
- **Ten or more options.** Options 1-9 get key caps; option 10 and above
  get none.

## C. Finished run record

- **Hero stats.** Four stats: duration, decisions, took the recommendation,
  and waiting on you. The evidence and commits stats are removed.
- **Counts agree.** Every decision count on the page counts the same thing
  (answered questions). "1 decisions" becomes "1 decision".
- **Decisions tab.**
  - The "By stage" sidebar and its "you overrode the pick" legend are
    removed.
  - The log carries the stage timeline itself: a 2px rule down the left and
    a check bullet per stage header.
  - Each stage header reads "plan · 3 decisions · 12m · 1 override" (option
    C, picked 2026-10-09).
- **A decision card** shows:
  - the question and "who · time"
  - an "overrode recommendation" tag when that applies
  - your pick, highlighted, with a small "recommended" when the pick was
    the recommendation
  - a "N other options" line, which names the recommendation when you
    overrode it
  - your note
  - the "What the agent found" disclosure

  The options you passed on are not listed as radio rows.
- **Evidence column, Story tab and Inputs tab** follow sections A, E and F.
- **Field labels.** Raw field keys used as labels (`ShipTarget`, `Ci`) get
  sentence-case labels from a label map. A key without an entry falls back
  to a de-camelcased form ("Ship target").
- **Abandoned record.** It shows who abandoned the run, when, and the reason
  under the hero, when the run recorded them.

### Review run record

- **The body leads with "Posted to !<iid>".** The verdict and finding count
  sit in its header, with an "Open the MR" link at the right.
- **Each finding is a row.** It has a severity badge (Important in the warn
  tone, Minor neutral), the finding text, and its file and line in mono
  when the finding names one. The literal "[Important]" and "[Minor]"
  prefixes become badges.
- **Decisions follow,** folded the same way as work runs.
- **A review run has no Evidence tab.** The outcome pill reads "Requested
  changes on !412", "Approved !406" or "Commented on !N".

## D. Runs page

- **Stat line.** The four stat cards become one line under the title:
  "1 waiting on you · 2 live · 3 finished today · 2h 10m median work run",
  each with its coloured dot.
- **Waiting banner.**
  - It keeps its option chips with their number caps.
  - "press g to jump" moves under the Answer gate button as "1 of 3
    questions · or press [g]".
- **Earlier list.**
  - Rows drop the decisions and evidence columns.
  - Each row keeps its outcome tile, title, sub line, duration and time.
  - The list shows the last 7 days of runs, then a "Show earlier days" row
    that loads 7 more each time.
- **Titles.** A review row's title is the MR title when the run has one,
  else the ticket title. It is never the branch slug or the run id.

## E. Evidence

- **Legacy parser.** The legacy (v0) evidence parser
  (`packages/rt-client/src/evidence.ts`) changes what it accepts as a path:
  - It must start a token: at the start, or after whitespace, a quote or a
    bracket.
  - It must end in a file extension.

  Route patterns (`/c/:id`), fractions (`52/52`) and bare words stop parsing
  as paths. URLs still parse.
- **Images.** Legacy paths that name an image (`.png`, `.jpg`, `.jpeg`,
  `.gif`, `.webp`) render as thumbnails with the file name under them.
  Other paths stay editor links, and URLs stay links with an
  external-link icon.
- **Image route.** The console serves a legacy image through a new route
  that answers only when both of these hold:
  - the path appears in that run's own evidence field
  - its resolved real path is inside the evidence root
    (`~/.mattstack/evidence`)

  Every other request gets a 404.
- **Story evidence.** Evidence in the story is two thumbnails plus "Open
  full size", not a full-width image.
- **Compare modal.**
  - It fills the screen, less a margin.
  - One segmented control picks Before, After or Side by side. The prev and
    next arrows are removed.
  - The image keeps its aspect ratio inside the frame.
- **No evidence.** A run that recorded none drops the Evidence tab rather
  than show an empty one.

## F. Effective inputs and stage docs

- **The Effective inputs drawer** has these sections:
  - **Packs:** each recorded pack, its short sha and a "matches source" or
    "moved since · N commits" pill.
  - **Stage docs:** a row per stage that expands inline. A stage without a
    doc says "no doc at this version" in its own row.
  - **Decisions in force:** each decision as a sentence, not JSON.
  - **Configuration (current values):** each key with its value and scope
    pill.

  The command-provenance line moves out of the body.
- **Nested drawers.** Nothing opens a drawer on a drawer or a modal on a
  drawer. A configuration key expands inline, showing its description and
  the value per scope (user, team, default), with "in effect" marked and
  "Change it in Settings →".
- **One stage doc drawer** serves the story's "Stage doc" link and the
  Inputs tab. Its title is "<stage> · stage doc", with "<pack> @ <sha> ·
  <sync state>" under it. It renders the markdown and strips the YAML
  frontmatter. The centred stage doc modal is removed.
- **Stage doc lookup fix.** Every live run shows "no compiled doc recorded
  at this version" today, for four reasons:
  1. **Pack name.** Run provenance records a pack under its directory's
     basename (`lib/runs/provenance.ts`). Since team packs moved to
     `teams/<team>/plugin`, runs record `plugin=<sha>`. Provenance now
     records the pack's own name, read from its plugin manifest.
  2. **First token only.** The stage-doc route reads only the first
     `pack_commits` token. It now tries every recorded pack, team packs
     before `mattstack`.
  3. **Moved packs.** The route reads `<sha>:./attachments/stage-<stage>/SKILL.md`
     relative to today's pack directory. Packs have moved since: claimview
     has lived at `packs/claimview`, `teams/claimview/packs/claimview` and
     `teams/claimview/plugin`. The route now resolves the repo that holds
     the recorded commit, lists that commit's tree, and takes the path
     matching `(^|/)attachments/(pipeline/)?stage-<stage>/SKILL.md$` under
     that pack.
  4. **mattstack layout.** mattstack keeps its stage docs under
     `attachments/pipeline/`, and records a version
     (`mattstack=0.30.20`), not a sha. A version-recorded mattstack reads
     the doc from the installed plugin cache for that version when it is
     present, otherwise "no doc at this version".

  A legacy `plugin=<sha>` token resolves to whichever known pack repo
  contains the commit.

## G. Failure, loading and empty states

- **Run fails to load.** A run whose API call fails, or whose id is unknown,
  shows an error card with the reason, plus **Retry** and **Back to runs**.
  Today it spins forever. The card reads "Couldn't load <ticket>" or "No run
  <id> in this repo".
- **Runs API fails.**
  - The runs page shows a warn banner, "Can't reach the rt daemon", with
    **Retry**.
  - The stats show "—", and the lists show a skeleton.
  - Today an outage renders as the empty state with zeros.
- **Loading.** The run and runs pages show a skeleton of the page's shape,
  not a lone spinner.
- **Abandon.**
  - "Mark abandoned" (the "..." menu, stale runs) opens a dialog: "Mark
    <ticket> abandoned?", one explanatory line, and "Why is this run dead?".
    Its buttons are Cancel and a red **Mark abandoned**, right-aligned.
  - On failure the dialog stays open with your reason and an inline error.
- **"..." menu.** It only renders when it has more than one item; otherwise
  its one action shows as its own button.

## H. Notifications (kit)

- **The bug.** The kit's Notification uses Mantine's fixed 22px start
  padding and 28px icon circle, so on the Tokyo dense scale (`spacing-xs`
  4.8px, small text 11.2px) the icon is about 2.5× the text height and the
  padding is uneven.
- **The fix,** in `packages/ui` (base theme `classNames` and the helper's
  `ICON_SIZE`):
  - even padding of 11px top and bottom, 14px start, 12px end
  - an 18px icon circle with an 11px glyph
  - 13px title text
  - a 10px radius
  - the kit's floating shadow
- **Scope.** Every app gets the fix. The kit's notification story is the
  check.
- **Copy.** Notification copy starts with a capital ("Couldn't focus the
  pane"). An error toast can carry a second line that says why.

## I. Search, ⌘K and 404

- **Search.**
  - It moves onto the runs page's look: a page title, a large input with
    "N runs · last 30 days", and result rows in the Earlier list's shape.
  - The graph-paper background goes.
- **⌘K palette.**
  - It is 520px wide.
  - It has a "Runs" section (ticket, title, status pill) and a "Go to"
    section (Runs, "Search runs for '<q>'").
  - The selected row is highlighted with a ↵ cap, and a footer shows the
    keys (↑↓ move, ↵ open, esc close).
- **404.** "Nothing at this address", one line on why (an old link or a
  pruned run), and **Back to runs**. No graph paper.
- **Timeline hover.** A hover or focus on a timeline bar shows a card with:
  - the stage and its state
  - the time span
  - for a waiting stretch, the gate question and your pick

## Testing

- **Unit tests** (pure functions, written failing first):
  - the evidence parser's path rule (fractions, route patterns, file paths,
    URLs)
  - the evidence image route's two conditions
  - provenance pack naming
  - stage doc resolution (moved pack, `plugin=` token, the mattstack
    version-to-cache path, a missing doc)
  - decision count agreement
  - the field label map
  - the Earlier list's day paging
  - review finding severity parsing
- **Component tests:**
  - gate submit failure keeps picks and shows Try again
  - a no-context gate drops the column
  - the run error card and its Retry
  - the runs outage banner
  - abandon failure keeps the reason
  - the "..." menu collapsing to a button
- **Parity.** Every "After" board gets a parity run in light and dark
  (`apps/console/scripts/parity/run.md`), with 0 mismatches outside the
  board-fix list. New boards get `data-parity` keys and design-fixture
  scenarios:
  - an error scenario
  - an outage scenario
  - a review run with findings
  - legacy image evidence
- **Fast Browser on live data, read-only.** Check the stage docs resolve,
  legacy screenshots render and the junk links are gone, on runs like the
  ones that showed the bugs. Live screenshots stay local.

## Out of scope

- The Day timeline's layout (only the bar hover card is in scope).
- Settings, Wiring and the other console pages.
- Changing what rt records about evidence beyond the pack name fix.
- RT-464 to RT-469, the follow-ups already filed.
