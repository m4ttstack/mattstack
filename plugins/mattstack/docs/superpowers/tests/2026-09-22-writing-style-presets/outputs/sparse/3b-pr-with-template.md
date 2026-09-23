## Summary

ABC-481: cache per-user settings

adds a per-user settings cache and clears it on write.

**Cache** (`src/settings/`)

- `cache.ts`: per-user cache keyed on `(tenantId, userId)`; `clearSettings(tenantId, userId)` evicts one entry.
- `load.ts`: `loadSettings` throws `SettingsNotFound` instead of returning `undefined`.

**API**

- `api/settings.ts`: PATCH handler calls `clearSettings` after a write.

**Callers**

- Renames `getUserPrefs` to `getSettings` in three callers.

**Follow-up**

- Cache size limit: ABC-490.

## Checklist
- [x] Behind a feature flag, or N/A with a reason: N/A, no user-facing change
- [x] Tests added or updated

## Verification

9 new tests in `cache.test.ts`, settings suite 142/142 green; by hand, t2's u7 shows t2's theme after t1's u7 loads first.

- https://preview-481.storefront.example.com
