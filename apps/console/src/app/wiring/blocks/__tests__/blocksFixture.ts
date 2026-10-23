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

/** mini with ship's include shape: a heading block whose one child is the
    shared tree. */
export function withInclude(): BlocksPayload {
  const payload = structuredClone(miniPayload);
  const notes = payload.blocks.find(b => b.id === 'mini/notes')!;
  payload.blocks.push(
    {
      ...notes,
      id: 'mini/gate-protocol',
      title: 'Gate protocol',
      label: 'Gate protocol',
      summary: '',
      props: [],
    },
    {
      ...notes,
      id: 'gate-protocol',
      parentId: 'mini/gate-protocol',
      kind: 'shared',
      title: 'Gate protocol',
      label: 'Gate protocol',
      summary: 'How a gate asks.',
      props: [],
    },
    {
      ...notes,
      id: 'gate-protocol/ask',
      parentId: 'gate-protocol',
      kind: 'shared',
      title: 'Ask',
      label: 'Ask',
      props: [],
    }
  );
  payload.includes = [{ name: 'gate-protocol', blockId: 'mini/gate-protocol' }];
  return payload;
}
