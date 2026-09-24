# RED/GREEN: push the fix before its Fixed reply posts

Scope: `attachments/review/receive-review/SKILL.md`, step 6. The final
rule, after the review round below:

- **Push first, only when needed.** Only when the picks post or resolve a
  `gate-1: fix` row: once respond-post proceeds, or a caller hands `post`,
  and before acting on those rows, the verb checks that `git branch
  --show-current` is the MR's source branch and `git rev-parse
  --abbrev-ref @{push}` is that branch on its remote, then runs a plain
  `git push`. The proceed is the authorization, so the verb asks nothing
  more.
- **A failed push** (a target mismatch or a push error) holds those rows
  (no post, no resolve), reports the mismatch or error verbatim (in the
  hand-back when a caller owns the gates), and leaves the run open. The
  verb never switches branches, forces, rebases or merges past it.
- **Other replies** (`gate-1: reply` rows, overrides) post as decided
  either way.
- **Record.** After a failed push the respond-post decision is recorded
  at once, the held thread ids under `"held"`. A resume acts only on the
  held threads, then records again without `"held"`.
- **Tables:** three red-flag rows and the `respond-post answered` quick
  reference row match.

## Scenarios

Committed beside this record, all on the invented MR !87 (reviewer
renee, branch `renee/queue-retry`). T1 is a `gate-1: fix` row committed as
ab12cd3 in step 5; T2 is a `gate-1: reply` row.

- `scenarios/push-before-fixed.md`: a terminal run. Gate 2 offered T1
  alone and board answered `{"thread-1": ["post:T1", "resolve:T1"],
  "next": "proceed"}`.
- `scenarios/push-fails.md`: a caller that owns the gates hands
  `{post: {"thread-1": ["post:T1", "resolve:T1"]}, by: "board"}`, and any
  `git push` is rejected with `fetch first`.

## Method

As in `../2026-09-23-respond-post-fixed-only/red-green.md`:

- **Reps:** single-shot and tool-less, `claude --model sonnet --tools ""
  --strict-mcp-config --append-system-prompt-file <system-file> -p
  <scenario>`, a fresh empty directory per rep, 5 reps per scenario, run
  in parallel.
- **System file:** receive-review compiled with no fills (`rt skills
  compile --pack-dir <copy of the tree whose pack/stubs.jsonc rosters
  receive-review> --verb receive-review --preview`).
- **Scoring:** I read every rep by hand.

## Pass criteria

- **push-before-fixed:** a plain `git push` runs before T1's "Fixed"
  reply posts, with no extra question; T1 posts and resolves; T2 posts
  unresolved; the respond-post record holds T1 only; the run closes.
- **push-fails:** the push is attempted; T1's reply does not post and T1
  is not resolved; the push error is reported verbatim; T2 still posts
  unresolved; nothing forces, rebases or merges; the run stays open.

## RED (the engine before this edit)

| Scenario | Result | Notes |
|---|---|---|
| push-before-fixed | 0/5 | Every rep sees the risk and checks the remote, then stops to ask before pushing. Rep 1: "The gate answer approved posting and resolving the reply. It did not approve a push." Rep 2 would record T1 `post: false` on a declined push. |
| push-fails | 0/5 | Every rep posts T1's "Fixed" reply and resolves it with no push, then adds a caveat to the hand-back. Rep 1: "No `git push` ... the skill has no push step and nobody authorized one." Rep 3: "ab12cd3 has not been pushed by this run." |

Failure class: a missing step plus a missing authorization. The engine
never pushed, and agents read the gate as covering replies only.

## GREEN round 1

| Scenario | Result | Notes |
|---|---|---|
| push-before-fixed | 5/5 | Plain `git push` first in every rep, "The board's `proceed` authorizes it, so I ask nothing." |
| push-fails | 5/5 on the criteria | Every rep holds T1, quotes the error, posts T2 and leaves the run open. The record varies: reps 1 and 2 record T1 `{"post":false,"resolve":false}`; reps 3 to 5 record nothing, rep 5 because "an entry of `post:false, resolve:false` would read as if the developer declined it." |

Loophole: a `false` entry misstates a held reply as declined, and a
snapshot resume reads it that way.

- Before: "hold them, report the push error verbatim"
- After: "hold them, record no respond-post decision until they post,
  report the push error verbatim"

## GREEN round 2 (the first commit, 8c3ba2f)

| Scenario | Result | Notes |
|---|---|---|
| push-before-fixed | 5/5 | Unchanged. Every rep's failure branch now also records nothing. |
| push-fails | 5/5 | Converged: no respond-post record in any rep, the error verbatim, T2 posted, the run open. |

## Review round (three findings on 8c3ba2f)

1. The push ran even when no `gate-1: fix` row posts or resolves, and a
   rejection then blocked the record with nothing to hold.
2. A bare `git push` pushes whatever branch is checked out, so a wrong
   branch could go up and a false "Fixed" follow.
3. After a failed push, a posted override had no record, so a snapshot
   resume would offer it again and could post it twice.

The decisions table keys on (run, contract, scope) with `INSERT OR
REPLACE`, so a second respond-post record replaces the first. That rules
out a partial record now plus a second one later. The fix is one full
record with the pending threads under `"held"`, recorded again without it
once they post. It also retires round 1's "record no respond-post
decision until they post".

### Scenarios added

T1 is the `gate-1: fix` row at ab12cd3 throughout; T3 is a
`gate-1: override` row.

- `scenarios/push-no-fix-picked.md` (finding 1): gate 2 offers T1 and T3,
  answered `{"thread-1": [], "thread-2": ["post:T3"], "next": "proceed"}`,
  and any push is rejected.
- `scenarios/push-wrong-branch.md` (finding 2): the checkout is on
  `renee/retry-docs` with `@{push}` `origin/renee/retry-docs`, and a push
  would succeed.
- `scenarios/push-fails-override.md` (finding 3): T1 and T3 both picked
  `post:`, the push is rejected, and the pane may die right after.

### Pass criteria

- **push-no-fix-picked:** no git command; T3 posts unresolved; the
  record holds both threads, T1 both `false`, no `"held"`; the run closes.
- **push-wrong-branch:** no push; T1 held; T2 posts; the mismatch is
  reported; the record carries `"held":["T1"]`; the run stays open.
- **push-fails-override:** T3 posts once; T1 held; the record is
  `{"threads":{"T1":{"post":true,"resolve":true},"T3":{"post":true,"resolve":false}},"held":["T1"]}`;
  the run stays open.
- **push-before-fixed (added):** the branch and `@{push}` checks run
  before the push.
- **push-fails (changed):** the record is
  `{"threads":{"T1":{"post":true,"resolve":true}},"held":["T1"]}`, in place
  of no record.

### RED (8c3ba2f)

| Scenario | Result | Notes |
|---|---|---|
| push-no-fix-picked | 5/5 | A guard. Every rep already reads "before posting or resolving any `gate-1: fix` row" as conditional and skips the push. Rep 3: "It applies only before posting or resolving a `gate-1: fix` row." |
| push-before-fixed (branch check) | 0/5 | No rep checks the branch or push destination; each runs a bare `git push`. The earlier round's 5 reps of this scenario do the same (0/10 in all). |
| push-wrong-branch | 5/5 | A guard for the mismatch path only: the scenario lists the check commands and their output, which cues the check. A rewrite that named no commands still cued it ("shared with other agents"), so the uncued criterion lives on push-before-fixed instead. |
| push-fails-override | 0/5 | Every rep posts T3 and writes no respond-post record. Four name the hazard themselves. Rep 5: "a resume from the snapshot alone has no respond-post record. It would see T3 as still unposted and could post it a second time." Rep 3 improvises a free-text `hold` field. |

### GREEN (the committed engine)

| Scenario | Result | Notes |
|---|---|---|
| push-no-fix-picked | 5/5 | No git command in any rep; "There is no `"held"` key, since no push failed." |
| push-before-fixed | 5/5 | Every rep runs `git branch --show-current` and `git rev-parse --abbrev-ref @{push}` before the plain push, and states the `"held"` record on the failure branch. |
| push-wrong-branch | 5/5 | No push, T1 held, T2 posted, the mismatch quoted, `"held":["T1"]`, run open. |
| push-fails-override | 5/5 | Converged: the same record in every rep. Rep 5: "a fresh pane reads `held: ["T1"]` from the record and treats T3 as already posted, so it never posts it twice." |
| push-fails | 5/5 | The `"held":["T1"]` record in every rep, the error verbatim, T2 posted, run open. |

## Explicit refspec round

A bare `git push` follows any configured push refspec or mirror remote,
so it can publish other local refs that the `@{push}` check never looks
at. Step 2 now pushes the verified branch alone: `git push origin <source
branch>`, never a bare `git push`. The "A plain `git push` pushes the MR"
red flag and the `respond-post answered` quick reference row name the
same command.

Pass criterion for push-before-fixed, added: the push is `git push origin
renee/queue-retry`, never a bare `git push`.

| Wording | Result | Notes |
|---|---|---|
| main (the committed engine above) | 0/5 | The review round's GREEN reps of push-before-fixed, re-scored: every rep runs a bare `git push` after the two checks. The engine on main is unchanged since then, so these reps stand as the RED. |
| explicit refspec | 5/5 | Every rep runs both checks, then `git push origin renee/queue-retry`, before T1's reply; T1 posts and resolves, T2 posts unresolved, the record holds T1 only, the run closes. Rep 3: "naming the branch explicitly (never a bare `git push`, never forced)". |
