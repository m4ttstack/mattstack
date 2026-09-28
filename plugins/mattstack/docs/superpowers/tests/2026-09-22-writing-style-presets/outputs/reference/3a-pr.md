## ABC-481: cache per-user settings, keyed on tenant and user

Adds a settings cache so repeat reads skip the load. Entries are keyed on `(tenantId, userId)` and a PATCH evicts the entry it wrote.

### What changed

**Cache** (`src/settings/cache.ts`)

- Adds a per-user cache keyed on `(tenantId, userId)`
- Adds `clearSettings(tenantId, userId)` to evict one entry

**Wiring**

- `loadSettings` throws `SettingsNotFound` instead of returning `undefined`
- PATCH handler in `src/api/settings.ts` calls `clearSettings` after a write

**Also**

- Renames `getUserPrefs` to `getSettings` in three callers

### Follow-up

- ABC-490 covers a cache size limit

### Verification

9 new tests in `cache.test.ts`; full settings suite 142/142 green.

Settings page for tenant t2 user u7 shows t2's theme after t1's u7 loads first.

- [https://preview-481.storefront.example.com](https://preview-481.storefront.example.com)
