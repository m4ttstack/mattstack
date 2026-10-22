---
name: browser-evidence
description: "Use when a pipeline verb takes browser screenshot evidence or turns an image into a composed evidence board: the pack's browser target, the brief, delegating to the Fast Browser driver, the redaction gate, recording a board, or revising one later. Not for direct invocation."
---

# Browser evidence

Fast Browser captures pages and composes boards; this page owns that
evidence inside a run, and the pack's browser target says how to reach its
app. A board is one cropped, labelled image: this verb writes the words, the
driver measures and draws. Each board is a bundle (board, spec, captures,
and for a gated board its redaction record and crops) under one stem in
`~/.fast-browser/screenshots/`, and `evidence_record` copies the whole
bundle into the run's evidence folder, so any later session re-renders it
without a browser. A `<slug> spent?` diamond is yes when the `run_budget`
before it returns `exhausted: true` (`spent >= limit`: the count that
reaches `limit` takes yes).

A case enters this page only when the domain's fill picks a browser
screenshot for it, or when evidence-record composes a board over any other
image. Evidence that is not a browser screenshot (script output, backend
data) is captured by the domain's own method.

## The browser target

The four blocks come from the `## Browser target` section in this verb's
domain rules, or from the file those rules point at for it. A missing block
takes its default:

| Block | Feeds | Default when the block is missing |
|---|---|---|
| Reach the view | Get ready, the brief's `page:` | the URL the plan or intake gives; the developer signs in |
| What proves a change | `show`, `point at`, intake | the plan's words for the case |
| Captions | the claim and every label's wording | plain words |
| Personal data | `hide` | every personal detail on screen that is not being verified |

The pack's block wins over this page only on facts about its app, never on a
STOP below.

A board is a mock-data board only when all three hold:

- Personal data says the page's source holds only mock data (seeded test
  records, no real person), read from where the page is served from, never
  from how the names on screen look;
- its brief has `page:`, never `import:`: an imported image (a ticket
  screenshot) can come from anywhere;
- a pair's `before:` names a board that was itself a mock-data board (its
  `evidence-mock-data:<before stem>` field is set), never an import board.

Its brief's `hide:` line reads `no redact marks: mock data from <source>`,
`<source>` being the source as Personal data names it (a database class, a
site), written before the driver spawns, and its empty record is confirmed
without a question (Confirm a mock-data board).

## Draw the boards

