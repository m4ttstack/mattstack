src/settings/cache.ts:7
**issue:** the key is just `userId`, but ids are only unique within a tenant (`src/users/ids.ts:14` derives them from a per-tenant counter), so two tenants with the same id share an entry. seed data hits it:

```
getSettings("t1", "u7") -> t1 settings
getSettings("t2", "u7") -> t1 settings
```

could we key on `${tenantId}:${userId}` and have `clearSettings` take both?

src/settings/cache.ts:2
**nitpick:** `logger` isn't used.

**suggestion:** would you mind adding a couple of tests for the cache? a hit, a miss, and the cross-tenant case from the inline note would be 👌

Left one blocker inline, plus a couple of small notes.
