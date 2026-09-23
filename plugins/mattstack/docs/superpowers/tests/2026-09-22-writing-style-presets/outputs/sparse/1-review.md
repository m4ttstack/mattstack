src/settings/cache.ts:7
**issue:** i think this leaks across tenants. `userId` is only unique within a tenant (`src/users/ids.ts:14` derives it from a per-tenant counter), and both t1 and t2 have a u7 in seed data, so `getSettings("t1", "u7")` then `getSettings("t2", "u7")` returns t1's settings both times. could we key on tenant and user, and have `clearSettings` take both?

src/settings/cache.ts:2
**nitpick:** `logger` is imported but never used.

**suggestion:** would you mind adding a test for the two-tenant case? nothing covers the cache yet. 👌

Left one blocker inline.
