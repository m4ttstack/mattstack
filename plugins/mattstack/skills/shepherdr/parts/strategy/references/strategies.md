# Strategy bodies

One fixed body per strategy. The dispatcher copies the body for the
assigned strategy verbatim into the brief's method section and fills every
`<angle-bracket>` slot; it does not compose method prose per job. Slots:
`<question-file>` and `<report-file>` are the dispatcher's contract-file
paths; `<write-paths>` is the brief's write fence; `<spec or plan>`
(resume only) names which artifact kind is supplied; `<task-list>` is the
job's item-coded tasks (trivial and direct-tdd only); `<verification>`
is the job's must-pass commands.

## trivial

```
Method: trivial. Make the change directly; no test is required because
this change has no runtime behavior (pure docs, comments, config, or a
mechanical rename with zero logic change). If you find yourself writing
or changing logic, stop and write <question-file> saying the strategy no
longer fits.
Tasks (item-coded):
<task-list>
Verification (must pass before the job is done):
<verification>
Report: when the job is complete, write <report-file> in this format,
then stop:
    # REPORT
    status: done | done-with-issues
    ## Items
    - A1: done -- <one line>
    - A2: skipped -- <one-line reason>
    ## Verification
    - <command>: <result>
    ## Notes
    <anything the user must know, max 5 lines>
```

## direct-tdd

```
Method: direct-tdd. Use superpowers:test-driven-development inline for
every task item: name the failing test first, watch it fail, make it
pass, refactor. Test-first applies to every line of production code.
Tasks (item-coded):
<task-list>
Verification (must pass before the job is done):
<verification>
Report: when the job is complete, write <report-file> in this format,
then stop:
    # REPORT
    status: done | done-with-issues
    ## Items
    - A1: done -- <one line>
    - A2: skipped -- <one-line reason>
    ## Verification
    - <command>: <result>
    ## Notes
    <anything the user must know, max 5 lines>
```

## resume

```
Method: resume. A completed <spec or plan> is supplied under
## Inputs (read-only); read it in place, never modify it. Enter the
superpowers chain at that level: spec in hand -> superpowers:writing-plans,
then superpowers:subagent-driven-development; plan in hand ->
superpowers:subagent-driven-development directly.
Wherever a superpowers skill says to ask your human partner, write
<question-file> in the brief's question format and stop; the answer
arrives as your next message.
When the final whole-branch review is clean, write <report-file> and
stop. Integration is the dispatcher's decision.
You may write only under <write-paths> and `.superpowers/sdd/` in this
worktree (superpowers owns that ledger path; relocating it breaks
compaction recovery).
Verification (must pass before the work is done):
<verification>
Report: write milestone lines in <report-file> as they land (`plan:
<path>`) and stop for review at each. At completion write <report-file>
in this format, then stop:
    # REPORT
    status: done | done-with-issues
    ## Milestones
    - plan: <path>
    ## Commits
    <range>
    ## Verification
    - final whole-branch review: <verdict>
    - <command>: <result>
    ## Notes
    <max 5 lines>
```

## superpowers

```
Method: superpowers. Run the full chain: superpowers:brainstorming ->
spec -> superpowers:writing-plans ->
superpowers:subagent-driven-development.
Wherever a superpowers skill says to ask your human partner --
brainstorming questions, the pre-flight conflict scan, a finding that
conflicts with plan text, a BLOCKED fix loop -- write <question-file> in
the brief's question format and stop; the answer arrives as your next
message.
When the final whole-branch review is clean, write <report-file> and
stop. Integration is the dispatcher's decision.
You may write only under <write-paths> and `.superpowers/sdd/` in this
worktree (superpowers owns that ledger path; relocating it breaks
compaction recovery). Paths under ## Inputs (read-only) are read in
place, never modified.
Verification (must pass before the work is done):
<verification>
Report: write milestone lines in <report-file> as they land (`plan:
<path>`) and stop for review at each. At completion write <report-file>
in this format, then stop:
    # REPORT
    status: done | done-with-issues
    ## Milestones
    - spec: <path>
    - plan: <path>
    ## Commits
    <range>
    ## Verification
    - final whole-branch review: <verdict>
    - <command>: <result>
    ## Notes
    <max 5 lines>
```

## delegate

```
Method: delegate. Triage this job against the strategy table in
<strategy-skill-file> and pick one of: trivial, direct-tdd,
resume, superpowers -- never delegate itself. Respect your surface: an
Agent-tool subagent cannot run `superpowers` (brainstorming needs a
human in the loop). Then run the strategy you picked, under all of that strategy's rules in <strategies-file>.
Whichever you pick: wherever a superpowers skill says to ask your human
partner, write <question-file> and stop; when the work is complete,
write <report-file> and stop. Integration is the dispatcher's decision.
Verification (must pass before the work is done):
<verification>
Report: name the strategy you chose on the first line, then follow that
strategy's report contract.
```
