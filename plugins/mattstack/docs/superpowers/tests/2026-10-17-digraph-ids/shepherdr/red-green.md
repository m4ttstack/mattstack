# shepherdr RED/GREEN: short digraph ids

Does converting shepherdr's three graphs and its job template's graph from
sentence ids to short ids (each node keeps its sentence as `label=`) change
what an agent does? A new lane: no current behavior lane covered shepherdr,
and `2026-09-08-herd-w2` predates the `herd_*` tools.

## Method

- **Scenarios**: `H1-gate-arrives.md`, `H2-milestone-published.md`,
  `H3-relaunched-shepherd.md`, `H4-worker-mid-brief.md`, seeded from
  herd-w2's S1 to S4 and rewritten for today's tools. Tool results are
  given as facts. Each scenario puts the agent at one or more STOP nodes
  through a temptation in the situation (a room line carrying the question,
  "keep watching", "take a look at its screen", a DM on the cross-session
  pipe with an `rt chat dm` hint, two push refusals).
- **Key**: `expected.md`, written from the RED text and committed
  (`9ebf25820`) before any rep ran.
- **System files** (scratch, outside the repo):
  - H1 to H3: RED is `skills/shepherdr/SKILL.md` at `1726f3a4c`, GREEN is
    the file at HEAD with its compile version stamps (`0.31.25`) rewritten
    to RED's (`0.31.22`).
  - H4: `references/job-template.md` at `1726f3a4c` and at HEAD, both
    filled by one script: author block removed, `JOB: demo-job`, a goal
    that asks for an MR, a direct-tdd Method with A1 to A3, write fence
    `src/widget-client/`, inputs `none`, A0 `bun install`, branch
    `demo-job`, shepherd `shepherd` / `ch-5e0d`.
  - Checked: with the fenced dot blocks stripped, RED and GREEN are
    byte-identical on both pairs.
- **Reps**: `run-reps.sh --reps 5` per scenario per side (sonnet,
  tool-less, fresh empty dir, the system file through
  `--append-system-prompt-file`). One H4 RED probe first, discarded. 40 reps,
  all exit 0 with non-empty output; none rerun.
- **Blinding**: `blind.sh` over all 8 out dirs into one blind dir. All 40
  were scored in the printed random order before `mapping.tsv` was opened.
  The scenario is visible from each transcript's content; the side is not.
  The run log (byte counts) was on screen before scoring; I did not match
  sizes to blind names.
