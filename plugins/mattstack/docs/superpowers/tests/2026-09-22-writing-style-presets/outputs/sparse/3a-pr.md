ABC-481: cache per-user settings per tenant

Adds a settings cache keyed on `(tenantId, userId)` so two tenants with the same user id stop reading each other's settings.

**Cache** `src/settings/cache.ts`

- Adds a per-user settings cache keyed on `(tenantId, userId)`.
- Adds `clearSettings(tenantId, userId)` to evict one entry.

**Load** `src/settings/load.ts`

- `loadSettings` throws `SettingsNotFound` instead of returning `undefined`.

**API** `src/api/settings.ts`

- Calls `clearSettings` after a PATCH write.

**Also**

- Renames `getUserPrefs` to `getSettings` in three callers.

**Follow-up**

- Cache size limit: ABC-490.

Loading t1's u7 then t2's u7 shows t2's theme on the settings page; 9 new tests in `cache.test.ts`, settings suite 142/142 green.

- https://preview-481.storefront.example.com
