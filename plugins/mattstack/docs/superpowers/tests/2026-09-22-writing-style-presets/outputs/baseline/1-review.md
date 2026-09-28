src/settings/cache.ts:7
The cache key is `userId` alone, but user ids are only unique within a tenant (`src/users/ids.ts:14` derives them from a per-tenant counter). With the seed data, `getSettings("t1", "u7")` followed by `getSettings("t2", "u7")` returns t1's settings both times, so one tenant reads another tenant's settings. Key on both, e.g. `` `${tenantId}:${userId}` ``, and apply the same key in `cache.set` on line 10.

src/settings/cache.ts:14
Same issue on eviction: `clearSettings(userId)` can't tell which tenant's entry to drop. It needs to take `tenantId` too and delete the composite key, otherwise a write for t1's u7 either evicts the wrong entry or leaves a stale one behind.

src/settings/cache.ts:2
`logger` is imported but never used. Drop the import.

No tests are added with this change. At minimum I'd want one that covers two tenants sharing a user id (the case above fails today) and one that checks `clearSettings` forces the next `getSettings` to reload.

Summary: requesting changes. The cache is keyed on `userId` only, which leaks settings across tenants because user ids repeat between tenants; I reproduced it with t1/u7 and t2/u7 from the seed data. Fix the key in both `getSettings` and `clearSettings` and add a test for the cross-tenant case. The unused `logger` import is a minor cleanup.
