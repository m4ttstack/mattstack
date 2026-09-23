`src/settings/cache.ts:7`
**issue:** The cache key collides across tenants.
Why: `userId` is unique only within a tenant (`src/users/ids.ts:14`), but the map is keyed on it alone.
Impact: seed tenants `t1` and `t2` both have a `u7`; the second tenant gets the first tenant's settings.

```
getSettings("t1", "u7") -> t1 settings
getSettings("t2", "u7") -> t1 settings
```

Suggestion: key on both ids, and take both in `clearSettings`.

```ts
const key = `${tenantId}:${userId}`;
```

`src/settings/cache.ts:2`
**nitpick:** `logger` is imported and never used.

**suggestion:** Add tests for `getSettings`; a two-tenant case with the same user id would cover the issue above.

One blocker inline (cache key).
