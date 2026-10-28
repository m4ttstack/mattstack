---
order: 1
---

# Check the verdict set

These steps run only when the selector ran and the reviewer has returned.

1. Extract the reply's fenced block tagged with the `fence` value into
   `verdict-set.json` in the review scratch dir.
2. Zero such blocks, two or more, or JSON that does not parse is one
   problem, and the verdicts command is not run.
3. Otherwise run the `verdicts` command on Bash, `{selection}` replaced by
   the path of `selection.json` and `{verdicts}` by the path of
   `verdict-set.json`. Exit 0 means no problems. Exit 1 means the
   `problems` its stdout lists. Any other exit is one problem, quoting the
   exit status and stderr.
