import { describe, expect, it } from 'vitest';

import { miniPayload } from '../__tests__/blocksFixture';
import type {
  BlocksPayload,
  LayerColor,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import { sidebarRows } from './sidebar';

const base = miniPayload.blocks[0]!;

const block = (
  id: string,
  parentId: string | null,
  extra: Partial<PayloadBlock> = {}
): PayloadBlock => ({
  ...base,
  id,
  parentId,
  depth: id.split('/').length - 1,
  title: null,
  label: id,
  kind: 'note',
  props: [],
  headless: false,
  ...extra,
});

const withValues = (...colors: LayerColor[]): PayloadBlock['props'] => [
  {
    name: 'p',
    merge: 'add',
    default: null,
    contract: null,
    marker: null,
    fromDefault: false,
    values: colors.map(color => ({
      layer: 'pack',
      color,
      binding: 'b',
      path: 'p',
      lines: 1,
    })),
  },
];

const payloadOf = (...blocks: PayloadBlock[]): BlocksPayload => ({
  ...miniPayload,
  blocks: [block('s', null), ...blocks],
});

describe('sidebarRows', () => {
  it('lists the root children closed when nothing is selected', () => {
    expect(sidebarRows(miniPayload, null)).toEqual([
      {
        id: 'mini/run',
        depth: 0,
        label: 'Run',
        glyph: 'step',
        dots: [],
        count: 2,
        open: false,
        selected: false,
      },
      {
        id: 'mini/gate',
        depth: 0,
        label: 'Gate',
        glyph: 'gate',
        dots: [],
        count: null,
        open: false,
        selected: false,
      },
      {
        id: 'mini/notes',
        depth: 0,
        label: 'Notes',
        glyph: 'note',
        dots: [],
        count: null,
        open: false,
        selected: false,
      },
    ]);
  });

  it('opens only the section holding the selection, in preorder', () => {
    const rows = sidebarRows(miniPayload, 'mini/run/check');
    expect(rows.map(r => [r.id, r.depth, r.open, r.selected])).toEqual([
      ['mini/run', 0, true, false],
      ['mini/run/guard', 1, false, false],
      ['mini/run/check', 1, false, true],
      ['mini/gate', 0, false, false],
      ['mini/notes', 0, false, false],
    ]);
  });

  it('labels a headless block with no label from its id', () => {
    const rows = sidebarRows(
      payloadOf(
        block('s/a', 's'),
        block('s/a/pre-check', 's/a', { label: '', headless: true })
      ),
      's/a'
    );
    expect(rows.map(r => r.label)).toEqual(['s/a', 'Pre check']);
  });

  it('draws dots from the value colour, org before team, never mattstack', () => {
    const rows = sidebarRows(
      payloadOf(
        block('s/a', 's', {
          props: withValues('team', 'mattstack', 'org', 'team'),
        }),
        block('s/b', 's', { props: withValues('mattstack') })
      ),
      null
    );
    expect(rows.map(r => r.dots)).toEqual([['org', 'team'], []]);
  });

  it('folds top-level shared blocks into one last row', () => {
    const rows = sidebarRows(
      payloadOf(
        block('s/x', 's', { kind: 'shared' }),
        block('s/a', 's'),
        block('s/y', 's', { kind: 'shared' })
      ),
      null
    );
    expect(rows.map(r => r.id)).toEqual(['s/a', 'shared']);
    expect(rows[1]).toEqual({
      id: 'shared',
      depth: 0,
      label: 'Includes',
      glyph: 'shared',
      dots: [],
      count: 2,
      open: false,
      selected: false,
    });
  });

  it('folds a top-level include block, a heading over a shared tree, into the Shared row', () => {
    const payload: BlocksPayload = {
      ...payloadOf(
        block('s/a', 's'),
        block('s/inc', 's'),
        block('inc', 's/inc', { kind: 'shared' })
      ),
      includes: [{ name: 'inc', blockId: 's/inc' }],
    };
    const rows = sidebarRows(payload, null);
    expect(rows.map(r => [r.id, r.count])).toEqual([
      ['s/a', null],
      ['shared', 1],
    ]);
  });

  it('keeps a nested shared block under its parent', () => {
    const rows = sidebarRows(
      payloadOf(block('s/a', 's'), block('s/a/x', 's/a', { kind: 'shared' })),
      's/a/x'
    );
    expect(rows.map(r => [r.id, r.glyph])).toEqual([
      ['s/a', 'note'],
      ['s/a/x', 'shared'],
    ]);
  });
  it('opens the Shared fold on a selected top-level shared block and marks it', () => {
    const rows = sidebarRows(
      payloadOf(
        block('s/a', 's'),
        block('s/x', 's', { kind: 'shared' }),
        block('s/x/inner', 's/x', { kind: 'shared' }),
        block('s/y', 's', { kind: 'shared' })
      ),
      's/x/inner'
    );
    expect(rows.map(r => [r.id, r.depth, r.open, r.selected])).toEqual([
      ['s/a', 0, false, false],
      ['shared', 0, true, false],
      ['s/x', 1, true, false],
      ['s/x/inner', 2, false, true],
      ['s/y', 1, false, false],
    ]);
  });

  it('opens a row folded open by hand, and the Shared fold by its own id', () => {
    const rows = sidebarRows(
      payloadOf(
        block('s/a', 's'),
        block('s/a/b', 's/a'),
        block('s/x', 's', { kind: 'shared' })
      ),
      null,
      new Set(['s/a', 'shared'])
    );
    expect(rows.map(r => [r.id, r.open])).toEqual([
      ['s/a', true],
      ['s/a/b', false],
      ['shared', true],
      ['s/x', false],
    ]);
  });

  it('folds a row that holds the selection when it is toggled by hand', () => {
    const rows = sidebarRows(
      payloadOf(block('s/a', 's'), block('s/a/b', 's/a')),
      's/a/b',
      new Set(['s/a'])
    );
    expect(rows.map(r => [r.id, r.open])).toEqual([['s/a', false]]);
  });
});
