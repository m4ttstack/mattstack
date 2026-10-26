import { describe, expect, it } from 'vitest';

import { miniPayload } from '../__tests__/blocksFixture';
import { crumbsOf, zoomOf } from './zoom';

const block = (id: string) => miniPayload.blocks.find(b => b.id === id)!;

describe('zoomOf', () => {
  it('reads no block as the skill level', () => {
    expect(zoomOf(miniPayload, null)).toEqual({
      zoom: { level: 'skill' },
      missing: null,
    });
  });

  it('reads the root id as the skill level', () => {
    expect(zoomOf(miniPayload, 'mini')).toEqual({
      zoom: { level: 'skill' },
      missing: null,
    });
  });

  it('reads a block with children as a parent', () => {
    expect(zoomOf(miniPayload, 'mini/run')).toEqual({
      zoom: { level: 'parent', block: block('mini/run') },
      missing: null,
    });
  });

  it('reads a leaf as a block', () => {
    expect(zoomOf(miniPayload, 'mini/gate')).toEqual({
      zoom: { level: 'block', block: block('mini/gate') },
      missing: null,
    });
  });

  it('falls back to the skill level for an unknown id and names it', () => {
    expect(zoomOf(miniPayload, 'mini/nope')).toEqual({
      zoom: { level: 'skill' },
      missing: 'mini/nope',
    });
  });
});

describe('crumbsOf', () => {
  it('starts at the skill name, then each block down to this one', () => {
    expect(crumbsOf(miniPayload, block('mini/run/check'))).toEqual([
      { id: null, label: 'mini' },
      { id: 'mini/run', label: 'Run' },
      { id: 'mini/run/check', label: 'Check' },
    ]);
  });

  it('is only the skill name with no block', () => {
    expect(crumbsOf(miniPayload, null)).toEqual([{ id: null, label: 'mini' }]);
  });
});
