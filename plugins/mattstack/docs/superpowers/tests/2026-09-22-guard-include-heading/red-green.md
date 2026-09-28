# RED/GREEN: the spawned-no-run-guard include drops its heading (mattstack 0.17.23)

Scope: `attachments/spawned-no-run-guard/SKILL.md` opened its body with
`# Spawned, no-run guard`. Its four include sites sit mid-section
(checkout's clarify gate; rebase-worktree's Clean-tree precondition,
conflict gate, and push gate), so in compiled output that H1 opened a new
top-level section and the host text after it (`Never a guess.`, `Never git
stash and proceed`, the `rt runs decision record` bullets) read as part of
the guard. The edit removes the heading and its blank line; the body is the
paragraph alone, like `review-core-body-after`. No host edits.

Method: preview compile of a copy of the tree with `pack/stubs.jsonc`
rostering `checkout` and `rebase-worktree` (`rt skills compile --pack-dir
<copy> --verb <verb> --preview`, one verb at a time), then a retrieval
micro-test on the compiled rebase-worktree: 5 single-shot tool-less reps
(`claude -p --model sonnet --tools "" --strict-mcp-config
--append-system-prompt-file <compiled rebase-worktree>`), question:

> The rebase-worktree skill is appended to your system prompt. For each of
> the two rules below, give the chain of markdown headings it sits under in
> that skill, outermost first (for example: # A > ## B > ### C). Rule A: the
> sentence that begins "Never `git stash` and proceed". Rule B: the bullet
> "When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1
> --scope push ...`". Reply with exactly two lines, "A: <chain>" and
> "B: <chain>", and nothing else.

Correct: A is `# rebase-worktree > ## Preconditions`, B is
`# rebase-worktree > ## After a clean rebase`. Any chain that places a rule
under or inside the guard counts as wrong.

Mechanical RED (pre-edit compile): an H1 right after the seam marker at
checkout line 46 and rebase-worktree lines 46, 157, 199, each inside a
`##` host section.

RED (pre-edit compile): 1/5 reps correct on both rules (A 2/5, B 1/5).

- Rep 1: both rules chained under a third level, `Spawned, no-run guard`.
- Rep 2: both placed inside "(spawned-no-run-guard part, no heading)".
- Rep 3: both answered as `# Spawned, no-run guard` alone.
- Rep 4: A correct; B under "(spawned, no-run guard block)".
- Rep 5: both correct.

GREEN (post-edit compile): 5/5 reps correct on both rules, identical
answers every rep. The compile diff against RED is the heading removal at
each seam, the seam markers' `lines=7-15` becoming `lines=7-13`, and the
version stamps.

Full read of both compiled verbs after the edit: every guard seam reads as
one flow with its host section (the gate's run path, then the no-run
paragraph, then the host's next rule or decision-record bullet).
