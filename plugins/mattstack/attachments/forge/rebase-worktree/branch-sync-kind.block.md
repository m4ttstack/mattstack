---
node: branch_sync_kind
---

# branch_sync kind?

`branch_sync` does the fetch, the stack check, the rebase and the push in
one call, and returns `{kind, branch, oldHead, newHead, pushed, refusal?,
paths?}`. `kind` decides, and nothing else does:

| kind | next |
|---|---|
| `synced` | The branch moved. `pushed: true`: origin has it, so no push gate. `pushed: false`: origin's ref lacks the new head, so **Gate push** follows. |
| `up-to-date` | Nothing moved or was pushed. **Report the move** says "already current; nothing pushed". |
| `push-refused` | The rebase landed locally; the push failed. **Report the move** quotes `refusal`; **Gate push** follows. |
| `dirty-tree` | Nothing ran. **Gate clarify: dirty tree** with the result's `paths`. |
| `conflict` | The rebase is paused in the worktree. **Gate conflict:rebase-worktree:<attempt>** with the bundle's `unresolvedFiles`. Keep the result's `newHead` for **Head still the old head?**. |
| `stacked-refused` | **Refused: stack member, tool named**: quote `refusal` and name the tool it names. The restack belongs to that tool. |
| `stack-unverified` | **Stack check could not run: reported**: quote `refusal`, which says why. |
| `error` | Read `refusal`. When it says "run git_pull first" (the branch is only behind origin), go to **Pulled once already?**: one `git_pull {tree}`, then one more `branch_sync`. That phrase is the one text match in this skill. Any other refusal or failure: **Refused: reported** with `refusal`. |

| Thought | Reality |
|---|---|
| "The stack refusal came back, but the MR targets the default branch, so I'll rebase by hand" | `stacked-refused` is the guard's verdict, not a hint. The run ends reported; the restack is the named tool's. |
| "The stack check could not run, so I'll check the MRs myself and rebase" | `stack-unverified` ends the run. An unverified branch is never rebased, by hand or by another tool. |
| "`synced`, so now the push gate" | With `pushed: true` the push already happened; a push form would be a false choice. Report it as pushed. |
| "`synced` means pushed" | Read `pushed`. With `pushed: false` the new head is local only, and the push gate decides. |
