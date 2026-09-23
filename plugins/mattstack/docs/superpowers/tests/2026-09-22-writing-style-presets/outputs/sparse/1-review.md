src/settings/cache.ts:21

**issue:** i think this leaks across tenants: `userId` is only unique within a tenant (`src/users/ids.ts:14`). seed data has a u7 in both t1 and t2:

```
getSettings("t1", "u7") -> t1 settings
getSettings("t2", "u7") -> t1 settings
```

could we key on both, and have `clearSettings` take `tenantId` too?

```ts
cache.get(`${tenantId}:${userId}`)
```

src/settings/cache.ts:2

**nitpick:** `logger` is unused.

**suggestion:** would you mind adding a test for the two-tenant case above?

Left one blocker inline.
