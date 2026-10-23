---
order: 10
---

# Red flags

| Thought | Reality |
|---|---|
| "I wrote this, I can tell if the reviewer is right" | That is the author bias. Dispatch the fresh-context adjudication. |
| "It's a small comment, I'll just judge it here" | Small own-code judgments are the peak of the bias. Dispatch it. |
| "I'll run self-review at the end as the check" | Too late. The fresh context adjudicates the comments; it is not a gut-check after. |
| "I'll open with 'Good call' / 'You're right'" | Performative. State the technical content. |
| "I'll process the resolved / bot threads too" | Unresolved human threads only; never filter the `mr_threads` result again or add a dropped thread back. |
| "The caller already handed `{plan, post}`, but I'll ask both gates" | A handed object answers both gates; ask nothing. |
| "I'll post the replies since they look right" | Post only what an answer picked; resolve only `resolve:`; never approve. |
| "I'll offer the reply-only threads at `respond-post` too, for a last look" | The developer already saw that exact reply. Only fixed threads and overrides are offered. |
| "I know the contexts were dropped; I'll apply that when the answer comes" | A pane that dies takes that with it. Write `gate-1-context: dropped` into the saved report right after the open. |
| "I'll work out the overrides and texts from the answers myself" | `gate_record` computes them. Write its `rows` as they come back. |
| "The resumed run lost its rows, so I'll record respond-plan again" | Never re-record a recorded scope: it moves `decided_at`. Join the decision to the stored cards. |
| "The run already records respond-plan (a revise), so the handed plan is spent and the record wins" | The revise answered the earlier open. A plan handed after it answers the newer open: record it once and walk its rows. |
| "The verdict report recommended a reply here, so it posts" | Posting reads each row's `gate-1` field, never the recommendation. |
| "The gate approved posting, not a push, so I'll ask before pushing" | The proceed authorizes the push. |
| "The fix is held on a branch mismatch; I'll switch branches, or push from the shell" | Never. Report it verbatim; the run stays open. Only `respond_post_execute` (GitLab) or `git_push` (GitHub) pushes, never forced. |
| "The forge refused one reply, so I'll post it myself with `mr_reply_thread`" | The tool already retried it. Open the one off-script gate; take and iterate call `respond_post_execute` again. |
| "They ticked post before choosing Iterate (or Hold), so those picks act now" | Only `proceed` acts. |
| "The run already records respond-post with nothing held, so it posted; I'll close" | A pane can record and die before it posts. Run the post side again. |
| "This one is clearly right, I'll add the guard in a follow-up commit" | Implementation follows `code-changes: approve`. |
| "It's wrong, but I need the reviewer to point me at it" | Then it is `needs-clarification`, not `pushback`. |
| "The pane is fresh, so I'll adjudicate again before applying the handed plan" | A handed plan answers an adjudication the human already saw. Record it and execute it. |
| "The run stores no respond-plan source, so I'll record the handed plan bare" | Build and store the open with the hand-back `gate_open`, then record. |
| "The caller asked the respond-plan gate, so it records the decision" | This verb records it with `gate_record`. |
| "I'll present the table and ask about fixes and posting in the same breath" | `respond-plan` and `respond-post` are two gates, in order. |
