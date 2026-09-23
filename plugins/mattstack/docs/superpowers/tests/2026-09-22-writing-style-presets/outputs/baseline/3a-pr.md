ABC-481: key the settings cache on (tenantId, userId)

The per-user settings cache was keyed on `userId` alone. User ids are only unique within a tenant, so two tenants with the same user id read each other's settings. This keys the cache on both and makes eviction tenant-aware.

## Changes

- `src/settings/cache.ts`: cache keyed on `(tenantId, userId)`; `clearSettings(tenantId, userId)` evicts one entry.
- `src/settings/load.ts`: `loadSettings` now throws `SettingsNotFound` instead of returning `undefined`, so a missing row is never cached as a value.
- `src/api/settings.ts`: the PATCH handler calls `clearSettings` after a write so the next read sees the update.
- Renamed `getUserPrefs` to `getSettings` in three callers.

## Testing

- 9 new tests in `cache.test.ts`; full settings suite 142/142 green.
- Checked by hand on the preview: settings page for tenant t2 user u7 shows t2's theme after t1's u7 loads first.
- Preview: https://preview-481.storefront.example.com

## Not in this PR

- Cache size limit, tracked in ABC-490.
