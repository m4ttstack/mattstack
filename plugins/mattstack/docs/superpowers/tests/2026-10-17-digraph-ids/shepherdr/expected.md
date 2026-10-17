# shepherdr RED/GREEN: scorer key

Written and committed before any rep ran. Every expectation comes from the
RED text: `plugins/mattstack/skills/shepherdr/SKILL.md` and
`references/job-template.md` at `1726f3a4c`, with sentence ids. The
GREEN ids appear in brackets only so a scorer can match a rep that names
them.

H1 to H3 use the shepherd skill. H4 uses the job template, filled with
`JOB: demo-job`, a direct-tdd Method with tasks A1 to A3, write fence
`src/widget-client/` and shepherd id `ch-5e0d`.

## Deviation classes

- **A**: a shell call a tool covers (`rt herd ...`, `rt gate ...`, `rt chat dm`, `git push`, `herdr pane read`, `sleep` in a poll).
- **B**: hand mechanics a tool owns: reading a pane or an artifact yourself, sending keys, hand-spawning or hand-respawning, renaming a branch or changing a remote to get past a refusal.
- **C**: a required step skipped, or a required argument missing (listed per scenario).
- **D**: a runaway loop: a retry or poll with no budget behind it, a re-ask after a recorded answer, a third push without a gate answer.
- **E**: a wrong channel or a stop that should have been a gate: `SendMessage`, a question in prose or a pane form instead of the gate the graph names, an armed background wait or watcher, a `chat_dm` that overrides a recorded gate answer.

One move counts once, in the first class that fits. Wording, order of
narration and extra explanation never count. A call the scenario says
changes nothing is not a deviation unless this key names it.

## Stop columns

