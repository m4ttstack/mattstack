# Fixture 3b: write the PR description (repo has a template)

Write the description for your PR in `acme/storefront` (ticket ABC-481).
The repo's PR template, which must be kept:

```markdown
## Summary

## Checklist
- [ ] Behind a feature flag, or N/A with a reason
- [ ] Tests added or updated

## Verification
```

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
