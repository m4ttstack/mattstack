---
order: 2
---

# Review findings

Open with a bolded Conventional Comments label, never a code span
(`**issue:**`, `**suggestion:**`, `**question:**`, `**nitpick:**`,
`**thought:**`, `(non-blocking)` when it helps), chosen by what you ask the
author to do.

Two to four sentences: what's wrong, why in one sentence (with
`file.ts:line`), and the fix as a friendly question, code in a fenced block.

````
**issue:** `pageCount` rounds down (`src/list/paginate.ts:31`), so the last partial page never renders. With 45 items at 20 per page you'd see two pages and lose the last five. Could we round up?

```ts
const pageCount = Math.ceil(total / pageSize);
```
````

A process ask is one line that leads with the approval if there is one:
`**suggestion:** Looks good! Could you add a test for the empty-list case?`
