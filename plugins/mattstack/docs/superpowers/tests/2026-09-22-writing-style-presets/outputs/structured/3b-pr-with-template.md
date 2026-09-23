ABC-481: Cache per-user settings keyed on tenant and user

## Summary

Adds an in-memory cache for per-user settings and evicts the entry after a PATCH writes new values. The key includes `tenantId` because user ids are unique only within a tenant.

- `src/settings/cache.ts`: cache keyed on `(tenantId, userId)`; `clearSettings(tenantId, userId)` evicts one entry
- `src/settings/load.ts`: `loadSettings` throws `SettingsNotFound` instead of returning `undefined`
- `src/api/settings.ts`: PATCH handler calls `clearSettings` after a write
- Callers: `getUserPrefs` renamed to `getSettings` at three call sites
- Follow-up: cache size limit in ABC-490

## Checklist
- [x] Behind a feature flag, or N/A with a reason: N/A, in-memory cache with no user-facing change
- [x] Tests added or updated: 9 new tests in `cache.test.ts`

## Verification

- Settings suite 142/142
- Loaded t1's u7, then t2's u7: the settings page shows t2's theme
- Preview: https://preview-481.storefront.example.com
