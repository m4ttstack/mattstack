# Preservation inventory: review, self-review, receive-review

Every current node and `###` section of the three skills at `a5ef5c538`,
with its fate in the rewrite. Fates: `kept` (same text; a parenthetical
names what changes around it), `tool: <name>` (the mechanic moves into that
tool), `replaced by: <new node>`, or `gone: <why>`. A node that has a
`###` section of the same text is one row; a note after `section:` says
what changes in the section's prose. Spec refs name sections of
`docs/superpowers/specs/2026-10-16-review-skills-design.md`: "Shared: the
run", "Shared: review gate sites", the numbered steps under each skill
("receive-review 6" is step 6), "Off-script gates", "Board wrapper
contract", "Non-goals", "Kept", and the Behavior changes rows B1 to B21.

Regenerate the node and section lists with the awk and grep in
`red-green.md`'s Method; a row missing from this file is a defect.

GitHub rows marked "builder's call" follow the spec's "Left to the
builder": whether the GitHub post side is one compacted sub-graph or keeps
today's node texts.

## receive-review

127 nodes, 43 `###` sections.

| current text | fate | spec ref |
|---|---|---|
| `Trigger: review feedback to answer on your own MR/PR` (ellipse node) | kept | receive-review 1 |
| `A caller handed a runDb that run_snapshot shows running?` (diamond node) | replaced by: `run_enter {flags, skillDir, stage: receive-review, runDb?, resume?, spawnedBy?}` and `receive-review run_enter mode?` | Shared: the run; B1 |
| `Inherit the caller's run: no run_start, no close` (box node + section) | replaced by: the `inherited` edge of `receive-review run_enter mode?` (the caller closes); section: "rows read drafts from a handed open or saved report path" goes; the cards come from `extra.gate-source.respond-plan` on the run | Shared: the run; B1 |
| `Launched by a surface (spawnedBy)?` (diamond node) | replaced by: `run_enter`'s `spawnedBy`, with `resume` from the handed report's `receive-review-run:` line tried first | Shared: the run; B11 |
| `run_list {repo}` (plaintext node) | tool: `run_enter` (`candidates` mode) | Shared: the run; B1 |
| `Running receive-review runs in this repo?` (diamond node) | replaced by: `receive-review run_enter mode?` (the `candidates` edge) | Shared: the run; B1 |
| `Gate clarify for receive-review: Resume / Start fresh / Hold` (box node + section) | kept (pane form, no run yet); candidates from `run_enter`; section: the `run_list` filter goes; the candidate sentence and Resume options stay | Shared: the run |
| `receive-review clarify answer?` (diamond node) | kept; resume and start fresh are `run_enter` calls, hold records nothing | Shared: the run |
| `run_start {flags, skillDir, spawnedBy?}` (plaintext node) | replaced by: `run_enter` | Shared: the run; B1 |
| `run_start returned ok: true with a runDb?` (diamond node) | replaced by: `receive-review run_enter mode?` (refused or tool-missing edge) | Shared: the run |
| `STOP: rt predates the run tools; tell the user to update rt` (octagon node) | kept, reached when `run_enter` is refused or missing | Shared: the run |
| `run_stage {action: start, stage: receive-review}` (plaintext node) | gone: `run_enter` starts the stage | Shared: the run; B1 |
| `Resume the receive-review run from run_snapshot` (box node + section) | replaced by: `run_snapshot {runDb}` after the `resumed` mode; section: the runDb construction and the `run_stage` / hold-clear lines go; the four re-entry bullets move to the diamond's edges; the held-resume prose goes to `respond_post_execute` on GitLab | Shared: the run; receive-review 1 |
| `run_stage {action: start, stage: receive-review} on resume` (plaintext node) | gone: a resume adopts the running attempt | Shared: the run; B1 |
| `run_field_set {key: hold, value: -, stage: receive-review}` (plaintext node) | gone at the resume (`run_enter` clears `hold`); a node with this call returns on the post side after a pass that holds nothing | Shared: the run; B1; receive-review 10; B20 |
| `What does the receive-review snapshot record?` (diamond node) | kept; edges: no respond-plan record to resolve the change; respond-plan recorded, no respond-post to `Rewrite the receive-review report rows` from the decision plus the `extra.gate-source.respond-plan` cards (`run_field_get`), never re-recorded; respond-post recorded (held or not) to `respond_post_execute`; GitHub to the gh post side | receive-review 1; B8 |
| `What did the caller hand receive-review?` (diamond node) | kept, both handed entries drawn; a `{post}` alone goes to the `gate_record` respond-post node | receive-review (Caller-handed decisions) |
| `Resolve the change and record its identity` (box node + section) | kept; `run_field_set {key: mr}` and `run_field_set {key: branch}` become their own nodes, own or inherited run (an inherited run whose `mr` is set keeps it); `ticket` stays in the section; section: "When the run is yours, record" becomes always (B12); the requirements and no-fabrication rules stay | receive-review 2; B12 |
| `Forge of the change?` (diamond node) | kept | receive-review 2, 3 |
| `MR url or iid in hand?` (diamond node) | kept | receive-review 2 |
| `mr_for_branch {repoName: <root>, branches: [<branch>]}` (plaintext node) | kept | receive-review 2 |
| `Open MR with this source branch?` (diamond node) | kept; its error edge fails the stage (own run: `run_close`, inherited: `run_stage fail`) | receive-review 2 |
| `Report that no open MR has this branch as its source` (box node + section) | kept; section: kept; the error-quoting rule stays | receive-review 2 |
| `mr_threads {mrUrl}` (plaintext node) | replaced by: `mr_threads {mrUrl, filter: "unresolved-human"}` | receive-review 3; B10 |
| `Read the PR's review threads with gh` (box node + section) | kept | receive-review 3 |
| `Keep only unresolved human threads` (box node + section) | replaced by: `Keep only unresolved human threads (GitHub)`, applying the username bot rule by hand; on GitLab the `mr_threads` filter decides; section: GitLab filtering moves to `mr_threads {filter}`; the handed-plan paragraphs: record the plan through `gate_record`, never re-adjudicate (kept), spent-plan rule (kept); "keep every thread the plan names, resolved or not" is OPEN (see Open rows) | receive-review 3; B10 |
| `Executing a caller-handed {plan}?` (diamond node) | kept; the yes edge goes to `gate_record {scope: respond-plan, shape: respond-plan, answers, decidedBy}`; the spent edge reads the rows from the recorded decision | receive-review 4, 7; B6 |
| `Any unresolved human threads?` (diamond node) | kept | receive-review 4 |
| `Dispatch one fresh-context adjudicator over all the review threads` (box node + section) | kept (HARD-GATE) | receive-review 5; Non-goals |
| `Draft the verdict table and one reply per thread` (box node + section) | kept | receive-review 5; Non-goals |
| `Build the open` (box node + section) | kept verbatim (board-named); writes `<dir>/respond-plan.source.json` (plan@1) in a new session-scratchpad dir; field table, one-question-per-thread and the recommended option stay; section: the decision-intake normalization (unwrap, split at `:`, key by thread id) goes to `gate_record`; `mktemp -d` goes (B18); "Fit it" and "The output file IS the open" go to `gate_open`; "never shorten a reply" stays | receive-review 5; Board wrapper contract; B18 |
| `sh ${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh fit < <dir>/respond-plan.source.json > <dir>/respond-plan.open.json` (plaintext node) | replaced by: `gate_open {kind: respond-plan, sourcePath, runDb, stage, scope: respond-plan}` (direct) or the same with `handBack: true, outPath: <dir>/respond-plan.open.json` | receive-review 6; B5 |
| `respond-plan fit exit code?` (diamond node) | replaced by: `gate_open result?` for respond-plan | receive-review 6 |
| `respond-plan fit attempts = 3?` (diamond node) | replaced by: a counter diamond reading `run_budget {runDb, key: respond-plan-open, limit: 3, stage}` | receive-review 6; B4 |
| `Fix the respond-plan source the fit names` (box node + section) | replaced by: the fix for what the `gate_open` refusal names (one problem per line); section: exit 1 becomes the refusal's lines; the counter becomes the `respond-plan-open` key | receive-review 6; Shared: review gate sites 2 |
| `Off-script gate: the respond-plan open will not fit` (box node + section) | kept, its origin now a `gate_open` refusal past the budget; section: "Quote the third fit's problem lines" becomes the last refusal's lines; the never-shorten proposal rule stays | receive-review 6; Off-script gates |
| `Answer at the respond-plan fit off-script gate?` (diamond node) | kept as that gate's answer diamond (take, iterate, hold to `run_hold`, hand back) | Off-script gates |
| `Make the recorded move once at the respond-plan fit` (box node + section) | kept; after the move the open is built again with `gate_open`; section: rerun the fit becomes call `gate_open` again; a spent budget returns to the same gate | Off-script gates |
| `Caller owns the receive-review gates at respond-plan?` (diamond node) | kept | receive-review 6 |
| `Hand back the verdict table and the respond-plan open's path` (box node + section) | kept verbatim (board-named); the `receive-review-run: <run id>` line goes into a handed `--report` first; the handed `{plan}` records through `gate_record`; section: "Record that {plan} with run_decision ... normalized" becomes `gate_record {answers, decidedBy}`; the absolute path contract stays | receive-review 6; Board wrapper contract; B11 |
| `Gate respond-plan through gate-protocol` (box node + section) | replaced by: `gate_open {kind: respond-plan, sourcePath, runDb, stage, scope: respond-plan}`, then gate-protocol at `Trigger: a site opened its gate with gate_open` (acts on `paneAction`); section: the gate bracket, the Read of the open file, `gate_ask`, "act on the returned presentation" (B19), the `gate-ctx.sh prose` recipe and the four-per-call chunking go; kept: one question per thread, the thread id in the option value, `gate-1-context: dropped` written into a saved report when `contextDropped`, the pane-only `next` (Continue / Iterate here / Hold) in a last form call, one `gate_answer`, fix implies reply and skip means neither; the code-changes hide rule (submit `skip` unasked when no thread answered `fix:`) is not named by the spec (see Open rows); the `run_decision` selection schema, Edited replies and A dropped context go to `gate_record` | receive-review 6; B5; B19 |
| `respond-plan pane next answer?` (diamond node) | kept: Continue answers once (`gate_answer {id, answers, runDb, stage}`) and records; Hold answers nothing and goes to `run_hold`; Iterate redrafts and builds a new open | receive-review 6 |
| `Redraft the replies with the respond-plan note` (box node + section) | kept | receive-review 6 |
| `run_decision {contract: gate@1, scope: respond-plan, selection, decidedBy}` (plaintext node) | replaced by: `gate_record {runDb, stage, scope: respond-plan, shape: respond-plan, gateId \| answers + decidedBy, contextDropped?}` | receive-review 7; B6 |
| `Rewrite the receive-review report rows` (box node + section) | kept; writes `gate_record`'s `rows` in today's row format; on a resume, rows from the recorded decision joined to the stored cards; section: the row format stays; the `gate-1` override table goes to `gate_record` (one paragraph on what an override means for the row walk stays); the snapshot-only reading is replaced by the decision plus stored cards; the fresh-pane handed-plan paragraph is replaced by the run line (B11), with no line every textless `reply:` an override; `code-changes: revise` and `skip` stay | receive-review 1, 7 |
| `code-changes answer?` (diamond node) | kept verbatim (board-named) | receive-review 8; Board wrapper contract |
| `Next report row, in verdict-table order?` (diamond node) | kept | receive-review 8 |
| `Implement the thread's fix` (box node + section) | kept | receive-review 8; Non-goals |
| `Run the project's tests and checks on the fix` (box node + section) | kept; its counter sentence moves to `run_budget`; section: ship-time gates rule stays; "the counter is attempts on this thread" becomes the `fix:<threadId>` key | receive-review 8 |
| `Fix checks pass?` (diamond node) | kept | receive-review 8 |
| `Fix attempts on this thread = 3?` (diamond node) | kept; reads `run_budget {runDb, key: fix:<threadId>, limit: 3, stage}` | receive-review 8; B4 |
| `Off-script gate: the thread's fix did not converge` (box node + section) | kept | Off-script gates |
| `Answer at the unconverged-fix off-script gate?` (diamond node) | kept (hold to `run_hold`) | Off-script gates |
| `Make the recorded move once for the unconverged fix` (box node + section) | kept | Off-script gates |
| `Commit the fix and finalize its Fixed reply` (box node + section) | kept | receive-review 8 |
| `Redraft the override's reply` (box node + section) | kept | receive-review 8 |
| `Resumed, or re-asking after respond-post Hold or Iterate?` (diamond node) | gone: GitLab drops the posted-already read (`respond_post_execute` reads the threads itself); GitHub reads every time | receive-review 10, 11; B7 |
| `Posted already: read each thread on the forge` (box node + section) | GitLab: tool: `respond_post_execute` (`alreadyPosted`, `alreadyResolved`); GitHub: replaced by `Posted already on GitHub: read every thread with gh`; section: GitLab: goes whole (`respond_post_execute` reads once); the "write the verdict down" scaffolding goes; GitHub: the fresh-read rule and the re-ask-is-a-new-gate rule stay in the gh sub-graph and `Apply the respond-post note` | receive-review 10, 11; B7 |
| `Forge for the posted-already read?` (diamond node) | replaced by: `Forge for the post side?` (GitLab to `respond_post_execute`, GitHub to the gh boxes) | receive-review 10, 11 |
| `mr_threads {mrUrl} for the posted-already read` (plaintext node) | tool: `respond_post_execute` | receive-review 10; B7 |
| `Read the PR's threads with gh for the posted-already test` (box node + section) | replaced by: `Posted already on GitHub: read every thread with gh` (fresh, every time); section: kept as the section of `Posted already on GitHub: read every thread with gh` | receive-review 11 |
| `Which threads does the posted-already read show carrying this run's reply?` (diamond node) | GitLab: tool: `respond_post_execute`; GitHub: kept or folded into the compacted gh sub-graph (builder's call) | receive-review 10, 11; Left to the builder |
| `Resuming a respond-post record that carries held?` (diamond node) | GitLab: tool: `respond_post_execute` (a held record acts only on the held threads); GitHub: kept or compacted (builder's call) | receive-review 1, 10; Left to the builder |
| `Any thread offered (a finalized fix or an override)?` (diamond node) | kept (the entry to the post half); no goes straight to the post side with no respond-post gate | receive-review 9 |
| `Nothing offered: caller handed a respond-post decision?` (diamond node) | gone: with nothing offered the post side runs directly; a handed `{post}` records through `gate_record` from `What did the caller hand receive-review?` | receive-review 9; Caller-handed decisions |
| `Threads offered: caller handed the respond-post answers?` (diamond node) | kept; yes goes to `gate_record {scope: respond-post, shape: respond-post, answers, decidedBy}` | receive-review 9 |
| `Build the respond-post open` (box node + section) | kept (post@1 field table, offer rule), writing `<dir>/respond-post.source.json`; section: the offer rule, the post@1 json and field table stay; the no-offer bullet's "post the gate-1: reply rows now" goes to the post side (GitLab tool, GitHub boxes); the retired-shape bullet goes; "Fit it" goes to `gate_open` | receive-review 9 |
| `sh ${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh fit < <dir>/respond-post.source.json > <dir>/respond-post.open.json` (plaintext node) | replaced by: `gate_open {kind: respond-post, sourcePath, runDb, stage, scope: respond-post}` or the hand-back pair (`handBack: true, outPath: <dir>/respond-post.open.json`) | receive-review 9; B5 |
| `respond-post fit exit code?` (diamond node) | replaced by: `gate_open result?` for respond-post | receive-review 9 |
| `respond-post fit attempts = 3?` (diamond node) | replaced by: a counter diamond reading `run_budget {runDb, key: respond-post-open, limit: 3, stage}` | receive-review 9; B4; plan budget keys |
| `Fix the respond-post source the fit names` (box node + section) | replaced by: the fix for what the `gate_open` refusal names; section: becomes the refusal fix against `respond-post-open` | Shared: review gate sites 2 |
| `Off-script gate: the respond-post open will not fit` (box node + section) | kept, its origin now a `gate_open` refusal past the budget; section: as the respond-plan one | Kept (every surviving origin); Off-script gates |
| `Answer at the respond-post fit off-script gate?` (diamond node) | kept as that gate's answer diamond | Off-script gates |
| `Make the recorded move once at the respond-post fit` (box node + section) | kept; after the move the open is built again with `gate_open`; section: as the respond-plan one | Off-script gates |
| `Caller owns the receive-review gates at respond-post?` (diamond node) | kept | receive-review 9 |
| `Hand back the offered replies and the respond-post open's path` (box node + section) | kept; the run line goes into the handed `--report`; section: kept; "once you have acted on its {post}" now runs through `gate_record` then the post side | receive-review 9; Board wrapper contract; B11 |
| `Gate respond-post through gate-protocol` (box node + section) | replaced by: `gate_open {kind: respond-post, sourcePath, runDb, stage, scope: respond-post}`, then the protocol (acts on `paneAction`); section: bracket, Read, `gate_ask`, presentation (B19) and the prose recipe go; `next` as its own question stays; "the pane's answer never carries text; the drafted reply posts" goes to `gate_record {shape: respond-post}` | receive-review 9; B5; B19 |
| `respond-post next answer?` (diamond node) | kept: proceed to `gate_record {..., scope: respond-post, shape: respond-post}` then the post side; hold to `Decide nothing at respond-post` then `run_hold`; iterate to `Apply the respond-post note` then a new open | receive-review 9 |
| `Decide nothing at respond-post: no push, post, resolve or record` (box node + section) | kept (named in the spec's Kept list); section: kept; "A hold still records the hold" becomes `run_hold` | receive-review 9; Kept |
| `Apply the respond-post note` (box node + section) | kept; it builds a new open (no posted-already read on GitLab); section: kept; "a new gate over the threads not yet posted (Posted already)" loses the posted-already read on GitLab | receive-review 9 |
| `Picks post or resolve a gate-1: fix row?` (diamond node) | GitLab: tool: `respond_post_execute` (pushes only when a fix row is picked); GitHub: kept (`git_push` only when a fix row is picked) | receive-review 10, 11; B7 |
| `git branch --show-current` (plaintext node) | GitLab: tool: `respond_post_execute` (checks HEAD, `@{push}` and `@{u}`); GitHub: kept | receive-review 10, 11; B7 |
| `git rev-parse --abbrev-ref @{push}` (plaintext node) | GitLab: tool: `respond_post_execute`; GitHub: kept | receive-review 10, 11; B7 |
| `Both name the MR's source branch?` (diamond node) | GitLab: tool: `respond_post_execute` (a mismatch comes back `held` kind `mismatch`); GitHub: kept | receive-review 10, 11; B7 |
| `git_push {tree: <worktree root>}` (plaintext node) | GitLab: tool: `respond_post_execute {runDb, tree, stage}` pushes; GitHub: kept as `git_push {tree: <worktree root>}` | receive-review 10, 11; B7 |
| `git_push result for the fix rows?` (diamond node) | GitLab: tool: `respond_post_execute` (a failed push comes back `held` kind `push`); GitHub: kept | receive-review 10, 11; B7 |
| `STOP: a failed git_push holds the fix rows; never push from the shell, never force` (octagon node) | replaced by: a guard STOP on the `tempted to push from the shell or force` edge out of `respond_post_execute result?`; GitHub keeps its own after `git_push` | receive-review 10, 11 |
| `Hold the picked fix rows and report the failure verbatim` (box node + section) | GitLab: replaced by `Report the held threads verbatim` then `Threads held: run left open for a resume`; GitHub: kept, re-recording with `gate_record {scope: respond-post, ..., held}` and `run_field_set {key: hold, value: held, stage}`; section: the verbatim definition (whole, unedited, fenced) moves to `Report the held threads verbatim`; "record the respond-post decision at once, with held" goes to the tool on GitLab, stays on GitHub | receive-review 10, 11 |
| `Hold the thread the forge refused and report the refusal verbatim` (box node + section) | GitLab: replaced by the hold exit of `Off-script gate: the forge refused a reply or resolve` (the tool already set `hold`); GitHub: kept or compacted (builder's call); section: GitLab: the verbatim rule moves to the batch off-script gate's `context`; GitHub: builder's call | receive-review 10; B9; Left to the builder |
| `Next thread to act on: offered threads, then gate-1: reply rows?` (diamond node) | GitLab: tool: `respond_post_execute`; GitHub: kept or folded into the compacted gh sub-graph (builder's call) | receive-review 10, 11; B7 |
| `post: decided for this thread?` (diamond node) | GitLab: tool: `respond_post_execute`; GitHub: kept or folded into the compacted gh sub-graph (builder's call) | receive-review 10, 11; B7 |
| `Thread already carries this receive-review run's reply?` (diamond node) | GitLab: tool: `respond_post_execute` (`alreadyPosted`); GitHub: answered from `Posted already on GitHub: read every thread with gh` | receive-review 10, 11; B7 |
| `Forge for the reply?` (diamond node) | gone: the forge split moves up to `Forge for the post side?` | receive-review 10, 11 |
| `mr_reply_thread {mrUrl, discussionId, body}` (plaintext node) | tool: `respond_post_execute` | receive-review 10; B7 |
| `mr_reply_thread result?` (diamond node) | tool: `respond_post_execute` (`posted` / `held` kind `reply`) | receive-review 10; B7 |
| `Retried this mr_reply_thread once?` (diamond node) | tool: `respond_post_execute` retries once and re-reads first | receive-review 10; B9 |
| `STOP: a refused mr_reply_thread goes to its off-script gate, never the GitLab CLI` (octagon node) | gone: the graph no longer calls `mr_reply_thread`; a forge refusal comes back in `held[]` to `Off-script gate: the forge refused a reply or resolve` (no hand-reply guard STOP is drawn in the spec; see Open rows) | receive-review 10; B9 |
| `Off-script gate: the forge refused the reply` (box node + section) | replaced by: `Off-script gate: the forge refused a reply or resolve`, one gate for the batch, each `error` quoted; section: folded into the batch gate (B9): quote each held `error`; take is the human posting by hand then the tool again; iterate is calling again after they fix the cause; the re-test-before-retry rule is the tool's | receive-review 10; B9 |
| `Answer at the refused-reply off-script gate?` (diamond node) | replaced by: the batch gate's answer diamond (take and iterate re-call `respond_post_execute`; hold ends with threads held; hand back fails the stage) | receive-review 10; B9 |
| `Make the recorded move once for the refused reply` (box node + section) | replaced by: the batch gate's take (the human posts by hand, then `respond_post_execute` again); section: goes with the batch take | receive-review 10; B9 |
| `Post the reply on GitHub with gh` (box node + section) | kept | receive-review 11 |
| `resolve: decided for this thread?` (diamond node) | GitLab: tool: `respond_post_execute`; GitHub: kept or folded into the compacted gh sub-graph (builder's call) | receive-review 10, 11; B7 |
| `Forge for the resolve?` (diamond node) | gone: the forge split moves up to `Forge for the post side?` | receive-review 10, 11 |
| `mr_resolve_thread {mrUrl, discussionId}` (plaintext node) | tool: `respond_post_execute` | receive-review 10; B7 |
| `mr_resolve_thread result?` (diamond node) | tool: `respond_post_execute` (`resolved` / `held` kind `resolve`) | receive-review 10; B7 |
| `Retried this mr_resolve_thread once?` (diamond node) | tool: `respond_post_execute` retries once | receive-review 10; B9 |
| `STOP: a refused mr_resolve_thread goes to its off-script gate, never the GitLab CLI` (octagon node) | gone: as the refused-reply STOP (see Open rows) | receive-review 10; B9 |
| `Off-script gate: the forge refused the resolve` (box node + section) | replaced by: `Off-script gate: the forge refused a reply or resolve`; section: folded into the batch gate (B9) | receive-review 10; B9 |
| `Answer at the refused-resolve off-script gate?` (diamond node) | replaced by: the batch gate's answer diamond | receive-review 10; B9 |
| `Make the recorded move once for the refused resolve` (box node + section) | replaced by: the batch gate's take; section: goes with the batch take | receive-review 10; B9 |
| `Resolve the thread on GitHub with gh` (box node + section) | kept | receive-review 11 |
| `respond-post decided by a gate or a handed post?` (diamond node) | gone: the respond-post record now comes before the post side (`gate_record`), and `respond_post_execute` re-records held ids itself; GitHub's held re-record is its own node | receive-review 9, 10, 11; Anti-goals |
| `run_decision {contract: gate@1, scope: respond-post, selection, decidedBy}` (plaintext node) | replaced by: `gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId \| answers + decidedBy}` before the post side; GitHub's held re-record `gate_record {..., held}` | receive-review 9, 11; B8 |
| `Any thread held this pass: a failed push or a forge refusal?` (diamond node) | GitLab: replaced by `respond_post_execute result?` (refused / nothing held / reply or resolve held / only push, mismatch or read held); GitHub: kept or compacted | receive-review 10 |
| `Report the outcome (to the caller when it owns the gates)` (box node + section) | kept; section: kept; "the two hold sections carry this report" now names `Report the held threads verbatim` and the batch gate | receive-review 10 |
| `This verb started or resumed the run?` (diamond node) | kept; yes goes to `run_close` | Shared: the run |
| `run_stage {action: done, stage: receive-review}` (plaintext node) | replaced by: `run_close {runDb, workType: receive-review, stage: receive-review, outcome: done}` | Shared: the run; B3 |
| `run_status {status: done\|abandoned}` (plaintext node) | replaced by: the same `run_close` call (`outcome` done or abandoned) | Shared: the run; B3 |
| `run_stage {action: fail, stage: <stage>, reason}` (plaintext node) | kept for an inherited run; an own run's failure or hand back is `run_close {..., outcome: failed or abandoned, reason}` | Shared: the run (Close) |
| `run_decision {contract: gate@1, scope: hold:<stage>:<attempt>, selection: {reason}, decidedBy}` (plaintext node) | replaced by: `run_hold {runDb, stage, reason, decidedBy}` | Shared: the run; B2 |
| `run_field_set {key: hold, value: <their words, or held>, stage: <stage>}` (plaintext node) | gone: `run_hold` writes the hold | Shared: the run; B2 |
| `run_field_set {key: hold, value: held, stage: <stage>}` (plaintext node) | GitLab: tool: `respond_post_execute` sets `hold` to `held`; GitHub: kept as `run_field_set {key: hold, value: held, stage}` | receive-review 10, 11 |
| `No open MR: nothing to answer` (doublecircle node) | kept | receive-review 2 |
| `Held: end the turn naming the run and stage` (doublecircle node) | kept | Shared: the run |
| `Threads held: run left open for a resume` (doublecircle node) | kept | receive-review 10 |
| `receive-review stage failed` (doublecircle node) | kept | Shared: the run |
| `Review feedback answered` (doublecircle node) | kept | receive-review 10 |
| `### Reading a GitLab fact no read tool returns` (section only) | kept | Kept |

Other sections and rules:

| current text | fate | spec ref |
|---|---|---|
| ## Run: "Pass `runDb` on every `run_*` call" | kept | Shared: the run |
| ## Run: an inherited run closes nothing; a hand back still fails the stage | kept (`run_enter` inherited mode; `run_stage fail`) | Shared: the run (Close) |
| ## Run: a surface-launched pane starts fresh | replaced by: `run_enter {spawnedBy}`, tried after `resume` from the run line | Shared: the run; B11 |
| ## Run: `run_start` arguments and the `{{run-start.flags:receive-review}}` block | replaced by: `run_enter {flags, skillDir, stage, ...}`; the flags block is kept | Shared: the run; B1 |
| ## Run: "A result without `ok: true` and a `runDb` means this rt predates the run tools" | replaced by: the refused or tool-missing edge of `receive-review run_enter mode?` | Shared: the run |
| ## Run: `<stage>` is `receive-review` or the inherited `current_stage` | kept (`at.stage`) | Shared: the run |
| ## Run: every gate writes its `gate` field with `stage` and its decision | tool: `gate_open` / `gate_ask` with `runDb`, `stage`, `scope`; review scopes record through `gate_record` | Shared: review gate sites |
| ## Run: the close paragraph (`run_stage done` then `run_status done\|abandoned`) | replaced by: `run_close` | Shared: the run; B3 |
| ## Run: the Hold paragraph (`run_decision hold:<stage>:<attempt>` plus `run_field_set hold`) | replaced by: `run_hold` | Shared: the run; B2 |
| ## Run: the thread-hold paragraph (`hold` = `held`, no hold decision; a read error reported verbatim; a resume retries) | GitLab: tool: `respond_post_execute` sets `hold` and reports held reads; GitHub: kept | receive-review 10, 11 |
| ## Run: "The clarify Hold comes before any run and records nothing. A resume clears the field." | kept (first sentence); the second: tool: `run_enter` | Shared: the run; B1 |
| `{{include:run-identity}}` | kept | Constraints |
| Draft the verdict table section: reply rules (per verdict, an ask is an ask, no performative openers) and the reply-rules seam | kept | Non-goals |
| What the graph cannot show: Push before any Fixed reply (branch check, `@{push}`, `git_push` with `tree`, the proceed authorizes it) | GitLab: tool: `respond_post_execute` (also checks `@{u}` and that the MR is open); GitHub: kept | receive-review 10, 11; B7 |
| What the graph cannot show: Acting on respond-post, only `proceed` (or a handed `post`) acts | kept (`Decide nothing at respond-post`) | receive-review 9 |
| What the graph cannot show: Acting on respond-post, the per-thread act (unwrap, split at `:`, post text, resolve after reply, then every `gate-1: reply` row) | GitLab: tool: `respond_post_execute`; GitHub: kept in the gh boxes | receive-review 10, 11; B7 |
| What the graph cannot show: never a top-level note, never approve the change | kept | Non-goals; Kept |
| What the graph cannot show: the retired-shape `post` (a `replies` list, `resolve-addressed`) | gone: the retired shape goes with the respond-post record prose | receive-review (What goes) |
| What the graph cannot show: The respond-post record (threads entries, `text`, `note`, `held`, empty arrays, never map `thread-<n>` by position) | tool: `gate_record {shape: respond-post}`; GitLab held re-record by `respond_post_execute` | receive-review 9, 10; B6; B7 |
| ## Off-script gate: scope `off-script:receive-review:<n>`, `gate_ask` then `gate_answer` before `run_decision` | replaced by: the include's `## Off-script gate` shape | Off-script gates |
| ## Off-script gate: the `action` / `next` table and the selection schema | gone: the include defines the shape | Off-script gates |
| ## Off-script gate: the answer diamond reading, take once, a site's counter stays spent after iterate or take, hand back is the stage fail with the why | kept; no counter on the human-answered iterate loops | Off-script gates |
| ## Criteria (triage lines, one dispatch over all threads), Reviewer, Reply rules, writing-style lookup, Gate protocol, Wrap-up form contract | kept (gate-protocol from the pipeline-skills rewrite) | Non-goals; Constraints |
| The "If a rule below asks for a move this graph marks STOP" lines | kept | process-digraphs rule 6 |
| Red flag: "I wrote this, I can tell if the reviewer is right" | kept | Non-goals |
| Red flag: "It's a small comment, I'll just judge it here" | kept | Non-goals |
| Red flag: "I'll run self-review at the end as the check" | kept | Non-goals |
| Red flag: "I'll open with 'Good call' / 'You're right'" | kept | Non-goals |
| Red flag: "I'll process the resolved / bot threads too" | kept (GitHub filters by hand; GitLab's filter is the tool's) | receive-review 3 |
| Red flag: "I'll ask both gate questions, the caller already handed `{plan, post}`" | kept | Caller-handed decisions |
| Red flag: "I'll post the replies since they look right" | kept (post only what an answer picked; never approve) | Kept |
| Red flag: "I'll offer the reply-only threads at `respond-post` too" | kept (the offer rule) | receive-review 9; Kept |
| Red flag: "Gate 2's answer doesn't name the reply-only thread, so it stays unposted" | gone: GitLab `respond_post_execute` posts the gate-1 reply rows; GitHub keeps the rule in its gh boxes (builder's call) | receive-review 10, 11 |
| Red flag: "They answered `reply:`, so the drafted reply posts now" | tool: `gate_record` (override rule); the one kept paragraph says what an override means | receive-review 7; B6 |
| Red flag: "The pane showed the prose, so a dropped context does not matter" | tool: `gate_record {contextDropped}` | receive-review 7; B6 |
| Red flag: "The stderr says shorten and re-ask" | gone: `gate_open` fits the open; the never-shorten rule stays in Build the open | receive-review 5, 6 |
| Red flag: "I know the contexts were dropped; I'll apply that when the answer comes" | kept (write `gate-1-context: dropped` into the saved report) | Board wrapper contract |
| Red flag: "The draft is gone, but I know what it said" | tool: `gate_record` rows from stored cards; with no cards every textless reply is an override | receive-review 1, 7; B11 |
| Red flag: "It's only a note, so the verbatim draft still posts" | tool: `gate_record` (override rule) | B6 |
| Red flag: "The verdict report recommended a reply here, so it posts" | kept (rows read the `gate-1` field) | receive-review 8 |
| Red flag: "The plan record has no slot for the edited reply" | tool: `gate_record` (`texts`, `overrides`, `notes`) | B6 |
| Red flag: "The gate approved posting, not a push, so the Fixed reply goes up" | GitLab: tool: `respond_post_execute`; GitHub: kept | receive-review 10, 11; B7 |
| Red flag: "A plain push from the shell pushes the MR" | GitLab: tool plus the guard STOP; GitHub: kept | receive-review 10, 11 |
| Red flag: "The fix is held, so I'll record respond-post once it posts" | GitLab: tool: `respond_post_execute` re-records held; GitHub: kept | receive-review 10, 11 |
| Red flag: "They ticked post before choosing Iterate (or Hold)" | kept (`Decide nothing at respond-post`) | receive-review 9 |
| Red flag: "The snapshot has no respond-post record, so nothing has posted yet" | GitLab: tool: `respond_post_execute` (`alreadyPosted`); GitHub: kept (the fresh gh read) | receive-review 10, 11; B7 |
| Red flag: "This one is clearly right, I'll add the guard in a follow-up commit" | kept | Non-goals |
| Red flag: "It's wrong, but I need the reviewer to point me at it" | kept | Non-goals |
| Red flag: "The pane is fresh, so I'll adjudicate again before applying the handed plan" | kept | Caller-handed decisions |
| Red flag: "The caller asked the respond-plan gate, so it records the decision" | kept: this verb records it, through `gate_record {answers, decidedBy}` | receive-review 7; B6 |
| Red flag: "I'll present the table and ask about fixes and posting in the same breath" | kept | Kept |

## review

115 nodes, 39 `###` sections.

| current text | fate | spec ref |
|---|---|---|
| `Trigger: review a teammate's MR or PR` (ellipse node) | kept | review 1 |
| `runDb handed in by a caller of review?` (diamond node) | replaced by: `run_enter {flags, skillDir, stage: review, runDb?, resume?, spawnedBy?}`, passing the handed runDb | Shared: the run; B1 |
| `run_snapshot {runDb: <handed>}` (plaintext node) | tool: `run_enter` (`inherited` mode) | Shared: the run; B1 |
| `Handed review run is running?` (diamond node) | replaced by: `review run_enter mode?` (the `inherited` edge) | Shared: the run; B1 |
| `A surface launched this review pane?` (diamond node) | replaced by: `run_enter`'s `spawnedBy`, with `resume` from a handed report's `review-run:` line tried first | Shared: the run; review 1; B11 |
| `run_list {repo}, keep running review runs` (plaintext node) | tool: `run_enter` (`candidates` mode) | Shared: the run; B1 |
| `Running review runs in this repo?` (diamond node) | replaced by: `review run_enter mode?` (the `candidates` edge) | Shared: the run; B1 |
| `Gate review clarify: Resume / Start fresh / Hold` (box node + section) | kept (pane form, no run yet); candidates from `run_enter`; section: the `<home>/.mattstack/runs/...` construction goes; "never re-ask an answered question" stays | Shared: the run |
| `Review resume answer?` (diamond node) | kept; resume and start fresh are `run_enter` calls | Shared: the run |
| `run_stage {action: start, stage: review} on the resumed runDb` (plaintext node) | gone: a resume adopts the running attempt | Shared: the run; B1 |
| `run_field_set {key: hold, value: -, stage: review}` (plaintext node) | gone: `run_enter` clears `hold` | Shared: the run; B1 |
| `run_snapshot {runDb: <resumed review>}` (plaintext node) | kept | Shared: the run |
| `Resumed review snapshot records?` (diamond node) | kept: no post decision re-enters, a post decision closes | review 1 |
| `run_start {flags, skillDir, spawnedBy?} for review` (plaintext node) | replaced by: `run_enter` | Shared: the run; B1 |
| `review run_start ok: true with a runDb?` (diamond node) | replaced by: `review run_enter mode?` (refused or tool-missing edge) | Shared: the run |
| `STOP: rt predates the run tools; tell the user to update rt` (octagon node) | kept, reached when `run_enter` is refused or missing | Shared: the run |
| `run_stage {action: start, stage: review}` (plaintext node) | gone: `run_enter` starts the stage | Shared: the run; B1 |
| `Resolve the review target` (box node + section) | kept; section: kept whole (hold reasons now through `run_hold`, `decidedBy: "pane"`) | review 2 |
| `Review target form?` (diamond node) | kept | review 2 |
| `mr_view {mrUrl, or repoName + iid}` (plaintext node) | kept | review 2 |
| `mr_view returned the MR?` (diamond node) | kept; its hold edge goes to `run_hold` | review 2; B2 |
| `mr_for_branch {repoName: <checkout>, branches: [<branch>]}` (plaintext node) | kept | review 2 |
| `mr_for_branch entry for the branch?` (diamond node) | kept; its hold edge goes to `run_hold` | review 2; B2 |
| `gh pr view <ref>` (plaintext node) | kept | review 2 |
| `gh pr view found the PR?` (diamond node) | kept; its hold edge goes to `run_hold` | review 2; B2 |
| `mr_list {repoName: <checkout>, sourceBranch: <branch>, state: all, limit: 200}` (plaintext node + section) | kept | review 2 |
| `mr_list matches for the branch?` (diamond node + section) | kept; its hold edges go to `run_hold` | review 2; B2 |
| `mr_list {repoName: <checkout>, search: <ticket id>, state: all, limit: 200}` (plaintext node + section) | kept | review 2 |
| `mr_list matches for the ticket?` (diamond node + section) | kept | review 2 |
| `Review clarify rounds = 2?` (diamond node) | kept; reads `run_budget {runDb, key: target-clarify, limit: 2, stage}` | review 2; B4 |
| `STOP: GitLab ticket searches go through the read tools or gitlab_get` (octagon node) | kept | review 2 |
| `STOP: GitLab reads go through the read tools or gitlab_get` (octagon node) | kept | review 2 |
| `STOP: GitLab branch lookups go through the read tools or gitlab_get` (octagon node) | kept | review 2 |
| `Gate review clarify: which target?` (box node + section) | kept, asked as `gate_ask {..., kind: clarify, runDb, stage}` through the protocol, which records `{target, next}`; the site's `run_field_set gate` and `run_decision` go; section: the bracket and the `run_decision {scope: clarify, selection: {target}}` line go; "counts the typed answers" becomes the `target-clarify` key | review 2; B16 |
| `Review target answer?` (diamond node) | kept; hold to `run_hold` | review 2; B2 |
| `Own review run: record the target?` (diamond node) | kept | review 2 |
| `Record the review target: mr, branch and any ticket` (box node + section) | kept (three `run_field_set` calls) | review 2 |
| `Caller framed a re-review?` (diamond node + section) | kept | review 2 |
| `Take the earlier threads the caller handed in` (box node + section) | kept | Non-goals |
| `Earlier threads in hand?` (diamond node) | kept; its hold edge to `run_hold` | review 2; B2 |
| `Print the review depth block` (box node + section) | kept | review 3 |
| `Review diff forge?` (diamond node) | kept | review 3 |
| `gh pr diff <ref>` (plaintext node) | kept | review 3 |
| `git fetch origin +pull/<n>/head:refs/remotes/origin/pr-<n>` (plaintext node) | kept | review 3 |
| `git fetch origin <targetBranch> +refs/merge-requests/<iid>/head:refs/remotes/origin/mr-<iid>` (plaintext node) | kept | review 3 |
| `git diff origin/<targetBranch>...origin/mr-<iid>` (plaintext node) | kept | review 3 |
| `MR-head checkout in hand for the review checks?` (diamond node + section) | kept | review 3 |
| `worktree_provision {repoName, branch: <source branch>} for the review head` (plaintext node) | kept, adding `reuse: true` | review 3; B15 |
| `Review head worktree_provision returned a path?` (diamond node + section) | kept; a `kind: "reused"` result is a path; section: the `branch-attached:<tree>` refusal-parsing rule goes (`reuse: true` returns `reused`) | review 3; B15 |
| `Provisioned review tree at the fetched head?` (diamond node + section) | kept | review 3 |
| `STOP: create a review checkout only with worktree_provision` (octagon node) | kept | review 3 |
| `Set up for the review depth` (box node + section) | kept | review 3 |
| `Dispatch the fresh reviewer; it forms the findings` (box node + section) | kept | Non-goals |
| `Assemble the review draft` (box node + section) | kept | Non-goals |
| `Verify each blocking finding against the MR head` (box node + section) | kept; "a round counts each time this step runs" becomes the `run_budget` key; section: the anchor, quote and command checks stay; the round-count sentence becomes the budget key | review 4 |
| `Every blocking finding verified?` (diamond node) | kept | review 4 |
| `Review verify rounds = 2?` (diamond node) | kept; reads `run_budget {runDb, key: verify-rounds:<depth>, limit: 2, stage}` | review 4; B4 |
| `Re-dispatch a fresh reviewer on the unverified findings` (box node + section) | kept; section: "the counter is verify rounds in this run" becomes the budget key | review 4 |
| `Demote each unverified finding to Minor, marked unverified` (box node + section) | kept | review 4 |
| `Review report path given?` (diamond node) | kept | review 4 |
| `Write the review report and its json sibling` (box node + section) | kept verbatim (board-named) | Board wrapper contract |
| `Decided selection handed in by the review caller?` (diamond node) | kept | review 5 |
| `Review report json in hand?` (diamond node) | kept | review 5 |
| `Write review-post.extras.json` (box node + section) | kept with its field table; its scratch dir is a new dir in the session scratchpad, and a report json outside the temp root is copied there first on the direct path; section: `mktemp -d` goes (B18); the json shape and field table stay; "Then the two scripts, exactly" and the exit-code paragraph go on the direct path (the `review-source.sh` recipe description stays for the hand-back) | review 5; B18; B21 |
| `sh "${CLAUDE_SKILL_DIR}/scripts/review-source.sh" <report json> <dir>/review-post.extras.json > <dir>/review-post.source.json` (plaintext node) | kept on the caller-owns-the-gates path only (the board's prose step reads the source file); the direct path is `gate_open {kind: review-post, review: {findingsPath, extras}, runDb, stage, scope: post}` | review 5; Constraints (scripts stay vendored) |
| `sh "${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh" fit < <dir>/review-post.source.json > <dir>/review-post.open.json` (plaintext node) | replaced by: `gate_open {kind: review-post, sourcePath, handBack: true, outPath: <dir>/review-post.open.json, runDb, stage, scope: post}` (hand-back) or the direct `gate_open {review}` | review 5; Board wrapper contract (open file shape) |
| `Both review scripts exit 0?` (diamond node) | replaced by: `gate_open result?` | review 5 |
| `Fixed a field a review script named once already?` (diamond node) | kept; reads `run_budget {runDb, key: post-open-fix, limit: 1, stage}` | review 5; B4 |
| `Fix the field the review script names` (box node + section) | kept as the fix for the field a `gate_open` refusal names (one problem per line); section: "Exit 1 from either script" becomes "the field the refusal names"; fix exactly that, once | Shared: review gate sites 2 |
| `Open the review off-script gate: a review script refused` (box node + section) | kept, its origin now a `gate_open` refusal past the budget; the proposed move is still the legacy gate; section: exit 1 and exit 2 become a `gate_open` refusal and the spent `post-open-fix` budget | review 5; Off-script gates |
| `Review script off-script answer?` (diamond node) | kept (take, iterate, hold to `run_hold`, hand back) | Off-script gates |
| `Caller owns the review gates?` (diamond node) | kept verbatim (board-named) | Board wrapper contract |
| `Hand back the severity line and the open's paths` (box node + section) | kept; before it, the `review-run: <run id>` line goes into the handed `--report`; section: the paths contract stays (open, its source beside it, the vendored `gate-ctx.sh`, the MR head sha); the `"fits": false` drop-contexts-yourself rule goes (`gate_open {handBack}` drops whole question contexts largest first) | review 5; Board wrapper contract; B11 |
| `Review caller's answer?` (diamond node) | kept verbatim (board-named); the handed selection records with `gate_record {..., answers, decidedBy}` after posting | Board wrapper contract; review 5 |
| `Gate review-post: open the posting gate from review-post.open.json` (box node + section) | replaced by: `gate_open {kind: review-post, review: {findingsPath, extras}, runDb, stage, scope: post}`, then gate-protocol at `Trigger: a site opened its gate with gate_open`; section: the bracket, the Read of the open file, the `gate-ctx.sh prose` form recipe and the four-per-call chunking go to gate-protocol's `### Present the in-pane gate form` (formChunks); "the post record lands after posting" stays | review 5; Shared: review gate sites 2 |
| `Gate review-post, legacy: tiers, outcome and next` (box node + section) | kept, asked as `gate_ask {questions: tiers, outcome, next; kind: review-post; scope: post; runDb; stage}` through the protocol | review 5 |
| `Review-post next answer?` (diamond node) | kept; hold to `run_hold` | review 5; B2 |
| `Take the human's changes into the review draft` (box node + section) | kept; a depth change starts a fresh `verify-rounds:<depth>` key (today's reset); section: "resets the verify-round counter" becomes a fresh `verify-rounds:<depth>` key | review 4 |
| `Review iterate note asks for another depth?` (diamond node) | kept | review 4 |
| `Review posting forge?` (diamond node) | kept | review 7 |
| `gh pr review <ref> with the disposition and the summary body` (plaintext node) | kept | review 7 |
| `gh pr review result?` (diamond node) | kept; its posted edge ends at the `gate_record` post node | review 7 |
| `Open the review off-script gate: gh pr review refused` (box node + section) | kept | review 7; Off-script gates |
| `gh pr review off-script answer?` (diamond node) | kept | Off-script gates |
| `gh pr comment <ref> with the summary body` (plaintext node) | kept; it ends at the `gate_record` post node | review 7 |
| `This review already on the MR?` (diamond node + section) | kept (GitLab); on a resume with no post decision, before a submit, it reads `mr_posted_since {mrUrl, since: <run started_at>, items: [summary first line as contains, each anchored comment as {id, contains, path, line}]}`; a first pass answers no without a read; section: the `mr_threads` judgment goes (`mr_posted_since` items); the latest hold reason rule and the four outcomes stay | review 6; B14 |
| `Compose the submitted review: comments, summary, outcome` (box node + section) | kept, trimmed to placement, the 100-item cap, `replies` from the `thread-<n>` answers, and restored findings; section: the comment and summary placement, the 100 cap, the `replies` build from `thread-<n>` answers and the restored-finding rules stay | review 5 |
| `mr_review_submit {mrUrl, outcome, summary, comments, replies}` (plaintext node) | kept | review 7 |
| `mr_review_submit result?` (diamond node) | kept; the posted edge ends at the `gate_record` post node | review 7 |
| `Bad anchors moved into the summary once already?` (diamond node) | kept; reads `run_budget {runDb, key: bad-anchors, limit: 1, stage}` | review 7; B4 |
| `Move the bad-anchor findings into the summary` (box node + section) | kept | review 7 |
| `STOP: never post a review piece by piece or with the GitLab CLI; open the review off-script gate` (octagon node) | kept | review 7 |
| `Open the review off-script gate: mr_review_submit refused` (box node + section) | kept | review 7; Off-script gates |
| `Open the review off-script gate: pending comments on the MR` (box node + section) | kept | review 7; Off-script gates |
| `Review submit off-script answer?` (diamond node) | kept | Off-script gates |
| `Make the recorded review move once` (box node + section) | kept | Off-script gates |
| `mr_approve {mrUrl}` (plaintext node) | kept | review 7 |
| `mr_approve result?` (diamond node) | kept | review 7 |
| `Open the review off-script gate: mr_approve refused` (box node + section) | kept | review 7; Off-script gates |
| `Approval off-script answer?` (diamond node) | kept | Off-script gates |
| `Make the recorded approval move once` (box node + section) | kept | Off-script gates |
| `run_decision {contract: gate@1, scope: post, selection: {findings, disposition}, decidedBy}` (plaintext node) | replaced by: `gate_record {runDb, stage, scope: post, shape: post, gateId \| answers + decidedBy}`, still after posting | review 5, 7; B13 |
| `Own review run: close it?` (diamond node) | kept; yes goes to `run_close` | review 8 |
| `run_stage {action: done, stage: review}` (plaintext node) | replaced by: `run_close {runDb, workType: review, stage: review, outcome: done}` | review 8; B3 |
| `run_status {status: done} for review` (plaintext node) | replaced by: the same `run_close` call | review 8; B3 |
| `End with the review target's forge link` (box node + section) | kept | Kept |
| `run_decision {contract: gate@1, scope: hold:<stage>:<attempt>, selection: {reason}, decidedBy} for review` (plaintext node) | replaced by: `run_hold {runDb, stage, reason, decidedBy} for review` | Shared: the run; B2 |
| `run_field_set {key: hold, value: <their words>, stage: <review stage>}` (plaintext node) | gone: `run_hold` writes the hold | Shared: the run; B2 |
| `Own review run: close it as abandoned?` (diamond node) | kept | review 8 |
| `run_stage {action: fail, stage: review, reason: <why; what already posted>}` (plaintext node) | replaced by: `run_close {runDb, workType: review, stage: review, outcome: abandoned, reason}` | review 8; B3 |
| `run_status {status: abandoned} for review` (plaintext node) | replaced by: the same `run_close` call | review 8; B3 |
| `run_stage {action: fail, stage: <run.current_stage>, reason: <why; what already posted>}` (plaintext node) | kept: an inherited run's hand back fails the stage | review 8 |
| `Review held: end the turn` (doublecircle node) | kept | Shared: the run |
| `Review handed back: the why and what posted, quoted` (doublecircle node) | kept | review 8 |
| `Review posted` (doublecircle node) | kept | review 8 |
| `### Reading a GitLab fact no read tool returns` (section only) | kept | Kept (target resolution, verification reads) |

Other sections and rules:

| current text | fate | spec ref |
|---|---|---|
| ## Run: the inherited-run rule (`run.current_stage` is the stage) | replaced by: `run_enter {runDb}` `inherited` mode | Shared: the run; B1 |
| ## Run: `run_list` filter and `run_start` arguments paragraph | replaced by: `run_enter` | Shared: the run; B1 |
| ## Run: `{{run-start.flags:review}}` block | kept (`run_enter` takes `flags` verbatim) | Shared: the run |
| ## Run: "Every gate in this verb writes its `gate` field" | tool: `gate_open` / `gate_ask` with `runDb` and `stage` | Shared: review gate sites |
| `{{include:run-identity}}` | kept | Constraints |
| ## Review off-script gates: scope `off-script:review:<n>` and the `action` / `next` table | replaced by: the include's `## Off-script gate` shape | Off-script gates |
| ## Review off-script gates: the selection-schema paragraph | gone: the include defines the shape | Off-script gates |
| ## Review off-script gates: take once, iterate retries with a new gate each failure, a hold or hand-back reason says what is on the MR, the posted/approval statement for a resume | kept | Off-script gates |
| ## Review off-script gates: a gate that comes back `closed` is a hold "gate closed" | kept (to `run_hold`) | Off-script gates; B2 |
| What the graph cannot show: review verbs never decide what posts | kept | Non-goals |
| What the graph cannot show: the draft is presented once, then the severity line | kept | Board wrapper contract |
| What the graph cannot show: a caller's decided selection shape (`{findings, outcome}`, legacy `{tiers, outcome}`, `replies`, `restored`) | kept | review 5 |
| What the graph cannot show: posting handed `{findings: <ids>, disposition}`, the `findings-<n>` union, `{value, note}` unwrap, legacy tiers, replies and restored ride along | tool: `gate_record {shape: post}` builds `{findings, disposition, replies?, restored?}`; Compose keeps the submit's own build | review 5; B13 |
| What the graph cannot show: the post record's `selection` and `decidedBy` rule | tool: `gate_record` (gate answer's by, or the handed `decidedBy`) | review 5; B13 |
| What the graph cannot show: a hold records `run_decision` plus `run_field_set` | replaced by: `run_hold` | Shared: the run; B2 |
| What the graph cannot show: on a resume with no post decision, read the MR with `mr_threads` for the summary note | replaced by: `mr_posted_since` items | review 6; B14 |
| What the graph cannot show: a `closed` gate is a hold; a fetch or diff error is a hold quoting it | kept (to `run_hold`) | Kept; B2 |
| ## The review flow, Criteria, Reviewer, Gate protocol, Wrap-up form contract, writing-style lookup and review-posting includes and slots | kept (gate-protocol from the pipeline-skills rewrite) | Non-goals; Constraints |
| Posting mechanics on GitLab: one `mr_review_submit`, no hand-built positions, no `mr_comment_inline`; GitHub rides one `gh pr review` body | kept | review 7 |

## self-review

59 nodes, 19 `###` sections.

| current text | fate | spec ref |
|---|---|---|
| `Trigger: self-review the current branch` (ellipse node) | kept | self-review 1 |
| `runDb handed in by a caller of self-review?` (diamond node) | replaced by: `run_enter {flags, skillDir, stage: self-review, runDb?, resume?, spawnedBy?}`, passing the handed runDb | Shared: the run; B1 |
| `run_snapshot {runDb: <handed to self-review>}` (plaintext node) | tool: `run_enter` (its `inherited` mode checks the handed run is running) | Shared: the run; B1 |
| `Handed self-review run is running?` (diamond node) | replaced by: `self-review run_enter mode?` (the `inherited` edge; stage is `at.stage`) | Shared: the run; B1 |
| `A surface launched this self-review pane?` (diamond node) | replaced by: `run_enter`'s `spawnedBy` argument, read through `self-review run_enter mode?` | Shared: the run; B1 |
| `run_list {repo}, keep running self-review runs` (plaintext node) | tool: `run_enter` (its `candidates` mode replaces `run_list` plus the hand filter) | Shared: the run; B1 |
| `Running self-review runs in this repo?` (diamond node) | replaced by: `self-review run_enter mode?` (the `candidates` edge) | Shared: the run; B1 |
| `Gate self-review clarify: Resume / Start fresh / Hold` (box node + section) | kept (pane form, no run yet); candidates come from `run_enter`, each with an absolute `runDb` and `ownSession` for the recommended Resume; section: the `<home>/.mattstack/runs/<repo>/<id>/state.db` construction goes (the candidate carries `runDb`); the live-pane and surface-launched rules stay | Shared: the run |
| `Self-review resume answer?` (diamond node) | kept; resume is `run_enter {..., resume: <runId>}`, start fresh is `run_enter {..., fresh: true}`, hold ends the turn recording nothing | Shared: the run |
| `run_stage {action: start, stage: self-review} on the resumed runDb` (plaintext node) | gone: a resume adopts the running attempt | Shared: the run; B1 |
| `run_field_set {key: hold, value: -, stage: self-review}` (plaintext node) | gone: `run_enter` clears `hold` on a resume | Shared: the run; B1 |
| `run_snapshot {runDb: <resumed self-review>}` (plaintext node) | kept (`resumed` mode, then `run_snapshot {runDb}` to the re-entry) | Shared: the run |
| `run_start {flags, skillDir, spawnedBy?} for self-review` (plaintext node) | replaced by: `run_enter {flags, skillDir, stage: self-review, ...}` | Shared: the run; B1 |
| `self-review run_start ok: true with a runDb?` (diamond node) | replaced by: `self-review run_enter mode?` (the refused or tool-missing edge) | Shared: the run |
| `STOP: rt predates the run tools; tell the user to update rt before a self-review` (octagon node) | kept, reached when `run_enter` is refused or missing | Shared: the run |
| `run_stage {action: start, stage: self-review}` (plaintext node) | gone: `run_enter` starts the stage (`started` mode continues) | Shared: the run; B1 |
| `Find the self-review merge-base` (box node + section) | kept | self-review 2 |
| `Own self-review run: record the branch?` (diamond node) | kept | self-review 2 |
| `Record the self-review branch and any ticket` (box node + section) | kept | self-review 2 |
| `Requirements known: a ticket or the task text?` (diamond node) | kept | self-review 2 |
| `Gate self-review clarify: which requirements source?` (box node + section) | kept, asked as `gate_ask {..., kind: clarify, runDb, stage}` through the protocol, which records the answers map `{source, next}`; the `run_field_set gate` bracket and the hand `run_decision` go; section: the bracket line and the `run_decision {scope: clarify, selection: {source}}` line go | self-review 2; B16 |
| `Requirements source answer?` (diamond node) | kept; the hold edge goes to `run_hold` | self-review 2; B2 |
| `Print the self-review depth block` (box node + section) | kept | self-review 3 |
| `Run the checks the self-review depth names` (box node + section) | kept | self-review 3 |
| `Who forms the self-review judgment?` (diamond node) | kept | self-review 3; Non-goals |
| `STOP: never judge your own diff inline; dispatch the fresh reviewer` (octagon node) | kept | Non-goals (author-bias HARD-GATE) |
| `Dispatch the fresh reviewer on your own diff` (box node + section) | kept | self-review 3; Non-goals |
| `Open the self-review off-script gate: a fill asks for a move this graph forbids` (box node + section) | kept, asked in the include's off-script shape (scope `off-script:self-review:<n>`, `action` and `next`); section: the selection-schema paragraph goes; the include defines the shape | self-review 3; Off-script gates |
| `Self-review off-script answer?` (diamond node) | kept (take, iterate, hold to `run_hold`, hand back) | Off-script gates |
| `Make the recorded self-review move once` (box node + section) | kept | Off-script gates |
| `Assemble the self-review draft` (box node + section) | kept | self-review 3 |
| `Gate self-review: fix and next, after the draft` (box node + section) | kept, asked as `gate_ask {..., kind: self-review, runDb, stage}` through the protocol, which records the answers map `{fix, next}` (a write-in as `{writeIn}`); option values stay `blocking`, `all`, `none`; section: the bracket and the hand `run_decision` selection go; the four-option rule, the blocking/minors meaning and the write-in resume rule (read `fix` from the answers map) stay | self-review 4; B16 |
| `Gate self-review again: quote the failing output` (box node + section) | kept, at its own scope `self-review-retry:<finding id>`, option values `retry:<finding id>` and `leave:<finding id>`, plus `next`; section: the selection schema and "Try again resets that finding's attempt count to 0" go (round 2's key); one reopened gate per finding stays | self-review 5; B17 |
| `Self-review next answer?` (diamond node) | kept; hold goes to `run_hold`, abandon to the close | self-review 4; B2 |
| `Self-review fix answer?` (diamond node) | kept | self-review 4 |
| `Next selected finding to fix?` (diamond node + section) | kept | Non-goals (fixes test-first) |
| `Is the finding testable?` (diamond node + section) | kept | Non-goals |
| `Write a failing test for the finding` (box node + section) | kept | Non-goals |
| `Does the new test fail on the current code?` (diamond node) | kept | Non-goals |
| `Record the finding as not reproduced; no fix` (box node + section) | kept | Non-goals |
| `Fix the finding and run the tests` (box node + section) | kept; its counter sentence moves to `run_budget`; section: the scratch patch rule stays (its directory is in the session scratchpad); "the counter is attempts on this finding within this pass" becomes the `run_budget` key | self-review 6 |
| `Tests green after the fix?` (diamond node) | kept | Non-goals |
| `Fix attempts on this finding = 3?` (diamond node) | kept; reads `run_budget {runDb, key: fix:<finding id>:<round>, limit: 3, stage}`, `<round>` 1, then 2 after the reopened gate | self-review 6; B4 |
| `Reopened gates on this finding = 1?` (diamond node) | kept; reads `run_budget {runDb, key: reopen:<finding id>, limit: 1, stage}` | self-review 6; B4 |
| `Self-review stuck finding answer?` (diamond node) | kept; `retry:<id>` moves the count to round 2's key (the old "count resets" label), `leave:<id>` leaves it open, hold to `run_hold`, abandon to the close | self-review 5, 6; B17 |
| `Record the finding as left open` (box node + section) | kept | Non-goals |
| `Hand back with the Minor findings listed` (box node + section) | kept | self-review 7 |
| `Own self-review run: close it?` (diamond node) | kept; yes goes to `run_close` | self-review 7 |
| `run_stage {action: done, stage: self-review}` (plaintext node) | replaced by: `run_close {runDb, workType: self-review, stage: self-review, outcome: done}` | Shared: the run; B3 |
| `run_status {status: done} for self-review` (plaintext node) | replaced by: the same `run_close` call | Shared: the run; B3 |
| `Own self-review run: close it as abandoned?` (diamond node) | kept | Shared: the run |
| `run_stage {action: fail, stage: self-review, reason: <their words>}` (plaintext node) | replaced by: `run_close {runDb, workType: self-review, stage: self-review, outcome: abandoned, reason}` | Shared: the run; B3 |
| `run_status {status: abandoned} for self-review` (plaintext node) | replaced by: the same `run_close` call | Shared: the run; B3 |
| `run_stage {action: fail, stage: <run.current_stage>, reason: <their words>} for self-review` (plaintext node) | kept: an inherited run closes nothing, and a hand back fails the stage | Shared: the run (Close) |
| `run_decision {contract: gate@1, scope: hold:<stage>:<attempt>, selection: {reason}, decidedBy} for self-review` (plaintext node) | replaced by: `run_hold {runDb, stage, reason, decidedBy} for self-review` (it computes the attempt) | Shared: the run; B2 |
| `run_field_set {key: hold, value: <their words>, stage: <self-review stage>}` (plaintext node) | gone: `run_hold` writes the hold | Shared: the run; B2 |
| `Self-review held: end the turn` (doublecircle node) | kept | Shared: the run |
| `Self-review abandoned` (doublecircle node) | kept | Shared: the run |
| `Self-review done: the calling flow continues` (doublecircle node) | kept | self-review 7 |

Other sections and rules:

| current text | fate | spec ref |
|---|---|---|
| ## Run: an inherited run (handed `runDb`, `run_snapshot` running) uses `run.current_stage` | replaced by: `run_enter {runDb}` `inherited` mode, stage `at.stage` | Shared: the run; B1 |
| ## Run: `run_list` filter and `run_start` arguments paragraph | replaced by: `run_enter {flags, skillDir, stage, runDb?, resume?, spawnedBy?}` | Shared: the run; B1 |
| ## Run: `{{run-start.flags:self-review}}` block | kept (`run_enter` takes `flags` verbatim) | Shared: the run |
| ## Run: "Keep `runDb` and pass it to every `run_*` call" | kept | Shared: the run |
| ## Run: "Every gate in this verb writes its `gate` field with `stage` and its decision" | tool: `gate_ask {runDb, stage}` writes the run fields and records the answers map | self-review 4; B16 |
| ## Run: the author-bias paragraph and the HARD-GATE | kept | Non-goals |
| `{{include:run-identity}}` | kept | Constraints |
| What the graph cannot show: ship-time gates are complemented, never checked | kept | Kept |
| What the graph cannot show: a hold records `run_decision` hold plus `run_field_set hold` | replaced by: `run_hold` | Shared: the run; B2 |
| What the graph cannot show: the close runs only after the selected fixes are verified | kept | self-review 7 |
| What the graph cannot show: the final message lists every selected finding as fixed, not reproduced or left open | kept | self-review 7 |
| ## The review flow, Criteria, Reviewer, Gate protocol, Wrap-up form contract includes and slots | kept (gate-protocol from the pipeline-skills rewrite) | Non-goals; Constraints |
| The "If a rule below asks for a move this graph marks STOP" lines | kept | process-digraphs rule 6 |
| Red flags: all five rows (author bias) | kept | Non-goals |

## Open rows

The spec does not settle these; each is flagged for the task that edits the
skill, not ruled here.

1. **A handed plan that names a resolved thread** (receive-review, `Keep
   only unresolved human threads` section). Today the read keeps every
   thread a handed `{plan}` names, resolved or not. `mr_threads {filter:
   "unresolved-human"}` drops resolved threads, and the spec names no read
   for them, so a `fix:` row on a thread resolved since the plan would have
   no note chain to implement from. Task 4 decides (an unfiltered read for
   handed-plan threads, or the row held and reported).
2. **The code-changes hide rule** (receive-review, `Gate respond-plan
   through gate-protocol` section): submit `code-changes: skip` unasked
   when no thread answered `fix:`. The spec drops the prose form recipe but
   does not name this rule; this inventory keeps it as site behavior.
3. **No guard STOP against hand replies on GitLab** (receive-review, the
   two refused-reply and refused-resolve STOPs). The spec draws one guard
   STOP, on `tempted to push from the shell or force`. Scenario R4 tempts
   `mr_reply_thread` or the GitLab CLI after a held reply; Task 5 may add a
   guard STOP on that edge out of `respond_post_execute result?` (builder's
   latitude under "Left to the builder").
