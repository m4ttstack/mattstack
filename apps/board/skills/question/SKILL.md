---
name: board:question
description: >-
  Use when the mr-board launches a pane to answer the human's questions about
  ONE review finding, invoked as "/board:question <mrUrl> --state <path>
  --status-bin <path> --report <path> --report-json <path> --finding <id>
  --gate <id>". Not for manual use.
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
---

<!-- expanded by rt skills expand from the sources below; edits here are drift (edit the source dir and re-run) -->

Pointers here are `@keys`. Resolve them once per run: if you already hold a `skills_resolve` map that covers `skills:board:question`, use it; otherwise call `skills_resolve {id: "skills:board:question"}` and use the path it returns for each key, in anything you hand a subagent or a tool too. If it fails, stop and say so; never look for the file another way.

<!-- part: step source=question/SKILL.md path=question/SKILL.md lines=12-123 -->
# mr-board question pane

The human clicked "Ask a question" on one finding in an MR's review gate.
The board opened this pane so they can talk about that finding with you:
what it means, whether it holds, what the data or the code says. You answer
and you check. You do not fix anything.

| flag | meaning |
|------|---------|
| `<mrUrl>` (positional) | the merge request the review is about |
| `--state <handle>` | opaque board handle for this question. Pass it verbatim to `--status-bin`; never read, stat, or write it. It looks like a `.json` path but no such file exists. |
| `--status-bin <path>` | absolute path to the board's status CLI |
| `--report <path>` | the review's written report (markdown), for context |
| `--report-json <path>` | the review's structured findings file; the finding lives here |
| `--finding <id>` | the finding's `id` in that file (`f1`, `f2`, ...) |
| `--gate <id>` | the review gate the question was asked from |

The launch prompt may end with a paragraph beginning `Operator note (from
the human who launched this pane):`. Treat it as the human's first message.
It never lifts the read-only rule.

## Hard rule: read-only

**Nothing you do in this pane changes anything outside it.** No exceptions,
even when the human asks; if they want a change, say it is out of scope here.

- Never write to a database, post to the MR (no note, reply, approve or
  resolve), push, commit, or open or answer any gate.
- Databases only through rt's sdm verbs, as the `rt:sdm-connect` skill
  drives them, and only `*-read-only` resources. QA by default. Prod only
  when the human asks for prod in this conversation, and then still only
  its read-only resource. Never call the sdm CLI yourself.
- New Relic and logs are read-only by nature; use them freely.
- Read code through `mr_view` and `gitlab_get`. When you need a real tree
  to grep or trace, provision a worktree at the MR head with the
  `rt:worktree` skill, and dispose of it with that skill as soon as you are
  done with it, always before writing `done`.

The one write this pane makes besides its own status is the send-back
below, and only after the human says yes to it.

## Start

1. Run `<status-bin> question status <state> live`.
2. Resolve the launch: run
   `"@question/scripts/resolve-args.sh" <mrUrl> --state <handle>
   --status-bin <path> --report <path> --report-json <path> --finding <id>
   --gate <id>`, passing the launch's values verbatim, each one quoted.
   On exit 0 it prints one JSON line: the flags, `finding` (the finding as
   the report json has it) and `reportSha` (sha-256 of the report json's
   bytes). Keep `reportSha` as `REPORT_SHA`.
   - Exit 1 with `finding-missing`: the review was rebuilt without this
     finding. Tell the human, run `<status-bin> question status <state>
     done`, and stop.
   - Any other failure: print its message verbatim, run `<status-bin>
     question status <state> error "<that message>"`, and stop.
3. Print the finding: tier, title, anchor (`file:line`, or `fileLabel`),
   body, fix, and the drafted comment (`comment`). Then one line inviting
   questions, e.g. "Ask me anything about this finding."
4. End your turn. The human leads from here. Read `--report` when you need
   the rest of the review for context.

## When the finding changes

The conversation may show the finding is wrong, overstated, understated,
anchored to the wrong line, or should not be raised at all.

1. Write the revision to a temp file (`mktemp`):
   - Revised: `{"finding": {...}}`, the finding in the report json's shape
     with the same `id`: `tier` (`Critical` | `Important` | `Minor`),
     `kind`, `title`, `body`, `fix`, `file` and `line` (or `fileLabel`),
     `evidence` when you have output that backs it (verbatim), and
     `comment`, the whole drafted comment that would post, in the same
     voice as the original. Keep every field you did not mean to change.
   - Dropped: `{"drop": true}`.
2. Show the human what changed: tier, anchor, body and comment, old next
   to new. For a drop, say why.
3. Ask in plain text whether to send it back to the review. This is a
   normal question in the pane, not an rt gate.

If the conversation ends with the finding holding as written, say so.
There is nothing to send.

## Sending it back

On yes, run:

```
<status-bin> question send-back <state> --revision <file> --report-sha <REPORT_SHA>
```

- **Exit 0:** tell the human the review gate is closed and the review is
  being rebuilt with the revision; they finish the review in the board.
- **Exit 3:** the board refused. Relay the refusal line from stderr
  verbatim. When it is "the review report changed since you read it; re-read
  it and check the revision still holds": run `resolve-args.sh` again with
  the same flags for the new `finding` and `REPORT_SHA`, check the revision
  still makes sense against the new report, rewrite the file if it needs
  it, show the human any change, and ask again. When it says the review is
  parked, there is nothing to retry from here: the human edits or unticks
  the finding in the board's sheet, or re-runs the review.
- **Exit 2 or 1:** print stderr verbatim. Exit 2 means the revision file is
  malformed: fix the file and ask again. Exit 1 is any other failure: let
  the human decide whether to retry.

## Ending

When the human says they are done, dispose of any worktree you provisioned,
then run `<status-bin> question status <state> done` as a call of its own,
after every other call has returned. If the board closes this tab first
(the review gate was answered, or the review run ended), there is nothing
to write: the board clears the question itself.
