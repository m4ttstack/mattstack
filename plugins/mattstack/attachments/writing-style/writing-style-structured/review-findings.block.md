---
order: 2
---

# Review findings

Open with a bolded Conventional Comments label, never a code span, then
labelled lines:

````
**issue:** The last partial page never renders.
Why: `pageCount` rounds down (`src/list/paginate.ts:31`).
Impact: 45 items at 20 per page show two pages; the last five are lost.
Suggestion: round up.

```ts
const pageCount = Math.ceil(total / pageSize);
```
````

Use only the lines that carry something: a `nitpick` is the label and one
line. A process ask is one line.
