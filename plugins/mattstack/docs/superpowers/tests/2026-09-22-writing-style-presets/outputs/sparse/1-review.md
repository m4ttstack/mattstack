`src/settings/cache.ts:7`

**issue:** `userId` is only unique within a tenant (`src/users/ids.ts:14`), so this key collides across tenants. the seed data reproduces it:

```
getSettings("t1", "u7") -> t1 settings
getSettings("t2", "u7") -> t1 settings
```

could we key on both, here and in `clearSettings`?

```
const key = `${tenantId}:${userId}`;
```

`src/settings/cache.ts:2`

**nitpick:** `logger` is unused.

**suggestion:** would you mind adding a test for the two-tenant case? the seed data already has one.

Left one blocker inline.
