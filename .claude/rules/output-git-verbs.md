---
paths:
  - "commands/git/**"
  - "commands/sync.ts"
  - "lib/mcp/git-tools.ts"
---

# Output layer: git verbs and sync

The git verbs fail through `commands/git/shared.ts`: `failPlain(json, title,
message)` keeps git's own message as the `--json` error and prints it under a
plain title for a person, `failUsage` does the same for a usage string, and
both exit 1. A refusal by policy (the ownership guard, an undo rt will not
do, the uncommitted-changes guard, a stack member under `rt sync`) is never
a failure: `refuseWith` prints a `refused` note on stderr and keeps the
`--json` error and exit code, and `refusalNote` returns the note's blocks.
`drawFailure(failure, refused)` draws that refused note only when `refused`
is true, else a coral failure. The API under `rt sync` (`rebaseOnto`,
`resetToOrigin`, `syncBranch`) never prints a failure: a result that ends
badly carries `failure` beside `error`, plus `refused: true` when it is a
refusal, and the caller draws it with `drawFailure`, so `sync` and
`git rebase` show one block for one cause on stderr, and `sync all` writes
each branch's ending to stderr under its heading, with one blank row between
branches. Their progress lines go to stdout through `out.print` and stop
under `quiet`, all but one: the fetch step `rebaseOnto` and `resetToOrigin`
run without `skipFetch` still draws under `quiet` (on stderr under a payload
verb, so `rt git rebase --json` shows it). `syncBranch` fetches once itself,
gated, and passes `skipFetch`, so a quiet sync prints no progress at all.

`rt sync --json` and `rt git rebase --json` call `out.payloadOnStdout()`
first, so stdout is the conflict bundle or the stack refusal and nothing
else; a step's plain line and every note go to stderr. A failed
`rt sync --json` writes one failure, last on stderr, in at most three lines
(`compactFailure` in `commands/sync.ts`), because `branch_sync` builds its
error from the last three stderr lines (`detail` in `lib/mcp/git-tools.ts`).
A new sync failure with `details` needs no care; a new line printed to stderr
after the failure breaks the tool's error.
