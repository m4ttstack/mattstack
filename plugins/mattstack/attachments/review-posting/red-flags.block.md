---
order: 8
---

# Red flags

| Thought | Reality |
|---|---|
| "No selection arrived, I'll ask which levels to post" | Never improvise a question here. Arriving without a decided selection is a caller bug: stop and say so. |
| "It handed me finding ids, but the contract says levels" | Both shapes are the contract. Ids post exactly those findings; levels post whole tiers. Only a payload carrying neither is a caller bug. |
| "This selected finding has no `file`, I'll anchor it to the nearest line" | Never invent an anchor. A selected entry with no `file` goes in the summary comment. |
| "This restored finding has a `file` and `line`, so it goes inline" | Not with `changed` true: its recorded line may now hold other code. It goes in the summary's issue list, its recorded `file:line` in the text. |
| "I'll fold the deselected Minors into the summary note" | No side door. A deselected finding drops entirely; it does not move to a different channel. |
| "No approval landed, but I'll still say 'nothing blocking'" | Tacit approval. Strip the all-clear language unless the disposition actually approves. |
| "I'll close with !123" | Bare id. The close HARD-GATE needs a markdown link to the real URL, read from the forge (a posting tool's `mrUrl`; else `mr_view`'s `webUrl`, called with `mrUrl` or `repoName` plus `iid`, on GitLab, `gh pr view` on GitHub). |
| "GitLab has no Request changes here, I'll just post a plain Comment" | Post a blocking-framed Comment: its Assessment names what blocks the merge and says approval is withheld. |
| "The selection looked stale, I'll re-ask to be sure" | Not this part's call. A decided selection is trusted as handed; re-deciding belongs to the caller, not the executor. |
| "I'll post the inline comments first, then the summary" | On GitLab the review is one call. Comments posted one by one never become a submitted review, and the reviewer never reads as having reviewed. |
| "The drafted summary says twelve notes but eleven are selected, I'll fix the count" | Text the human saw on the gate posts as it stands. Never reword, recount or restyle a draft or an edit. |
| "I'll put the unanchored finding under a heading in the summary" | In a drafted review the summary is the summary line, then each folded text after one blank line, and nothing else. |
| "The approval failed, I'll run the whole review again" | The review is already up. The approval is settled on its own, through the caller's approval gate; a second submit posts every finding twice. |
