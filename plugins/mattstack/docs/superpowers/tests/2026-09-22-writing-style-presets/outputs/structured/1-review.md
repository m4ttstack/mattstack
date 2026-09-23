`src/settings/cache.ts:7`

**issue:** The cache key collides across tenants.
Why: `userId` is unique only within a tenant (`src/users/ids.ts:14`), but the key is `userId` alone.
Impact: seed tenants `t1` and `t2` both have a user `u7`; the second call returns t1's settings.

```
getSettings("t1", "u7") -> t1 settings
getSettings("t2", "u7") -> t1 settings
```

Suggestion: key on both ids, and take both in `clearSettings` (`src/settings/cache.ts:14`).

```ts
const key = `${tenantId}:${userId}`;
```

`src/settings/cache.ts:2`

**nitpick:** `logger` is imported and never used.

Top-level comment:

**suggestion:** No tests cover the cache.
Suggestion: add a test for the two-tenant case above in `cache.test.ts`.

Summary:

One blocker inline (cache key).
