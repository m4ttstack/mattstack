/**
 * Local helper for run.js (the server itself is `scripts/parity/serve.ts`).
 *
 *   bun scripts/parity/harness.ts
 *
 * Also the app config the compare CLI reads: `bun scripts/parity/compare.ts --app boxscore`.
 */
import { join } from 'node:path';

import type { ParityApp } from '../../../../scripts/parity/config';
import { startHarness } from '../../../../scripts/parity/serve';
import { BOARDS, type Scenario } from './boards';

const DESIGN_DIR = join(
  import.meta.dirname,
  '../../../../docs/apps/design/boxscore'
);

export const app: ParityApp<Scenario> = {
  boards: BOARDS,
  designDir: join(DESIGN_DIR, 'parity'),
  penPath: join(DESIGN_DIR, 'boxscore.pen'),
  harnessPort: 11096,
  appOrigin: 'http://localhost:5305',
};

if (import.meta.main) startHarness(app);
