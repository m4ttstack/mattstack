ABC-481: key settings cache on tenant and user

## Summary

the settings cache was keyed on `userId` alone, so two tenants with the same id read each other's settings. this keys it on both and evicts on write.

**Cache** `src/settings/`

- `cache.ts`: keyed on `(tenantId, userId)`; `clearSettings` takes both.
- `load.ts`: `loadSettings` throws `SettingsNotFound` instead of returning `undefined`.

**API**

- `src/api/settings.ts`: PATCH handler calls `clearSettings` after a write.

**Also**

- Renames `getUserPrefs` to `getSettings` in three callers.

**Follow-up**

- cache size limit: ABC-490.

## Checklist
- [x] Behind a feature flag, or N/A with a reason: N/A, bug fix with no new surface
- [x] Tests added or updated

## Verification

9 new tests in `cache.test.ts`; settings suite 142/142 green. loading t1's u7 then t2's u7 shows t2's theme on the settings page.

- https://preview-481.storefront.example.com