```dot
digraph browser_evidence {
    boards_to_draw [label="Boards to draw" shape=ellipse];
    get_ready_ran [label="Get ready already ran this stage pass?" shape=diamond];
    get_ready [label="Get ready" shape=box];
    fast_browser_doctor [label="fast-browser doctor" shape=plaintext];
    doctor_green [label="Doctor green?" shape=diamond];
    run_budget_doctor [label="run_budget {runDb, key: evidence:doctor-reds, limit: 2, stage}" shape=plaintext];
    doctor_reds_spent [label="doctor-reds spent?" shape=diamond];
    fix_doctor [label="Fix what the doctor reports" shape=box];
    fast_browser_compose_help [label="fast-browser compose --help" shape=plaintext];
    compose_usage [label="Compose usage shown?" shape=diamond];
    write_briefs [label="Write one brief per board" shape=box];
    agent_driver [label="Agent {subagent_type: fast-browser:browser-driver, model: sonnet, effort: medium, prompt: <the briefs>}" shape=plaintext];
    driver_result [label="Driver result?" shape=diamond];
    stop_draw_yourself [label="STOP: the driver captures and composes; never drive the browser, draw or place marks yourself" shape=octagon style=filled fillcolor=red fontcolor=white];
    run_budget_sign_in [label="run_budget {runDb, key: evidence:sign-in-asks, limit: 3, stage}" shape=plaintext];
    sign_in_asks_spent [label="sign-in-asks spent?" shape=diamond];
    stop_credential [label="STOP: never type or ask for a credential; only a saved login" shape=octagon style=filled fillcolor=red fontcolor=white];
    ask_sign_in [label="Ask the developer to sign in" shape=box];
    sign_in_answer [label="Sign-in answer?" shape=diamond];
    read_board [label="Read the board yourself" shape=box];
    reads_right [label="Reads right?" shape=diamond];
    run_budget_rerender [label="run_budget {runDb, key: evidence:rerenders:<stem>, limit: 3, stage}" shape=plaintext];
    rerenders_spent [label="rerenders spent?" shape=diamond];
    redaction_record [label="Redaction record?" shape=diamond];
    stop_self_confirm [label="STOP: confirming is the human's answer, never the agent's, except a mock-data board's empty record" shape=octagon style=filled fillcolor=red fontcolor=white];
    fast_browser_confirm_mock [label="fast-browser compose --confirm ~/.fast-browser/screenshots/<stem>.spec.json (mock-data board)" shape=plaintext];
    mock_confirm_result [label="Mock-data confirm result?" shape=diamond];
    run_field_set_mock [label="run_field_set {runDb, key: evidence-mock-data:<stem>, value: <boardSha256 of the confirmed record> <the hide line>, stage}" shape=plaintext];
    hand_off_at_gate [label="Every board of this hand-off at the redaction gate or done?" shape=diamond];
    wait_for_hand_off [label="Wait for this hand-off's other boards" shape=box];
    run_budget_redaction_gate [label="run_budget {runDb, key: evidence:redaction-openings:<first entry of this opening>:<first crop of this opening, or board>, limit: 4, stage}" shape=plaintext];
    redaction_openings_spent [label="redaction-openings spent?" shape=diamond];
    gate_evidence_redaction [label="Gate evidence-redaction (below)" shape=box];
    redaction_answer [label="Redaction answer?" shape=diamond];
    boards_named [label="Their words name the boards?" shape=diamond];
    ask_which_board [label="Ask which board" shape=box];
    which_answer [label="Which-board answer?" shape=diamond];
    named_boards [label="Split the opening: named boards re-render, the rest confirm" shape=box];
    crops_left [label="Crops left for this board?" shape=diamond];
    fast_browser_confirm [label="fast-browser compose --confirm ~/.fast-browser/screenshots/<stem>.spec.json" shape=plaintext];
    confirm_result [label="Confirm result?" shape=diamond];
    run_budget_confirm [label="run_budget {runDb, key: evidence:confirm-refusals:<stem>, limit: 2, stage}" shape=plaintext];
    confirm_refusals_spent [label="confirm-refusals spent?" shape=diamond];
    run_budget_redaction [label="run_budget {runDb, key: evidence:redaction-rounds:<stem>, limit: 3, stage}" shape=plaintext];
    redaction_rounds_spent [label="redaction-rounds spent?" shape=diamond];
    board_ready [label="Board ready" shape=doublecircle style=filled fillcolor=lightgreen];
    not_drawn [label="Not drawn" shape=doublecircle];
    held_redaction [label="Held at evidence-redaction" shape=doublecircle];

    boards_to_draw -> get_ready_ran;
    get_ready_ran -> get_ready [label="no"];
    get_ready_ran -> write_briefs [label="yes: the doctor was green and compose showed its usage"];
    get_ready_ran -> not_drawn [label="yes: it ended red or without compose; every board of this hand-off, that output quoted"];
    get_ready -> fast_browser_doctor -> doctor_green;
    doctor_green -> fast_browser_compose_help [label="yes"];
    doctor_green -> run_budget_doctor [label="no"];
    run_budget_doctor -> doctor_reds_spent;
    doctor_reds_spent -> fix_doctor [label="no"];
    doctor_reds_spent -> not_drawn [label="yes: every board this pass, the output quoted"];
    fix_doctor -> fast_browser_doctor;
    fast_browser_compose_help -> compose_usage;
    compose_usage -> write_briefs [label="yes"];
    compose_usage -> not_drawn [label="no: an older fast-browser first on PATH; every board this pass, the output quoted"];
    write_briefs -> agent_driver -> driver_result;
    driver_result -> read_board [label="a board"];
    driver_result -> run_budget_sign_in [label="failed: needs-login"];
    driver_result -> not_drawn [label="failed for another reason, or no driver to spawn"];
    driver_result -> stop_draw_yourself [label="tempted to capture, mark up or compose it yourself"];
    driver_result -> stop_credential [label="tempted to sign in by hand"];
    stop_draw_yourself -> agent_driver;
    stop_credential -> run_budget_sign_in;
    run_budget_sign_in -> sign_in_asks_spent;
    sign_in_asks_spent -> ask_sign_in [label="no"];
    sign_in_asks_spent -> not_drawn [label="yes: the reason quoted"];
    ask_sign_in -> sign_in_answer;
    sign_in_answer -> agent_driver [label="Logged in, retry"];
    sign_in_answer -> not_drawn [label="Leave it uncaptured"];
    read_board -> reads_right;
    reads_right -> redaction_record [label="yes"];
    reads_right -> run_budget_rerender [label="no"];
    run_budget_rerender -> rerenders_spent;
    rerenders_spent -> agent_driver [label="no: the brief and what reads wrong"];
    rerenders_spent -> not_drawn [label="yes"];
    redaction_record -> hand_off_at_gate [label="crops: <stem>.redactions.json lists a crop"];
    redaction_record -> fast_browser_confirm_mock [label="empty, on a mock-data board: a page: brief, no import"];
    redaction_record -> hand_off_at_gate [label="empty, on any other board"];
    redaction_record -> board_ready [label="none: no <stem>.redactions.json"];
    redaction_record -> stop_self_confirm [label="tempted to run --confirm without a yes on any other board"];
    stop_self_confirm -> hand_off_at_gate;
    fast_browser_confirm_mock -> mock_confirm_result;
    mock_confirm_result -> run_field_set_mock [label="ok: the record reads confirmed"];
    mock_confirm_result -> hand_off_at_gate [label="refused, or still not confirmed: the human looks"];
    run_field_set_mock -> board_ready;
    hand_off_at_gate -> run_budget_redaction_gate [label="yes: every waiting board, one opening"];
    hand_off_at_gate -> wait_for_hand_off [label="no"];
    wait_for_hand_off -> hand_off_at_gate;
    run_budget_redaction_gate -> redaction_openings_spent;
    redaction_openings_spent -> gate_evidence_redaction [label="no"];
    redaction_openings_spent -> not_drawn [label="yes: redaction openings spent, every board of this opening"];
    gate_evidence_redaction -> redaction_answer;
    redaction_answer -> crops_left [label="proceed: confirmed, every board of this opening"];
    redaction_answer -> boards_named [label="proceed: something needs hiding"];
    redaction_answer -> held_redaction [label="hold"];
    boards_named -> named_boards [label="yes"];
    boards_named -> ask_which_board [label="no"];
    ask_which_board -> which_answer;
    which_answer -> named_boards [label="boards picked"];
    which_answer -> crops_left [label="none picked: every board of this opening confirmed"];
    which_answer -> held_redaction [label="hold"];
    named_boards -> run_budget_redaction [label="each board they name, with their words"];
    named_boards -> crops_left [label="each other board of this opening"];
    crops_left -> run_budget_redaction_gate [label="yes: the next 11 crops"];
    crops_left -> fast_browser_confirm [label="no: every opening of this board confirmed"];
    fast_browser_confirm -> confirm_result;
    confirm_result -> board_ready [label="ok"];
    confirm_result -> not_drawn [label="clean exit, but an empty record still not confirmed: the output quoted, update Fast Browser"];
    confirm_result -> run_budget_confirm [label="refused"];
    run_budget_confirm -> confirm_refusals_spent;
    confirm_refusals_spent -> run_budget_redaction [label="no: re-render with the refusal quoted"];
    confirm_refusals_spent -> not_drawn [label="yes: confirm refused twice, the output quoted"];
    run_budget_redaction -> redaction_rounds_spent;
    redaction_rounds_spent -> agent_driver [label="no: the brief, and their words or the refusal"];
    redaction_rounds_spent -> not_drawn [label="yes: redaction rounds spent"];
}
```

