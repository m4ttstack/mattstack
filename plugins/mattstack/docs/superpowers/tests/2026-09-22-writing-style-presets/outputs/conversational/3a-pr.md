ABC-481: Cache per-user settings

This caches settings per user and keys the entry on tenant and user, since user ids are only unique within a tenant. Start with `src/settings/cache.ts`; the rest is plumbing around it.

**What changed**

- `src/settings/cache.ts`: cache keyed on `(tenantId, userId)`, with `clearSettings(tenantId, userId)` evicting one entry.
- `src/settings/load.ts`: `loadSettings` throws `SettingsNotFound` instead of returning `undefined`.
- `src/api/settings.ts`: the PATCH handler calls `clearSettings` after a write.
- Renamed `getUserPrefs` to `getSettings` in three callers.
- The cache size limit is left for ABC-490.

**Testing**

9 new tests in `cache.test.ts`, settings suite 142/142. Checked by hand that tenant t2's u7 sees t2's theme after t1's u7 loads first.

Preview: https://preview-481.storefront.example.com
