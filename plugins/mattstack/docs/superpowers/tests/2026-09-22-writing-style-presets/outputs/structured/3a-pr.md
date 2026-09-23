ABC-481: Cache per-user settings keyed on tenant and user

## Summary

Adds an in-memory cache for per-user settings and evicts the entry after a PATCH writes new values. The key includes `tenantId` because user ids are unique only within a tenant.

## Changes

- `src/settings/cache.ts`: cache keyed on `(tenantId, userId)`; `clearSettings(tenantId, userId)` evicts one entry
- `src/settings/load.ts`: `loadSettings` throws `SettingsNotFound` instead of returning `undefined`
- `src/api/settings.ts`: PATCH handler calls `clearSettings` after a write
- Callers: `getUserPrefs` renamed to `getSettings` at three call sites

## Testing

- 9 new tests in `cache.test.ts`; settings suite 142/142
- Loaded t1's u7, then t2's u7: the settings page shows t2's theme
- Preview: https://preview-481.storefront.example.com

## Follow-up

- Cache size limit: ABC-490
