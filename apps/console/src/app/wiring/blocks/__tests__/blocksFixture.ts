import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { BlocksPayload } from '../../../../server/blocksPayload';

/** Read from disk, resolved from this file so any cwd works: the lint wall
    bars a value import from `src/server`. */
export const miniPayload: BlocksPayload = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../server/fixtures/design/blocks.mini.json'),
    'utf8'
  )
);
