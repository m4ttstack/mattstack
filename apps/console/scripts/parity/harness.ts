/**
 * Local helper for run.js (the server itself is `scripts/parity/serve.ts`).
 *
 *   bun apps/console/scripts/parity/harness.ts
 *
 * Also the app config the compare CLI reads: `bun scripts/parity/compare.ts --app console`.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ParityApp } from '../../../../scripts/parity/config';
import { startHarness } from '../../../../scripts/parity/serve';
import { BOARDS, type Scenario } from './boards';

const DESIGN_DIR = join(
  import.meta.dirname,
  '../../../../docs/apps/design/console'
);

export const app: ParityApp<Scenario> = {
  boards: BOARDS,
  designDir: join(DESIGN_DIR, 'parity'),
  penPath: join(DESIGN_DIR, 'console.pen'),
  harnessPort: 11098,
  appOrigin: 'http://localhost:5307',
  viewportWidth: 1680,
  outputDir: join(homedir(), '.fast-browser', 'output', 'parity', 'console'),
};

if (import.meta.main) startHarness(app);
