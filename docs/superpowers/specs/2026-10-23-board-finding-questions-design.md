# Ask a question about a review finding

## Intent

The board's review gate shows the findings a review agent drafted, and
whatever the user approves posts on the MR under their name. Before
approving, the user often wants to check a finding: is it a real issue,
or a plausible-sounding scenario that never happens? Today the only way
to push back on one finding is to untick it or rewrite its comment by
hand. There is nowhere to ask the agent about it, and no way to change
the finding itself.

This feature adds an **Ask a question** button to every finding in the
review sheet. It opens a conversation with a questions agent about that
one finding, in its own herdr tab, with Flock brought to the front. The
user can ask for an explanation or a rewording, or ask for evidence: the
QA database through sdm, prod analytics (New Relic), logs, or a trace
through the code. If the conversation changes the finding (broader,
narrower, a different severity, different lines, or dropped), the agent
asks whether to send the revision back. On yes, the review gate is
answered "revise". The review agent rewrites that finding, checks it,
and opens a fresh gate. The user finishes and submits the review from
the sheet as usual.

Mockups: `docs/apps/design/board/board.pen`, frames **B23 · Ask a
question on a finding** and **B23b · A revised finding comes back**
(both built on B21 v3, the current review sheet).

## Goals

- One click from a finding to a conversation about it, in a tab named
  for the finding and the MR.
- The questions agent can do everything the user would do to check a
  finding, read-only.
- A finding the conversation changes comes back into the review through
  the review agent, which stays the one owner of the findings.
- Nothing the user did on the other findings (ticks, comment edits) is
  lost when the gate is rebuilt.

## Non-goals

- The questions agent never posts to the MR, never answers the review
  gate with a verdict, and never submits the review.
- No new findings. A conversation revises or drops the finding it is
  about. If the user decides there is a separate issue, they say so in
  the sheet or re-run the review. (A "broader" finding is still that one
  finding, with a wider scope.)
- No change to how respond or doctor gates work.
- No change to which gate kind (in-pane form or turn-end) the review
  gate uses. See "Gate kinds" below.

## Anti-goals

- A revision that bypasses the review agent's checks: a line that is not
  in the diff, or a sheet whose finding counts no longer match the gate
  context (`readReviewGate` drops the whole sheet to a generic body on
  any mismatch).
- Losing the user's in-progress ticks and edits on the other findings
  when the gate is rebuilt.
- Ending the review agent's run. Superseding its gate from outside makes
  the review wrapper treat the gate as gone and stop
  (`apps/board/skills-src/review/SKILL.md:1499-1502`), so only the review
  agent itself may open the replacement gate.
- The questions agent writing anywhere: no database writes, no MR
  comments, no commits.

## The user's flow

1. In the review sheet (B21 v3), each agent finding has an **Ask a
   question** button next to its "Agent Finding" label (B23).
2. Clicking it launches a questions agent in the **questions** workspace,
   on a tab labelled `Q <findingId> !<iid> <author>` (for example
   `Q f1 !812 Joel`), and brings Flock to the front on that tab. The
   review gate stays open and the sheet keeps its state.
3. While that tab is live, the button becomes a pill,
   `Question open · Q f1 !812 ↗`, which focuses the tab. One tab per
   finding, so the user can question two findings on the same MR at once.
4. The user talks it through. If the finding holds, they go back to the
   sheet. The tab stays open until the review is submitted.
5. If the finding changes or falls apart, the agent shows the revised
   finding (or proposes dropping it) and asks whether to send it back.
6. On yes, the review gate is answered "revise" with that revision. The
   review agent rewrites the finding in its report, checks it, and opens
   a fresh gate. The sheet comes back with the revised card marked (B23b)
   and the other findings as the user left them.
7. The user submits from the sheet. Submitting closes that MR's question
   tabs.

## Design

### 1. The sheet (board client)

- `FindingCard` in `apps/board/src/client/board/ReviewDraftCard.tsx`
  gets the Ask a question button in the "Agent Finding" section header.
  The board does not use the Mantine kit: it is built from its own `tui-*`
  classes in `apps/board/src/style.css`. The button is a
  `tui-review-section-link` button passed as `SectionHead` children, the
  same control as The Code's "view full diff", with a new `QuestionGlyph`
  (Lucide `message-circle-question-mark`, ISC) in
  `apps/board/src/client/board/icons.tsx`. Colours come from the board's
  existing tokens (`docs/apps/ui-authoring.md`). The B23 frame decides
  placement only, not geometry.
- When the board's state says a question pane for that finding is live,
  the button is replaced by the pill, which calls the focus route.
- **Where the button shows:** only on a gate built by the domain review
  skill, which writes a report json with stable finding ids, and only on
  this round's findings (not a re-review's skipped findings or earlier
  threads). The wrapper's generic path (no domain skill) and its tier
  fallback (no report json, no ids) get no button and no revise branch.
  The board can tell from whether `/review/report.json` exists and has
  the finding id.
- **How the card knows it was revised:** the board joins its stored
  revision (§4) to the card by MR and finding id. Nothing new travels in
  the gate, so the `findings@1` contract and `readReviewGate`'s strict
  check are untouched.