Each hand-off from the verb is one pass and one spawn for the boards it
hands over (a verb that walks cases one at a time spawns once per case);
each returned board then walks the rest of the graph on its own, except
at the redaction gate, which waits for the hand-off's boards and asks about
them together. Get ready runs once per stage pass, before the first spawn.

`Board ready` returns the board to the box that called this flow, which
records it (Record the board, below). `Not drawn` returns with the reason;
it is never a board drawn by hand. No retry can fix these reasons: the
developer left it uncaptured, the doctor stayed red, no compose on PATH,
the sign-in asks were spent, no driver to spawn, redaction rounds or
openings spent, confirm refused twice, or a confirm that left an empty
record unconfirmed. A failed brief (the driver's
other failures) or spent re-renders may draw on a retry. `Held at
evidence-redaction` is the verb's hold path.

## Get ready

Once per stage pass, before the first spawn:

- Start what Reach the view says must run (its servers), for this worktree
  only.
- Build each case's URL from Reach the view.
- Never reconstruct a before by reverting code on a running server.
- Run `fast-browser doctor` on Bash.

### Fix what the doctor reports

Follow the fix the doctor prints, then run it again: at most two runs in
all. Still red, every board this pass is not drawn, with the doctor's
output quoted.

`fast-browser compose --help` that does not print compose's usage (an
older `fast-browser` earlier on PATH says "expected a command") leaves
every board this pass not drawn, with that output quoted and the advice
to update Fast Browser.

