import { mattstackVite } from '@mattstack/app-kit/vite';
import { defineConfig } from 'vitest/config';

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
