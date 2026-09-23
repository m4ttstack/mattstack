ABC-481: Key the settings cache on tenant and user

## Summary

User ids only repeat within a tenant, so a cache keyed on `userId` alone let two tenants read each other's settings. This keys it on `(tenantId, userId)` and evicts on write. Start with `src/settings/cache.ts`, the rest is plumbing.

- `src/settings/cache.ts`: the cache is keyed on `(tenantId, userId)`, and `clearSettings(tenantId, userId)` evicts one entry.
- `src/settings/load.ts`: `loadSettings` throws `SettingsNotFound` instead of returning `undefined`.
- `src/api/settings.ts`: the PATCH handler calls `clearSettings` after a write.
- Renamed `getUserPrefs` to `getSettings` in three callers.
- The cache size limit is left for ABC-490.

## Checklist
- [x] Behind a feature flag, or N/A with a reason: N/A, this fixes a cross-tenant read and shouldn't be switchable.
- [x] Tests added or updated

## Verification

9 new tests in `cache.test.ts`, and the settings suite is 142/142. By hand I checked that tenant t2's u7 sees t2's theme after t1's u7 loads first.

https://preview-481.storefront.example.com