## Write one brief per board

One entry per board, in plain words, with exactly these fields:

```
case: <evidence case id>
stem: <run id>-<case id>-<before|after>[-<theme>]
claim: one sentence, what this board proves (the board's title and every image's caption)
show: the region, named in words ("the job row's header")
point at: one line per label: <TAG> | <title> | <description>
hide: what Personal data names, plus every other personal detail on screen that is not being verified; never "nothing"; for a mock-data board, `no redact marks: mock data from <source>`
state: FOUND | AFTER | BEFORE → AFTER | FLOW
page: the URL, the sign-in Reach the view names, and the steps to the state (a live page), or
import: <absolute path of a saved image> from <its link> (a ticket before, or any image that is not a browser capture)
before: <the before board's folder>/<its stem>.spec.json (BEFORE → AFTER only)
```

- `stem`: the theme (`light` or `dark`) only for an image in a
  `{light, dark}` slot, so the two themes never share a stem.
- `state`: a before alone is `FOUND`; an after alone is `AFTER`; a pair
  built from the case's before bundle is `BEFORE → AFTER`; several screens
  are `FLOW` (a `steps` board).
- `point at`: the labels the operator kept at an annotations question, or
  the ones you propose from What proves a change when no such question ran.
  On a `FLOW` board, one line per step.
- `import:` an image already in the record names its `value` path. A
  ticket that embeds the before as an image: save the image and brief it
  as `import:` with the ticket link; its board is the case's before.
- `before:` names the before board's spec where the record holds it: the
  folder of that image's `annotated` path in the record's `value`.

## Labels

The pipeline's rule, stricter than the composing skill: every label carries
a tag and a description, and the description asserts the outcome in one
line. On `single` and `pair` boards a label is a mark (every mark except
`redact`); on a `steps` board a label is a step, and a mark inside a step
may carry no text. The brief says what each label carries; the driver's
composing skill decides where it goes.

- **After**: what was added that was not there before, or which bug is
  fixed that did not work before, and whether verification is complete.
  Tags `NEW`, `CHANGED`, `REMOVED`, `OK`; `PENDING` when verification is
  not complete, and the description names what is left. Examples:
  - `NEW | Retries | Added: the badge counts every retry, which it did not before. Verified.`
  - `OK | Totals row | Fixed: the export total now matches the rows; it was off by one before. Verified.`
  - `PENDING | Dark theme | Added in light theme; dark theme not verified yet.`
