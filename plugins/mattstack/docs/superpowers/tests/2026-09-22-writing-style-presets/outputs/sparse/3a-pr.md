ABC-481: key settings cache on tenant and user

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

9 new tests in `cache.test.ts`; settings suite 142/142 green. loading t1's u7 then t2's u7 shows t2's theme on the settings page.

- https://preview-481.storefront.example.com
