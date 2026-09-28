# Fixture 3a: write the PR description

Write the description for your PR in `acme/storefront` (ticket ABC-481). The
repo has no PR template.

What the branch does:
- `src/settings/cache.ts`: per-user settings cache keyed on `(tenantId,
  userId)`; `clearSettings(tenantId, userId)` evicts one entry.
- `src/settings/load.ts`: `loadSettings` now throws `SettingsNotFound`
  instead of returning `undefined`.
- `src/api/settings.ts`: the PATCH handler calls `clearSettings` after a
  write.
- Renamed `getUserPrefs` to `getSettings` in three callers.
- Left for later: cache size limit (ABC-490).

Tests: 9 new tests in `cache.test.ts`; full settings suite 142/142 green.
Checked by hand: settings page for tenant t2 user u7 shows t2's theme after
t1's u7 loads first.
Preview: https://preview-481.storefront.example.com