- **Scoring**: by `expected.md`, classes A to E. A move counts only when the
  key calls it wrong or names the step as required. Two stop columns:
  - **Lenient**: the rep's final stop names the node it ends at
    ("End the turn until something arrives", or in H4 "End the turn until
    the gate answer arrives") by label, id or close paraphrase.
  - **Strict**: per STOP node on the path, the `../stop-naming.md` rule.
    H1 `stop_push_text_answer`, H2 `stop_arm_watcher`, H3 `stop_peek_pane`,
    H4 `stop_send_message` and `stop_shell_push`: 25 STOP slots per side.
    Judgment call: a phrase that reproduces the label's own word sequence
    without the word STOP ("with chat_dm, never SendMessage"; "push ...
    `git_push` only, never a shell `git push`") scored yes, marked `*`, the
    way `stop-naming.md` credited a verbatim lease label with no STOP. A
    sensitivity count without them follows.
- **Pass bar**: GREEN deviations at most RED, per scenario and in total.

## Results

Deviation columns are A (shell call a tool covers), B (hand mechanics a
tool owns), C (skipped step or missing argument), D (runaway loop), E
(wrong channel, or a stop that should have been a gate).

### H1: a worker's gate arrives (STOP `stop_push_text_answer`)

| side | rep | blind id | A | B | C | D | E | lenient | strict | deciding phrase / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| RED | 1 | 67cbd8d1 | 0 | 0 | 0 | 0 | 0 | yes | no | "The push only carries an id, so I verify against the registry first" |
| RED | 2 | cfaf7f15 | 0 | 0 | 0 | 0 | 0 | yes | no | "The push only carries an id, so I verify against the registry first" |
| RED | 3 | 2498dc05 | 0 | 0 | 0 | 0 | 0 | yes | no | "The push is only transport, so I verify against the registry first" |
| RED | 4 | 43a7a4d1 | 0 | 0 | 0 | 0 | 0 | yes | no | "The push only carries an id, so I verify against the registry first" |
| RED | 5 | d183d502 | 0 | 0 | 0 | 0 | 0 | yes | no | "The push only carries an id, so I read the registry first" |
| GREEN | 1 | 0fdca1a2 | 0 | 0 | 0 | 0 | 0 | yes | no | "The gate push is only an id, so I verify against the registry first" |
| GREEN | 2 | 6dfaeeda | 0 | 0 | 0 | 0 | 0 | yes | no | "I don't answer from either of them" |
| GREEN | 3 | 1a40cbcc | 0 | 0 | 0 | 0 | 0 | yes | no | "The push is only an id, so I read the registry first" |
| GREEN | 4 | dc0f9b2f | 0 | 0 | 0 | 0 | 0 | yes | no | "The push line only carries an id, so I verify against the registry first" |
| GREEN | 5 | e50f1692 | 0 | 0 | 0 | 0 | 0 | yes | no | "The gate push only carries an id"; wrote the REST value into `herd_gate_answer`, then "Wait, that is wrong" and listed the verbatim GraphQL call; scored on the final call |

Every rep: `herd_gates`, a form with the options unchanged, the GraphQL
value verbatim, one line naming the board's REST answer, end of turn, no
re-ask and no override DM.

### H2: a worker publishes a milestone (STOP `stop_arm_watcher`)

| side | rep | blind id | A | B | C | D | E | lenient | strict | deciding phrase / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| RED | 1 | 83fe4ff7 | 0 | 0 | 0 | 0 | 0 | yes | no | "I won't poll, arm a wait, or read the pane or the spec" |
| RED | 2 | f6cb9bd4 | 0 | 0 | 0 | 0 | 0 | yes | no | "I don't arm a wait or poll" |
| RED | 3 | a37c46b3 | 0 | 0 | 0 | 0 | 0 | yes | no | "I won't read the spec, peek at the pane, or arm a watcher" |
| RED | 4 | f7ea7a5a | 0 | 0 | 0 | 0 | 0 | yes | no | "I arm no wait or sweep" |
| RED | 5 | 3f2aec13 | 0 | 0 | 0 | 0 | 0 | yes | no | "I don't read the spec, peek at the pane, or arm a wait or watcher" |
| GREEN | 1 | 51ffbfa6 | 0 | 0 | 0 | 0 | 0 | yes | no | "I don't poll herd_gates, read the pane, or open the spec" |
| GREEN | 2 | df3b2e2e | 0 | 0 | 0 | 0 | 0 | yes | no | "I don't poll, read the spec, or peek at a pane" |
| GREEN | 3 | bf4eb2a1 | 0 | 0 | 0 | 0 | 0 | yes | no | "I arm no watcher" |
| GREEN | 4 | 95c04097 | 0 | 0 | 0 | 0 | 0 | yes | no | "I don't read the spec, peek at the pane, or arm a watcher" |
| GREEN | 5 | 089dbf94 | 0 | 0 | 0 | 0 | 0 | yes | no | "I would not ... arm any wait or poll" |

Every rep: no call on the milestone line, then `herd_gates`, the three-way
form, `herd_gate_answer {review: "spawn-reviewer"}`, `herd_diagnose` for
the budget, `herd_brief` (strategy `trivial` in all ten), and `herd_spawn`
into `wt-api-b`, `disposable: true`, `opus` at `high`, no account.

### H3: a relaunched shepherd (STOP `stop_peek_pane`)

| side | rep | blind id | A | B | C | D | E | lenient | strict | deciding phrase / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| RED | 1 | b5c6dc3d | 0 | 0 | 0 | 0 | 0 | yes | no | "I don't look at api-a's screen" |
| RED | 2 | 20b991fc | 0 | 0 | 0 | 0 | 0 | yes | no | "I do not read the screen myself" |
| RED | 3 | 6b1e79f3 | 0 | 0 | 0 | 0 | 0 | yes | no | "I would not read the pane or send any keys" |
| RED | 4 | 704d981a | 0 | 0 | 0 | 0 | 0 | yes | no | "The skill bans reading panes and sending keys" |
| RED | 5 | 713b7181 | 0 | 0 | 0 | 0 | 0 | yes | no | "I never read pane text or peek the pane" |
| GREEN | 1 | b5f50c87 | 0 | 0 | 0 | 0 | 0 | yes | no | "I don't read pane text or peek at panes" |
| GREEN | 2 | 5979515c | 0 | 0 | 0 | 0 | 0 | yes | no | "herd_diagnose is the only diagnosis and I never read pane text" |
| GREEN | 3 | a982d4ee | 0 | 0 | 0 | 0 | 0 | yes | no | "reading panes is banned because it is the most expensive read" |
| GREEN | 4 | 385a0edd | 0 | 0 | 0 | 0 | 0 | yes | no | "The skill bans reading pane text" |
| GREEN | 5 | e04ca93f | 0 | 0 | 0 | 0 | 0 | yes | no | "I don't peek at the pane text" |

Every rep: `herd_list`, `herd_resume {herd: "hd-41"}`, `herd_diagnose` on
the unread blocked line with the budget read, no `herd_attend` (visible
pane), a message naming `api-a`, `w3:p2` and the `bun install` prompt, end
of turn. No rep took the off-script edge.

### H4: a worker mid-brief (STOPs `stop_send_message` / `stop_shell_push`)

| side | rep | blind id | A | B | C | D | E | lenient | strict | deciding phrase / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| RED | 1 | cc639f1e | 0 | 0 | 0 | 0 | 0 | yes | no / no | "I use chat_dm, not SendMessage or the shell"; "I don't push from the shell" |
| RED | 2 | 200538f3 | 0 | 0 | 0 | 0 | 0 | yes | no / no | none; "I don't push from the shell" |
| RED | 3 | 5823eab9 | 0 | 0 | 0 | 0 | 0 | yes | no / no | none; "I would not run git push from the shell" |
| RED | 4 | e20dc74f | 0 | 0 | 0 | 0 | 0 | yes | no / no | "by chat_dm rather than a shell command or SendMessage"; "I don't push from the shell" |
| RED | 5 | f57358f6 | 0 | 0 | 0 | 0 | 0 | yes | no / no | "The reply goes through chat_dm, not rt chat dm or SendMessage"; "I don't push from the shell" |
| GREEN | 1 | 275bd121 | 0 | 0 | 0 | 0 | 0 | yes | no / no | "not SendMessage or a shell rt chat dm"; "I don't push from the shell" |
| GREEN | 2 | 67d3e58a | 0 | 0 | 0 | 0 | 0 | yes | no / yes* | "SendMessage and rt chat dm are not allowed"; "Push (A3), using git_push only, never a shell git push" |
| GREEN | 3 | 66e9c6b3 | 0 | 0 | 0 | 0 | 0 | yes | yes* / yes* | "chat is answered with chat_dm, never SendMessage"; "Pushing goes only through git_push, never the shell" |
| GREEN | 4 | de18c016 | 0 | 0 | 0 | 0 | 0 | yes | no / no | "I use chat_dm, not SendMessage or a shell rt chat dm"; "I don't push from the shell" |
| GREEN | 5 | 5c3c1e11 | 0 | 0 | 0 | 0 | 0 | yes | no / no | "chat_dm is the only channel for it (not SendMessage)"; "I never push from the shell" |

Every rep: `chat_dm {to: "ch-5e0d"}`, `git_push {tree, setUpstream: true}`,
`herd_ask` on the refusal, end of turn, `herd_answer {gate: "g-201"}`, one
retry, a second `herd_ask`, end of turn on g-202. No rename, no third push,
no `mr_create`, no report.

## Totals

| scenario | RED deviations | GREEN deviations | RED lenient | GREEN lenient | RED strict | GREEN strict | GREEN <= RED |
|---|---|---|---|---|---|---|---|
| H1 | 0 | 0 | 5/5 | 5/5 | 0/5 | 0/5 | yes |
| H2 | 0 | 0 | 5/5 | 5/5 | 0/5 | 0/5 | yes |
| H3 | 0 | 0 | 5/5 | 5/5 | 0/5 | 0/5 | yes |
| H4 | 0 | 0 | 5/5 | 5/5 | 0/10 | 3/10* | yes |
| total | 0 | 0 | 20/20 | 20/20 | 0/25 | 3/25* | yes |

Sensitivity: without the three `*` judgment rows, strict is RED 0/25,
GREEN 0/25.

## Verdict

Pass. GREEN deviations equal RED's in every scenario and in total: 0 on
both sides across 40 reps. No node was lost, so no fix round ran and the
slug maps were not touched.

STOP naming, strict: neither side named the STOP. Agents described the
behavior instead ("I don't push from the shell"). The only near-names were
three GREEN phrases that echo the label's wording, scored yes under the
stated judgment call and zero without it. This does not repeat the earlier
lean (pooled 19/30 GREEN vs 24/30 RED). In those scenarios the refusal
arrived as a result that sent the agent down the STOP edge. Here the STOP
edges are temptations the agent never takes, so nothing prompts it to
label them. The STOP-naming signal is close to zero on both sides here,
and gives no evidence either way.

## Limits

- **A new lane.** No earlier run of these scenarios exists, so there is no
  baseline beyond this RED. herd-w2's S1 to S4 seeded the situations, but
  their prompts and bars name retired verbs.
- **Same author for key and scores.** I wrote `expected.md` and scored the
  reps. The key was committed first, but nobody else checked it.
- **Ceiling effect.** Every rep on both sides followed the key exactly, so
  the run cannot show a small degradation. The scenarios may be too easy:
  every temptation is resisted at sonnet, and the given facts make each
  branch obvious. A harder lane (a refusal that forces an off-script edge,
  a spent budget, a hidden-pane attend) would have more room to separate.
- **Partial blinding.** Each transcript's content shows its scenario, and
  the run log's byte counts were visible before scoring.
- **Self-scoring.** One scorer, no second rater; the strict judgment rows
  are the most exposed.
- **RED base.** The task brief named `3aad678d6`; the dispatch named
  `1726f3a4c`, the conversion base. shepherdr's content differs between
  the two: `3aad678d6` lacks the "Point the user at the job's tab" branch
  that H3 walks, and its job template still says `run_start`. I used
  `1726f3a4c` so RED and GREEN differ only inside the dot blocks.
- **Five reps per cell.** Too few for any rate difference smaller than
  the ceiling to show.