- **Before**: what is broken or missing, and that it was reproduced. Tags
  `ISSUE` for a bug, `PENDING` for something not built yet. Examples:
  - `ISSUE | Retries | Bug reproduced: the badge reads 0 after a retry.`
  - `PENDING | Export button | Not there before the change: no export on this page.`

A label never just repeats the board's title. The Captions block's wording
applies to the claim and to every label.

## Delegate to the driver

The `Agent` node: one call per hand-off from the verb, for the boards it
hands over, with `description: "Capture and compose evidence boards"` and
as `prompt` this text followed by the briefs:

> Follow the fast-browser:composing-evidence skill to turn each brief below into one board. For a brief with page:, open it and sign in only with a saved login for that origin (fast-browser:fast-browsing); if signing in needs a person, stop that brief and return it failed with reason needs-login; never type or ask for a credential. Follow the page's steps to the state, then capture. Name files by the brief's stem in ~/.fast-browser/screenshots/: captures <stem>.c1, <stem>.c2, and so on, numbering only the captures you take for this brief and starting at <stem>.c1 (captures copied in for before: keep their own names, so a pair's after capture is <stem>.c1), the spec <stem>.spec.json, the board <stem>.png. Use the brief's claim as the board's title, word for word. Give every label the tag and description its point at line gives, word for word, wherever the composing skill puts them for this layout. For a brief with import:, import that file as <stem>.c1 with its link as the origin. For a brief with before:, copy every capture that spec names, with its PNG, from the before's folder into ~/.fast-browser/screenshots/ unchanged and use them as the BEFORE panel; never recapture the before. Hide what hide: names. Read every board you render. Never run fast-browser compose --confirm. Close every tab you opened. Return one JSON line per brief: {"case", "board", "spec", "captures", "crops", "warnings"}, where crops is the list of redaction crop paths compose printed, or [] when it printed none, or {"case", "failed": true, "reason"}.

A re-render is the same call with that board's brief and what read wrong,
or the human's words from the redaction gate. When the `Agent` tool or that
agent type is missing, every board is not drawn, never drawn by hand.

## Ask the developer to sign in

A clarify question through gate-protocol, scope `clarify:browser-login:<n>`.
The question says the saved login could not sign in, and offers exactly two
options, each with one sentence and no free text and no Hold:

- **Logged in, retry**: the developer has signed in for this origin;
  spawn the driver again for these briefs.
- **Leave it uncaptured**: the board is not drawn.

At most two asks per stage pass (`sign-in-asks`, counted at each
needs-login before the ask).

## Read the board yourself

Read each returned PNG with the image-reading tool. It reads right when:

- the crop shows what `show` names;
- each label sits on what its `point at` line names and shows its tag and
  description (on a `steps` board, each step shows its tag and outcome);
- nothing `hide` names, and no other personal detail, is readable;
- the title is the brief's `claim`, word for word.

A wrong view (a blank page, the change missing from the page) is a Reach
the view problem: apply that block's fixes, then re-render. At most two
re-renders per board (`rerenders:<stem>`).

`Redaction record?` reads the record compose wrote,
`~/.fast-browser/screenshots/<stem>.redactions.json`, never the driver's
`crops` list: crops when that record lists one or more crops, empty when
its `redactions` is `[]`, none when there is no record. Compose writes
no record for a board whose redact marks all sit on live captures (the
page was hidden before the capture left it), so none is expected there.
An empty record
means no panel of the board carries a redact mark, and the upload refuses
it until `fast-browser compose --confirm` marks it confirmed, so it takes
the redaction gate like a record with crops: the human looks at the board
itself and confirms nothing on it needs hiding. The one exception is a
mock-data board (Confirm a mock-data board).

### Confirm a mock-data board

An empty record on a mock-data board (all three conditions under The
browser target) skips the gate: its page holds no real person, so there is
nothing for the human to check. Run the confirm, and only once the record
reads `"confirmed": true` write the run field `evidence-mock-data:<stem>`
with the record's `boardSha256`, a space, and the brief's `hide:` line as
its value. evidence-record trusts the field only for those exact bytes, so
any later render of the stem (a re-capture, a revision, another source)
is shown again until it earns a field of its own. A confirm that is refused
or leaves the record unconfirmed sends the board to the gate instead: the
human looks. A board with crops, or one whose source is not mock data,
never takes this path.

### Every board of this hand-off at the redaction gate or done?

The gate asks about the hand-off's boards together, never one board at a
time. Yes once every board of this hand-off has reached the gate or ended
(ready, not drawn, held); the boards waiting then go into one opening. A
board re-rendered after the gate waits for the others re-rendered with it.

## Gate evidence-redaction (below)

Scope `evidence-redaction:<stage>:<n>`, where `<n>` counts this gate's
openings in this stage pass from 1;
`redaction-openings:<first entry of this opening>:<first crop of this
opening, or board>` (file names) budgets each opening, so a long
hand-off's later openings, and the later openings of one board's long run
of crops, are not charged to the first. Open it with `gate_open` (gate-protocol,
Structured context): the source's `context` is a `boards@1` object, so the
human sees the whole board, not only its crops.

- `summary`: one sentence asking the human to look at every board and
  crop in this opening and check that nothing personal is readable on
  any of them.
- `boards`: for each waiting board, the board itself, then each crop
  `<stem>.redactions.json` lists. Every entry's `path` is absolute (the
  home directory written out, never `~`) and its `case` is the brief's
  case. The board's `slot` is its stem's `before` or `after`, its `theme`
  the stem's when it has one, and its `caption` the brief's claim; each
  crop's `slot` is `crop` and its `caption` names the crop and its board
  (`Crop 1 of the badge board`).
