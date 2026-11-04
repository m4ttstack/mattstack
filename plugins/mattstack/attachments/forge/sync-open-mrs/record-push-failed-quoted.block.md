---
node: record_push_failed_quoted
---

# Record push failed, reason quoted

The branch lands in push failed with the `git_push` error quoted as the
reason, and the rest carry on. A safety refusal (lease, protected or
default branch, detached HEAD, upstream mismatch) is a verdict on that
branch: never gated, never retried; so is any other `git_push` error.

A `refusal: "check-red"` or `"check-error"` is the repo's own pre-push check
failing, and it is the same verdict. That result has no error text, so the
reason quotes `check.result.summary.failures`, or `check.result.reason` when
that list is empty. `allowRed` and `skipCheck` push anyway, so this sweep never
passes them.
