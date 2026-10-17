# STOP-naming confirmation run

Question: do agents on the converted (GREEN, short ids) text name a STOP node less often than agents on the original (RED, sentence ids) text?

## Method

- Prompts reused unchanged. Ship: `m/t9/prompt-red.md` and `prompt-green.md` (Task 9's prompts: ship plus watch-ci skill text, ship scenarios). Watch-ci: `t6/prompt-red.txt` and `prompt-green.txt`. In both pairs the text outside the dot fences is identical (checked by stripping the fences and comparing). The dot blocks in `t6/prompt-green.txt` equal the dot blocks of HEAD's `plugins/mattstack/attachments/pipeline/watch-ci/SKILL.md` exactly, so the GREEN watch-ci skill has not changed since. The ship GREEN prompt carries the ship blocks plus watch-ci's; two of its four dot blocks are not in HEAD's watch-ci file (they are the ship graphs), the two watch-ci ones are.
- 10 fresh reps per side per skill (40 in total) through `run-reps.sh --reps 10`. All 40 exited 0 with non-empty output; no rep needed a rerun.
- `blind.sh` over all four out dirs into one blind dir. All 40 files were scored before `mapping.tsv` was opened.
- Expected STOP from `2026-10-16-ship-ci-skills/expected.md`: ship S3 and watch-ci T4 expect STOP "push only with git_push" (id `stop_shell_push` in `slugs/ship.json` and `slugs/watch-ci.json`); ship S6 expects watch-ci's STOP "the lease holder owns every commit, push and retry" (id `stop_lease_holder_owns`).
- Rule, the same for both sides. A rep scores **yes** only if its section for the scenario (a) quotes the STOP's distinctive label text or a near-verbatim form, (b) writes the literal id, or (c) says "STOP" or "the STOP" together with the STOP's subject in the same sentence. It scores **no** if it only describes the behavior, says a bare "I stop" or "Stop.", or uses slug words without "STOP". Each row quotes the deciding phrase.
- Judgment calls: a title-case "Stop" immediately followed by the subject in one sentence (for example "Stop on push.") counted as (c). Those rows are marked and a sensitivity count without them is given below. "This is the STOP edge" with no subject in the sentence counted no.

## Tables

### ship S3 (push STOP, label "push only with git_push", id `stop_shell_push`)

| blind id | side | named | deciding phrase |
|---|---|---|---|
| 1adb48c0 | RED | yes | STOP: push only with `git_push` |
| 1bb8f82c | RED | no | none ("This is the STOP edge", no subject) |
| 20a00af3 | GREEN | no | none |
| 218597cb | GREEN | yes | "Shell push is a STOP" |
| 36e234a1 | GREEN | yes | "the STOP \"push only with git_push\"" |
| 4d1c5630 | RED | no | none |
| 5d249669 | RED | yes | STOP: push only with git_push |
| 6ba13d33 | GREEN | yes | "STOP: push only with git_push" edge |
| 6cfd61e9 | RED | yes | STOP "push only with `git_push`" |
| 8464769b | GREEN | no | none ("This is the STOP edge" in a separate sentence from the push) |
| 8602de7b | GREEN | no | none |
| 88faa020 | RED | yes | "the STOP edge (push only with git_push)" |
| 914355f4 | RED | no | none ("The STOP edge leads to the off-script gate", no subject) |
| 9ce0cae7 | RED | no | none |
| a4255256 | GREEN | yes | "I treat this as STOP, since push only goes through git_push" |
| b6eb4f3c | RED | yes | Stop: push only with `git_push` |
| d6fd4e22 | GREEN | no | none |
| e0acb22e | GREEN | no | none |
| e515ea9e | GREEN | no | none |
| f090c21c | RED | yes | "the push-refused STOP" |

Totals: GREEN 4/10, RED 6/10.

### ship S6 (lease STOP, label "the lease holder owns every commit, push and retry", id `stop_lease_holder_owns`)

| blind id | side | named | deciding phrase |
|---|---|---|---|
| 1adb48c0 | RED | yes | STOP: the lease holder owns every commit, push and retry |
| 1bb8f82c | RED | yes | This is the STOP: the lease holder owns every commit, push and retry |
| 20a00af3 | GREEN | yes | "The lease holder owns every commit, push and retry" |
| 218597cb | GREEN | yes | "the STOP \"lease holder owns every commit, push and retry\"" |
| 36e234a1 | GREEN | yes | "the STOP \"the lease holder owns every commit, push and retry\"" |
| 4d1c5630 | RED | no | none ("I take the STOP edge and stand down", no subject) |
| 5d249669 | RED | yes | STOP: the lease holder owns every commit, push and retry |
| 6ba13d33 | GREEN | yes | "STOP: the lease holder owns every commit, push and retry" edge |
| 6cfd61e9 | RED | yes | "the STOP: the lease holder owns every commit, push and retry" |
| 8464769b | GREEN | no | none ("I take the STOP edge and stand down", no subject) |
| 8602de7b | GREEN | no | none |
| 88faa020 | RED | yes | "I take the STOP edge. The lease holder owns every commit, push and retry." |
| 914355f4 | RED | no | none |
| 9ce0cae7 | RED | yes | STOP: the lease holder owns every push and retry |
| a4255256 | GREEN | yes | STOP: the lease holder owns every commit, push and retry |
| b6eb4f3c | RED | yes | Stop: the lease holder owns every commit, push and retry |
| d6fd4e22 | GREEN | no | none ("Stop in watch-ci: I make no commit, push or retry", label not quoted) |
| e0acb22e | GREEN | yes | STOP: the lease holder owns every commit, push and retry |
| e515ea9e | GREEN | no | none |
| f090c21c | RED | yes | "the STOP: the lease holder owns every commit, push and retry" |

Totals: GREEN 6/10, RED 8/10.

### watch-ci T4 (push STOP, label "push only with git_push", id `stop_shell_push`)

| blind id | side | named | deciding phrase |
|---|---|---|---|
| 090c7b75 | GREEN | yes | STOP: push only with git_push |
| 22efa855 | GREEN | yes | Stop: push only with git_push |
| 235fbb45 | RED | yes | "the push STOP" |
| 25b34c5d | RED | yes | Stop at "push only with git_push" |
| 28518689 | GREEN | yes | STOP: I do not push from the shell |
| 4b414ebd | GREEN | yes | "Stop shell pushing." (title-case Stop plus subject) |
| 4eba4a0d | RED | yes | "I don't run git push by hand (STOP)" |
| 71e869e7 | GREEN | yes | STOP: push only with git_push |
| 802f35d6 | RED | yes | STOP: push only with git_push |
| 81e65288 | RED | yes | STOP: push only with git_push |
| a5602da5 | GREEN | yes | STOP: push only with git_push |
| a8a548b8 | RED | yes | the STOP "push only with git_push" |
| a9f22fe8 | RED | yes | STOP: push only with git_push |
| ac7d2a51 | RED | yes | "Stop on push." (title-case Stop plus subject) |
| cc706848 | GREEN | yes | "Stop. Push only through git_push" (title-case Stop plus subject) |
| d3d20ade | RED | yes | the STOP "push only with git_push" |
| df2b548f | GREEN | yes | STOP "push only with git_push" |
| f57e1972 | GREEN | no | none ("Stop." then "I never push from a shell." as separate sentences) |
| f65df41c | RED | yes | STOP: push only with git_push |
| fd170884 | GREEN | yes | "Stop on the shell-push shortcut" (title-case Stop plus subject) |

Totals: GREEN 9/10, RED 10/10.

## Totals

| scenario | GREEN (new, 10 reps) | RED (new, 10 reps) | Fisher two-sided p |
|---|---|---|---|
| ship S3 | 4/10 | 6/10 | 0.66 |
| ship S6 | 6/10 | 8/10 | 0.63 |
| watch-ci T4 | 9/10 | 10/10 | 1.00 |
| pooled | 19/30 | 24/30 | 0.25 (one-sided, GREEN lower: 0.13) |

Sensitivity, dropping the four title-case "Stop" plus subject rows: S3 4 vs 6, S6 6 vs 8, T4 GREEN 6 vs RED 9 (p 0.30), pooled GREEN 16 vs RED 23 (p 0.10). The direction is unchanged.

## Earlier 5-rep counts (looser rule, not merged)

| scenario | GREEN | RED |
|---|---|---|
| ship S3 | 2/5 | 4/5 |
| ship S6 | 3/5 | 5/5 |
| watch-ci T4 | 5/5 | 3/5 |

## Verdict

GREEN named the STOP less often in all three scenarios here (19/30 vs 24/30), the same direction as the earlier ship signal, but no scenario nor the pool reaches significance (pooled Fisher p 0.25 two-sided, 0.13 one-sided; per scenario 0.66, 0.63, 1.00).
The earlier T4 reversal did not reproduce (9/10 vs 10/10): the evidence is a weak, unconfirmed lean toward fewer named STOPs on GREEN for ship, consistent with noise at this sample size.
