---
order: 2
---

# Review findings

Open with a bolded Conventional Comments label, never a code span:
`**issue:**`, `**suggestion:**`, `**question:**`, `**nitpick:**`,
`**thought:**`, with `(non-blocking)` when it helps. Pick it by what you ask
the author to do: `question` when they need to check, `issue` when you know
it's broken, `suggestion` for design or style, `nitpick` for trivia,
`thought` when musing.

Most findings are 2 to 4 sentences: the problem, the one-line causal chain,
and the fix asked as a light question. The inline anchor already says where
you are, so don't re-walk the path. The beats a substantive finding may take,
in order (a superset; most use two or three):

1. **Claim, hedged.** `i think this drops the last partial page.`
2. **Mechanism**, cited as `file.ts:line`. When it is a condition or two,
   fold it into the claim instead of its own paragraph.
3. **Impact.** `any list with a remainder hits it, so it's reachable.`
   Often folds into the claim.
4. **Suggestion, as a question.** Code goes in a fenced block.
5. **Concession, only when real.** Never as a politeness move.

A non-blocking `thought` or `question` is two short paragraphs at most. A
process ask (a missing test, missing evidence) is one or two casual lines
that lead with the approval if there is one and ask as a favor:

```
**suggestion:** changes look good. would you mind adding a test for the empty-list case? 👌
```

Over-built:

```
**issue (non-blocking):** on the retry path this re-reads the stale price. `loadPrice` runs inside `fetchCart().then`, so when `fetchCart()` rejects the price is still the cached one and `total()` returns the old value. for a customer whose price changed, checkout shows the old total... the exact bug this change fixes, reintroduced on the failure path. `usePriceRefresh` can't rescue it since the cache never cleared. it's defensible as fail-closed, but should be a conscious decision.
```

Compressed, same finding and ask:

```
**issue (non-blocking):** if `fetchCart()` rejects here the price is still the cached one, so checkout shows the old total... the same bug this fixes. fine as fail-closed, but can we say that in a comment (or retry once)? right now it reads as harmless.
```

A brief, specific credit is fine folded in after the worry, never as the
opener: `**thought (non-blocking):** only worry here: nothing tests the
fallback. the version's pinned now, nice catch.`. A bare compliment is not.
