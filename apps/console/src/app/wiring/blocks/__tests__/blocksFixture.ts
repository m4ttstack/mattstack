import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { BlocksPayload } from '../../../../server/blocksPayload';

/** Read from disk, relative to the package root vitest runs in: the lint wall
    bars a value import from `src/server`. */
export const miniPayload: BlocksPayload = JSON.parse(
  readFileSync(
    resolve(process.cwd(), 'src/server/fixtures/design/blocks.mini.json'),
    'utf8'
  )
);