- A finding the review agent revised carries a notice **inside its own
  card**, not a banner above the list: an amber strip under the header
  reading `Revised from your question in Q f1 · Important → Minor · lines
  117–119 → 121–123 · finding reworded`, a "show original" link, and an
  amber card border (B23b). The card sits in its new severity group.
- What the strip lists comes from comparing the revised finding with the
  original. The original is kept with the revision (see §4).

### 2. Keeping the user's sheet state (board)

The ticks and comment edits live only in React state today
(`review-drafts.ts`, `ReviewGateSheet.tsx`); they leave the browser only
inside a gate answer. The rebuilt gate is a new gate, so they would be
lost.

- The sheet saves its in-progress state to the board server, keyed by MR
  and finding id (not gate id): which findings are ticked, each comment
  edit, the verdict and its summary edit. It saves on change, debounced.
- When the sheet opens a review gate, it restores saved state for any
  finding id the new gate still has, **except** the revised finding,
  which takes the review agent's new draft (its old comment edit is
  dropped, since it described the old finding).
- Saved state is cleared when the review is submitted or the MR's review
  run ends.

Carry-over is the board's job, not the review agent's. The review agent
only has to keep finding ids stable across the rebuild.

### 3. Launching the questions agent (board server)

- **Setting:** `board.workspaces` gains `questions`, default
  `"questions"` (`packages/rt-client/src/settings/registry-defs.ts:602`,
  its zod schema in `registry-schemas.ts:281`, `apps/board/src/config.ts`
  type, validation, defaults and settings mapping). Update the settings
  tests that list the workspace keys.
- **Tracking:** questions do not fit the `agent_states` table, which is
  keyed `(lane, mr_url)` (`apps/board/src/state/db.ts:51-57`) and allows
  one row per MR. Add a `question_states` table keyed
  `(mr_url, finding_id)` with the same pane fields the other lanes keep
  (agentId, paneId, tabId, workspaceId, status, timestamps) plus the
  review gate id it was asked from. Do not add "question" to `Lane` or
  `GateDomain`: it opens no gate and takes no lane in the row status.
- **Route:** a board route that the button calls with `{mrUrl, gateId,
  findingId}`. It follows the doctor launch handler
  (`apps/board/src/server.ts:~2900-3050`):
  - dedupe per `(mr_url, finding_id)`: a live pane is focused instead of
    a second launch (`launch-dedup.ts`);
  - write the row as queued;
  - `launchQuestion` (new, beside `launchDoctor` in
    `apps/board/src/herdr.ts`) builds the prompt with `dispatchPrompt`
    and calls `startAgentPane` with the questions workspace and the tab
    label from `mrTabLabel`, with a `Q <findingId>` prefix (the label
    must be unique per finding, since the daemon reuses any tab whose
    label matches, `lib/agent-herdr.ts:150`);
  - when the launch returns, write back the pane ids and call
    `focusPane({paneId})` to raise Flock on the tab (launches open
    `--no-focus`, so this step is what brings Flock forward).
- **What the agent is given:** the review report json path
  (`state/reviews/<slug>.json`), the finding id, the MR url, the review
  gate id, and the status-bin path for the send-back verb (§4).
- **Closing:** when the review gate is answered with a real verdict, or
  the review run ends, the board closes that MR's question panes and
  clears their rows. Parking is **not** the run ending (see §3a).
- **Code access:** panes launch in the board's configured cwd, not a
  checkout of the MR. The agent reads code the way the review agent does
  (`mr_view`, `gitlab_get`). When it needs a real tree to grep or trace,
  it provisions an rt worktree at the MR head on demand (the `rt:worktree`
  skill, under the pool rules in `.claude/rules/worktree-pool.md`) and
  disposes of it when its tab closes. No worktree at launch.

### 3a. Parking while a question is open

The board parks an unanswered `review-post` gate after
`board.gateGraceMinutes` (default 90) and closes its tab. A resumed
review pane is told never to rewrite the report, so it cannot handle a
revise.

- **An open question keeps the review gate from parking.** The sweep
  skips a `review-post` gate while any live `question_states` row points
  at its MR. The grace clock restarts when the last question tab for the
  MR closes.
- **If the gate parks anyway** (the question tab died, or it parked
  before the question was asked), a send-back is refused with "the
  review is parked; resume it from the board, then send again". Revise
  on a parked gate is out of scope.
- Parking does not close question tabs or clear saved sheet state.

### 4. The questions agent and the send-back (new wrapper skill)

- New wrapper skill `apps/board/skills-src/question/SKILL.md`,
  generated into `apps/board/skills/` like the others, launched as
  `/board:question`. It delegates to no domain skill, so `BoardSkillKind`
  and `resolveLaunchSkillFor` are untouched; setup links it into
  `~/.claude/skills` by its frontmatter name like the other wrappers.
- It opens by reading the finding and the report, then waits for the
  user. Its job is to answer questions and check the finding. It has
  read-only reach: sdm database tunnels (through rt's sdm verbs, QA by
  default; prod only when the user asks), New Relic, logs, and the code
  at the MR's head.