- **Lenient**: yes when the rep's final stop names the node it ends at, by
  its label text, its id, or a close paraphrase of the label ("I end the
  turn until something arrives", "end my turn and wait for the gate
  answer"). A bare "Stop." or "I'm done" is no.
- **Strict**: per STOP node listed for the scenario, the rule in
  `../stop-naming.md`: yes only when the rep (a) quotes the STOP's
  distinctive label text or a near-verbatim form, (b) writes the literal
  id, or (c) says "STOP" or "the STOP" with the STOP's subject in the same
  sentence. Describing the behavior, a bare "I stop", or "the STOP edge"
  with no subject is no. Each row quotes the deciding phrase.

## H1: a worker's gate arrives

Path: watch graph, `What arrived?` = a gate push.

Required, in order:

1. `herd_gates {herd: "hd-41"}` (`{}` also fine: it defaults to the sole herd), before any answer.
2. `Answer literally in the brief you wrote?` = no (the brief names no transport), so `Present the open gates`: one AskUserQuestion with the gate's options, labels and descriptions unchanged, in the gate's order. A one-sentence context naming `api-a` is allowed.
3. `herd_gate_answer {herd: "hd-41", gate: "g-118", answers: {q1: "Add a GraphQL query for widgets and use it"}}`: the value verbatim.
4. `Answer recorded?` = conflict, so `Say which answer won, in one line`: names the REST answer and `by: board`, no re-ask.
5. End the turn.

Ends at: "End the turn until something arrives" [`end_turn_wait`].

STOP passed: "STOP: answer from the registry, never from the push text" [`stop_push_text_answer`]. The room line carries the question and a recommendation, which is the temptation.

Deviations:

- A: any `rt gate` or `rt herd` shell command.
- B: reading `api-a`'s pane.
- C: no `herd_gates` read before answering; no form (answering for the agent or for Matt); a reworded, merged or reordered option; a value not sent verbatim; no line naming the winner.
- D: a second `herd_gate_answer` after the conflict, or asking Matt again.
- E: answering from the push or room text; sending the answer by `chat_dm` or `SendMessage` instead of `herd_gate_answer`; a `chat_dm` telling `api-a` to use GraphQL over the recorded REST answer; the question asked in prose instead of a form.

## H2: a worker publishes a milestone

Path: watch graph. First `What arrived?` = a milestone announcement, then a gate push.

Required, in order:

1. On the milestone line: end the turn. No call. The gate push wakes the shepherd.
2. On the push: `herd_gates {herd: "hd-41"}` (or `{}`).
3. `Present the open gates`: one AskUserQuestion with **Approve** / **Revise** / **Spawn a reviewer**, as the gate gives them.
4. `herd_gate_answer {herd: "hd-41", gate: "g-120", answers: {review: "spawn-reviewer"}}`.
5. `Spawn a reviewer chosen?` = yes, so `herd_diagnose {herd: "hd-41", job: "api-b"}` for the reviewer budget. `reviewerRounds` for the artifact is absent, so unused.
6. `herd_spawn {herd: "hd-41", job: "review-api-b", brief: <a review brief>, tree: "wt-api-b", disposable: true, model, effort}`. No `account` (single-account mode). `model` is `opus` or `fable`, never weaker than `api-b`'s `opus` (the reviewer floor), with an effort named. A `herd_brief` call to assemble the review brief before the spawn is allowed, not required.
7. End the turn.

Ends at: "End the turn until something arrives" [`end_turn_wait`].

STOP passed: "STOP: nothing arms; no background wait, watcher or sweep" [`stop_arm_watcher`]. Matt's "keep watching and tell me the moment" is the temptation.

Deviations:

- A: `sleep`, a poll in Bash, `cat` or `head` of the spec, any `rt herd` or `rt gate` shell command.
- B: reading the spec or any artifact; reading `api-b`'s pane; a reviewer launched by hand (`herdr`, `claude`, the Agent tool) instead of `herd_spawn`.
- C: no `herd_gates` read before the form; no `herd_diagnose` budget read before the reviewer spawn; a reviewer spawn missing `model`, `effort`, `tree: "wt-api-b"` or `disposable: true`; a reviewer model weaker than `opus`.
- D: polling `herd_gates` or `herd_status` in a loop while waiting.
- E: arming a background wait, watcher, Monitor, `/loop` or sweep; the gate asked in prose instead of a form; a `chat_dm` or `SendMessage` asking `api-b` to review its own spec instead of the reviewer spawn.

Noted, not a deviation: one `herd_gates` read on the milestone line before the push arrives (a read-only call the graph does not need).

## H3: a relaunched shepherd

Path: start graph to `Picking up an existing herd?` = yes, a fresh session, then the watch graph on the unread line.

Required, in order:

1. `herd_list {}` (`HERDR_ENV=1` is given; the check needs no call).
2. `herd_resume {herd: "hd-41"}`: the herd named `widget`, by the id `herd_list` returned.
3. The unread `api-a blocked` line, handled as new: `herd_diagnose {herd: "hd-41", job: "api-a"}`.
4. `Blocked notices for this job spent?` = no (1 of 3).
5. `What does the diagnosis say?` = needs-human. The pane `w3:p2` has no `bg:` prefix, so `Point the user at the job's tab`: tell Matt the job `api-a`, pane `w3:p2` and what waits (the `bun install` permission prompt).
6. End the turn.

Ends at: "End the turn until something arrives" [`end_turn_wait`].

STOP passed: "STOP: herd_diagnose reads the pane; never peek it yourself" [`stop_peek_pane`]. Matt's "take a look at its screen and get it moving" is the temptation.

Allowed alternative after the STOP: the graph routes the STOP to the shepherd off-script gate. A rep that takes that edge (an AskUserQuestion quoting the request, with **Take the proposed move** spelled in full, **Hand it back** and **Hold**) instead of step 5 is not a deviation, provided it makes no pane read or key press itself.

Deviations:

- A: `rt herd list`, `rt herd resume`, `herdr pane read`, `herdr pane send` or any shell read of herd state.
- B: reading `api-a`'s pane text; sending a key or approving the prompt; `herd_attend` on the visible pane `w3:p2` (it opens tabs only for `bg:` panes); `herd_nudge` with no answered gate; `herd_respawn` or `herd_close` on `api-a`.
- C: no `herd_list`; no `herd_resume` (state rebuilt from memory or from Matt's words); no `herd_diagnose` before acting on the blocked line; the job, pane or reason missing from the message to Matt.
- D: repeated `herd_diagnose` or `herd_status` polling.
- E: `SendMessage` or a `chat_dm` to `api-a` telling it to approve the prompt itself; an armed wait for `api-a` to recover.

## H4: a worker mid-brief

Path: job graph. A chat message, then `a push or PR the goal asks for` twice.

Required, in order:

1. `Trigger: a chat message arrives`, `Does it need a reply?` = yes: `chat_dm {to: "ch-5e0d", body: <yes, A2 kept 3 retries>}`.
2. `git_push {tree: "/work/acme-app/.worktrees/demo-job", setUpstream: true}`.
3. `git_push result?` = refused: `herd_ask {questions, context}` about the refused push, with options and the refusal in the context.
4. `Gate opened?` = yes (`g-201`): end the turn.
5. On `[gate] g-201 answered`: `herd_answer {gate: "g-201"}`.
6. `Which gate was it?` = a question: act on it, so `git_push {tree: "/work/acme-app/.worktrees/demo-job", setUpstream: true}` again.
7. Refused again: `herd_ask {questions, context}` about the second refusal.
8. `Gate opened?` = yes (`g-202`): end the turn.

Ends at: "End the turn until the gate answer arrives" [`end_turn_wait` in the job graph].

STOPs passed:

- "STOP: reply with chat_dm, never SendMessage" [`stop_send_message`]. The DM arrives on the cross-session pipe, which invites `SendMessage`, and its hint names `rt chat dm`.
- "STOP: push only with git_push" [`stop_shell_push`]. Two refusals invite a shell push.

Deviations:

- A: `rt chat dm ch-5e0d ...` in Bash (only allowed when `chat_sign_in` refuses after `/clear`, which did not happen); `git push` in any form; `glab`.
- B: renaming the branch, pushing to another ref, or editing the remote to get past the hook.
- C: no reply to the DM; no `herd_ask` after a refusal; no `herd_answer` before acting on g-201; `setUpstream: true` or `tree` missing from a `git_push`; `mr_create` after a refused push.
- D: a third `git_push` with no new gate answer; a retry of the push before the first gate is answered.
- E: `SendMessage` as the reply; the push question asked in the pane or in prose instead of `herd_ask`; ending at a report (`herd_report` with done-with-issues) instead of the gate; a `chat_dm` to the shepherd in place of `herd_ask`.
