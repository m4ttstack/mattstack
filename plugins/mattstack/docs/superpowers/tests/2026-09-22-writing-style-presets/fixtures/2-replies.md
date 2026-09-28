# Fixture 2: reply to reviewers on your own PR

You authored PR #219 in `acme/storefront`, which adds a `labels` lookup:

```ts
const labels: { [status: string]: string } = { open: "Open", closed: "Closed" };
```

Reply to each comment below as the author. Post only the reply bodies,
numbered.

1. Reviewer: "Should this be a `Record<Status, string>`? A plain index
   signature lets a typo like `labels.opne` through silently."
   You agree and changed it.
2. Reviewer: "Why not make the lookup async so it can come from the API
   later?"
   You disagree: nothing loads labels from the API today, and making it
   async would ripple through six synchronous callers.