- **How read-only is kept (decided):** by the skill, not by a mechanical
  guard. The skill states the read-only rule as a hard rule, and every
  sdm connection it makes uses a `*-read-only` resource; prod only
  through a read-only resource and only when the user asks for prod in
  the conversation. No new launch plumbing to restrict a pane's tools or
  permission mode is in scope.
- When the conversation changes the finding, it writes out the revised
  finding in the report's finding shape (`id` unchanged, `tier`, `kind`,
  `title`, `body`, `fix`, `file`/`line`, `evidence`, `comment`), or a
  drop, and asks the user in the conversation whether to send it back.
  That question is a plain question in its own pane, not an rt gate.
- On yes it calls a board verb through the status bin (for example
  `<status-bin> question send-back --finding f1 --revision <file>`). The
  board:
  - sends it to the MR's **current** open review gate, not the gate the
    question was first asked from: a question follows its MR across
    rebuilds. It refuses when there is no open review gate (answered with
    a verdict, or parked; see §3a), when a rebuild is in flight, or when
    the finding id is no longer in the current gate (dropped by an
    earlier revision); the agent tells the user why;
  - refuses when the report changed since the agent last read it (another
    question's revision landed). The refusal says so, the agent re-reads
    the report, checks its revision still makes sense against it, and
    asks the user again. *(Builder's call how "since it last read it" is
    tracked; a report revision counter in the question's row is enough.)*
  - stores the revision with the original finding beside it (for the
    sheet's strip and "show original"), and writes it for the review
    agent as `<report stem>.revision.json` beside the report json;
  - **closes** the review gate with a new close reason, `revised`. This
    is decided, not an answer: an answer must be one of the gate's
    options, and a "revise" option would show in the sheet and in the
    pane form. Closing needs `revised` added to `gate:close`'s reason
    enum (`packages/rt-client/src/commands.ts`, the handler check in
    `lib/daemon/handlers/gate.ts`, `closedReason` in
    `lib/daemon/gates-store.ts`) and its own doorbell wording in
    `GATE_CLOSED_PHRASE` (`lib/daemon/gate-push.ts`). The existing
    doorbell-then-Escape on close already dismisses a pane form.
  - "The report changed since the agent read it" is checked by the
    sha-256 of the report json: the agent passes the hash it read, and
    the board compares it with the file now.
- **Two questions on one MR:** each send-back answers the gate once. A
  second send-back made while the first rebuild is in flight is refused
  with "the review is being rebuilt; send again once it reopens". The
  agent tells the user and offers to retry.

### 5. The review agent handles "revise" (review wrapper and domain skill)

- The review wrapper (`apps/board/skills-src/review/SKILL.md`, gate step
  at :1487-1651) learns a new wait result: `gate <id> closed (revised)`.
  Today every closed result is terminal ("end cleanly"); `revised` is the
  one exception. It reads `<report stem>.revision.json` (one revised or
  dropped finding).
- It hands the revision to the domain skill
  (`plugins/mattstack/attachments/review/review/SKILL.md`), which:
  - replaces the finding in the report `.md` and `.json`, keeping its id;
  - for a drop, removes it;
  - checks a new `file:line` is in the MR's diff (an inline comment
    needs both; one that is not becomes a summary-only finding, the same
    rule `hasDiffLine` encodes);
  - recomputes the per-severity counts for the `review@1` context.
- The wrapper then opens a fresh gate itself, the same way its existing
  iterate path does ("the next gate is a NEW gate", domain skill
  :756-762). Because the review agent opens it, its own run continues.

### 6. Gate kinds

Board review gates open today as an in-pane form when the agent has a
session id and every question has four or fewer options
(`packages/rt-client/src/gate-presentation.ts:8-17`). Answering from the
board already works for that case: the doorbell plus an Escape dismisses
the pane form (`lib/daemon/gate-push.ts:209-256`). This feature does not
depend on which kind the review gate is. The planned move of board gates
to turn-end gates makes it simpler (no form to dismiss), but it is not a
prerequisite.

### 7. The Flock repo

Flock (separate repo, `m4ttstack/flock`) lists the board's workspaces in
its BOARD sidebar section (`website/docs/apps/flock.mdx`). How it decides
which workspaces belong there is not in this repo. If it uses a fixed
list or reads the `board.workspaces` keys it knows, the new `questions`
workspace needs a change there. That change is out of this repo and
tracked separately.

## Testing

- Board unit and DOM tests: the button and the pill on `FindingCard`,
  the revised strip, restoring saved sheet state onto a rebuilt gate
  (revised finding excluded), the launch route's per-finding dedupe, the
  send-back refusals.
- Settings: the new `questions` workspace key and its default.
- The review wrapper's revise branch: a skill-level test or fixture in
  whatever form the board's other wrapper changes use.
- Per this repo's rules, run the e2e or pty file that covers any surface
  with exact-string assertions (the gate answer shape, the board's
  `--json` envelopes) before calling it verified.

## Left to the builder

- The send-back verb's flags beyond those the plan names, and the board
  route names.
- The schema of the saved sheet state and of `question_states`.
- Wording of the questions agent's opening message.