- At most 12 entries per opening: fill each opening with whole boards (a
  board and its crops) in case order, and open the next with the boards
  left. A board with more than 11 crops spreads them over consecutive
  openings, the board first in each with the next 11 crops, until every
  crop has been shown (Crops left for this board?); its confirm waits
  until every one of those openings is answered.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `redaction` (write-in) | **Confirmed: nothing on these boards needs hiding (Recommended)** / **Something needs hiding**, with free text naming the board and what shows | always, once per opening |
| `next` | **Proceed** / **Hold** | always |

Selection: `{"redaction":"confirm|<their words>","next":"proceed|hold","note":"<their words or null>"}`.

### Their words name the boards?

Yes when their words (or the note) pick out one or more boards of this
opening, by case, claim or what the board shows. Those boards re-render
with their words; every other board of the opening counts as confirmed by
that answer and goes on to its confirm at once, without waiting for the
re-renders.

### Ask which board

A clarify question through gate-protocol, scope
`clarify:redaction-which:<n>`, in a form of its own with no `next`
question: which boards of the opening need something hidden, multiple
choice, one option per board (its case and claim), at most four options
per question, so more boards spread over consecutive questions in that
form. The form's one-line context says that boards left unpicked count as
confirmed, and that picking none confirms them all. Their earlier words
travel with each board they pick. A Hold in the form is Held at
evidence-redaction.

### Crops left for this board?

Yes while this board has crops after the ones the last opening showed:
open the next opening with the board first and the next 11 crops. No once
every crop has been in an opening answered confirmed, and at once for a
board with an empty record; only then does
`fast-browser compose --confirm` run. A re-render in any opening starts
the board again from its first crop.

- Confirm runs `fast-browser compose --confirm` on Bash on the spec that
  rendered the board, `~/.fast-browser/screenshots/<stem>.spec.json`, and
  only a board that passed it is recorded.
- `Confirm result?`: a confirm that exits clean is ok, except on an empty
  record that still lacks a top-level `"confirmed": true` afterwards (Fast
  Browser before 0.1.16 exits clean without confirming it): that board is
  not drawn, with the output quoted and the advice to update Fast
  Browser. The first refusal for a board re-renders it through the driver
  with the refusal quoted, counted against `redaction-rounds:<stem>`; a
  second refusal for the same board is not drawn, with the output quoted.
- A named board re-renders, and the new render opens this gate again.
- Every render with a redaction record (crops or empty) that a verb
  records, during a run or in a revision, passes this gate first, or, for
  a mock-data board's empty record, Confirm a mock-data board.

