`src/settings/cache.ts:7`

**issue:** The cache is keyed on `userId` alone, but ids only repeat within a tenant (`src/users/ids.ts:14`), so two tenants with the same id share one entry. I tried it with the seed data:

```
getSettings("t1", "u7") -> t1's settings
getSettings("t2", "u7") -> t1's settings
```

Could we key on both, here and in `clearSettings`?

```ts
const key = `${tenantId}:${userId}`;
```

`src/settings/cache.ts:2`

**nitpick:** `logger` is imported but never used. Drop it?

---

**suggestion:** Could you add a test for two tenants sharing a user id? Nothing covers the cache yet.

---

One blocker on the cache key, see inline. The rest looks good.
