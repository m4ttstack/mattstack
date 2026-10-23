---
node: record_push_failed_quoted
---

# Record push failed, reason quoted

The branch lands in push failed with the `git_push` error quoted as the
reason, and the rest carry on. A safety refusal (lease, protected or
default branch, detached HEAD, upstream mismatch) is a verdict on that
branch: never gated, never retried; so is any other `git_push` error.