## Record the board

A board ready goes into the record through evidence-record's
`evidence_record` call, which copies its whole bundle from
`~/.fast-browser/screenshots/` into the run's evidence folder:

- `annotated` is the board, `~/.fast-browser/screenshots/<stem>.png`, on
  every image the board shows, and `caption` is the brief's `claim` on each
  of them. A pair board covers both the before and the after image of its
  case, unless the before's board is an import board (its
  `<stem>.c1.capture.json` says `"source": "import"`): that board stays the
  before's cover, so the pair covers the after alone and the before stays
  out of the call.
- Each image's `path` is its own capture: `<stem>.c1.png` for a single
  board, each panel's own capture for a pair, the last step's capture for a
  steps board, and for an import the image the brief imported (its `value`
  path when the record already holds it).
- An import's link goes on the record as run-level `url`.
- The domain's own preview, if any, is never a record path.

Draw on, brief and revise from the paths in the returned `value`, never
the screenshots folder, once a board is recorded.

## Revise a board

A change that needs a recapture (a new crop, new targets) goes back
through `Draw the boards` with the edited brief. Never a browser tool
yourself. Every other change needs no browser, and works in
`~/.fast-browser/screenshots/`; the run's evidence folder is never written
by hand:

1. Find the image in the record's `value`; its `annotated` path's folder
   holds the bundle. No `<stem>.spec.json` there: say so and offer a new
   capture.
2. Bring the recorded bundle back into the screenshots folder, then clear
   its redaction files there so no stale record rides into the new render,
   each as its own command (a glob that matches nothing stops a whole zsh
   command):
   `cp <bundle folder>/<stem>.* ~/.fast-browser/screenshots/`
   then, for a pair, each capture the spec's `panels` name, with its PNG,
   from the bundle folder, then
   `find ~/.fast-browser/screenshots -maxdepth 1 \( -name '<stem>.redact-*.png' -o -name '<stem>.redactions.json' \) -delete`
3. Edit `~/.fast-browser/screenshots/<stem>.spec.json`: the wording, tags,
   marks or redactions asked for, keeping the Labels rule, and append
   `{ "asked": "<their words>", "changed": "<what you changed>" }` to its
   top-level `revisions` list (create it if absent). On a return from step
   5, add their words to this revision's entry instead of appending one,
   so `<k>` stays the same for the whole revision.
4. `fast-browser compose ~/.fast-browser/screenshots/<stem>.spec.json`, and
   read the board as in Read the board yourself.
5. A redaction record beside it (`<stem>.redactions.json`, with crops or
   empty): Gate evidence-redaction, then `fast-browser compose --confirm`
   on that spec. An empty record takes Confirm a mock-data board instead
   only when the board's `evidence-mock-data:<stem>` field was set before
   this revision and nobody asked for anything to be hidden in it; the
   hide line comes from that field. Naming this board returns to step 3
   with their words, counted against `redaction-rounds:<stem>:r<k>`. A Hold there
   holds the revision with nothing recorded; a refused confirm, a confirm
   that left an empty record unconfirmed, or spent redaction rounds or
   openings ends the revision, the output or the spent budget quoted.
6. Record the board (above) for every image the board shows, the claim as
   `caption` (changed or not), through evidence-record's `Record the
   evidence`. The changed bundle lands in a content folder beside the old
   one and the record moves to it.
7. Attach the evidence (evidence-record): `evidence_attach` uploads the
   changed board and rewrites the evidence section.

A revision counts its own budgets and gates: every `evidence:*` key used
while walking it (re-renders, redaction openings and rounds, confirm
refusals, and on a recapture sign-in asks and doctor reds, and
evidence-record's `redaction-repairs:<stem>` in step 7) ends in `:r<k>`,
and its redaction gate's scope is `evidence-redaction:<stage>:r<k>:<n>`,
where `<k>` is the length of the spec's `revisions` list after step 3. A
run that already spent them drawing the board still gets a fresh
allowance, and no earlier gate answer reads as this one.
