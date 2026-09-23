ABC-481: Cache per-user settings

## Summary

Adds an in-memory settings cache keyed on `(tenantId, userId)` so repeat reads skip the loader. The PATCH handler evicts the entry after a write, so callers never see stale settings.

## Changes

- `src/settings/cache.ts`: per-user cache keyed on `(tenantId, userId)`; `clearSettings(tenantId, userId)` evicts one entry
- `src/settings/load.ts`: `loadSettings` throws `SettingsNotFound` instead of returning `undefined`
- `src/api/settings.ts`: PATCH handler calls `clearSettings` after a write
- Callers: `getUserPrefs` renamed to `getSettings` in three places

## Testing

- 9 new tests in `cache.test.ts`; settings suite 142/142
- By hand: loaded settings for tenant t1 user u7, then t2 user u7; the t2 page shows t2's theme
- https://preview-481.storefront.example.com

## Follow-up

- Cache size limit (ABC-490)
