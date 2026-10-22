/**
 * Every shipped migration id, in run order. A leaf with no imports: the
 * daemon's version ping reads it and must not load the setup apply chain.
 * `__tests__/migrations-ids.test.ts` pins it to `MIGRATIONS`.
 */
export const MIGRATION_IDS: readonly string[] = [
  "2026-10-01-board-peer-trigger",
  "2026-10-01-unset-board-default-pack",
  "2026-10-02-retire-switchboard-url",
  "2026-10-07-sdm-resources-key",
  "2026-10-10-board-cron-by-tool",
  "2026-10-10-import-legacy-settings",
  "2026-10-11-import-app-settings",
  "2026-10-17-enable-team-pack",
  "2026-10-22-retire-old-bg-server",
];
