## Summary

caches settings per user so repeat reads skip the loader. keyed on tenant and user, since user ids are only unique within a tenant.

**Cache** `src/settings/cache.ts`

- Adds a settings cache keyed on `(tenantId, userId)`.
- Adds `clearSettings(tenantId, userId)` to evict one entry.

**Loader** `src/settings/load.ts`

- `loadSettings` throws `SettingsNotFound` instead of returning `undefined`.

**API** `src/api/settings.ts`

- PATCH handler calls `clearSettings` after a write.

**Also**

- Renames `getUserPrefs` to `getSettings` in three callers.

**Follow-up**

- Cache size limit: ABC-490.

## Checklist
- [x] Behind a feature flag, or N/A with a reason: N/A, internal cache with no user-visible change
- [x] Tests added or updated

## Verification

9 new tests in `cache.test.ts`; settings suite 142/142 green. by hand, t2's u7 shows t2's theme after t1's u7 loads first.

- https://preview-481.storefront.example.com
