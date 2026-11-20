import { mattstackVite } from '@mattstack/app-kit/vite';
import { defineConfig } from 'vitest/config';

// Date assertions are written for UTC and en-US, the CI runners' defaults.
// A worker reads its locale once at start, so these are set here, before
// vitest forks its workers, not in a setup file.
if (process.env.VITEST) {
  process.env.TZ = 'UTC';
  process.env.LANG = 'en_US.UTF-8';
  process.env.LC_ALL = 'en_US.UTF-8';
}

// CONSOLE_API_PORT points the dev proxy at a second server (the parity
// runbook's design-fixture server) instead of the dev server on 11011.
const base = mattstackVite({
  apiPort: Number(process.env.CONSOLE_API_PORT ?? 11011),
});

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [...(base.test?.include ?? []), 'scripts/parity/**/*.test.ts'],
  },
});
