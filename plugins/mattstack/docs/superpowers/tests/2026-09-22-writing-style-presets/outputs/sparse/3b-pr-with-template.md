ABC-481: key settings cache on tenant and user

## Summary

Caches settings per user, keyed on tenant and user so two tenants with the same user id stop reading each other's settings.

**Cache** `src/settings/`

- `cache.ts`: per-user cache keyed on `(tenantId, userId)`; `clearSettings(tenantId, userId)` evicts one entry.
- `load.ts`: `loadSettings` throws `SettingsNotFound` instead of returning `undefined`.

**Callers**

- `src/api/settings.ts`: PATCH handler calls `clearSettings` after a write.
- Renames `getUserPrefs` to `getSettings` in three callers.

**Follow-up**

- Cache size limit: ABC-490.

## Checklist
- [x] Behind a feature flag, or N/A with a reason: N/A, server-side cache with no user-facing change
- [x] Tests added or updated

## Verification

9 new tests in `cache.test.ts`, settings suite 142/142 green; by hand, t2's u7 shows t2's theme after t1's u7 loads first.

- https://preview-481.storefront.example.com
