---
order: 14
---

# Red flags

| Thought | Reality |
|---|---|
| "For a change this small I'll just give my own read" | Small, own-authored changes are peak author bias, not an exemption. Dispatch the fresh reviewer. |
| "I'll do a first-pass read myself and a fresh review can back it up" | The fresh reviewer IS the review, not a backup for one already formed. Don't pre-empt it with an inline verdict. |
| "I'll suggest the developer get a review elsewhere" | This skill owns the dispatch; don't outsource it back to whoever is waiting. |
| "Re-reading my own lines is low-value, I'll just eyeball and ship" | Right that re-reading is low-value -- which is why a fresh context, not this eyeball, does the reading. |
| "I know what this does, I just wrote it" | That is the bias stated as a qualification. Dispatch the reviewer. |
| "It's only a Minor; fixing blocking findings is enough" | On a full review's draft `all` is the recommendation. Minor findings left open come back as teammate threads. Only a re-review's draft with no Critical or Important recommends Ship as is. |
| "That fix only touched a comment, but it is still a change, so re-review it" | A round whose every kept change is comment text closes without a re-review or a `rereview-rounds` charge. A suppression, pragma or other comment a tool reads is code. |
| "That code is pre-existing; a follow-up is fine" | Only the reviewer's judgment-call mark leaves a finding open. Reachable from this change, or unmarked, means fix it. |
| "Ship can capture that screenshot; I'll note it" | Record it as owed evidence: a list ship must clear, not a note. |
| "The fix was small; the last commit is all that changed" | Re-review every change since `self-review-head`, the fix commits included. |
