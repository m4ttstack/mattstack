import { describe, expect, it } from 'vitest';

import { miniPayload } from '../__tests__/blocksFixture';
import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import { blockMap, blockStrip, linesOf, lineTotals } from './layers';

const blockOf = (payload: BlocksPayload, id: string): PayloadBlock =>
  payload.blocks.find(block => block.id === id)!;

/** mini with an org base: it replaces `tiering` on gate, and both org and
    team pass a `style` value on notes. */
function withOrg(): BlocksPayload {
  const payload = structuredClone(miniPayload);
  payload.layers.splice(1, 0, { name: 'acme', label: 'base', color: 'org' });
  const gate = blockOf(payload, 'mini/gate');
  const tiering = gate.props[0]!;
  tiering.fromDefault = false;
  tiering.values = [
    { layer: 'base', color: 'org', binding: 'tiering', path: 'x', lines: 2 },
  ];
  gate.segments[1] = {
    layer: 'base',
    color: 'org',
    prop: 'tiering',
    text: 'org one\norg two',
  };
  const notes = blockOf(payload, 'mini/notes');
  notes.props[0]!.values = [
    { layer: 'base', color: 'org', binding: 'style', path: 'y', lines: 1 },
    { layer: 'pack', color: 'team', binding: 'style', path: 'z', lines: 1 },
  ];
  return payload;
}

describe('linesOf', () => {
  it('counts lines in a segment, ignoring one trailing newline', () => {
    expect(linesOf('')).toBe(0);
    expect(linesOf('one')).toBe(1);
    expect(linesOf('one\ntwo\n')).toBe(2);
  });
});

describe('blockMap', () => {
  it('fills a square by the roles that pass a value on the block', () => {
    const { squares } = blockMap(miniPayload, null);
    const fill = (id: string) => squares.find(s => s.id === id)?.fill;
    expect(fill('mini')).toBe('team');
    expect(fill('mini/gate')).toBe('mattstack');
    expect(squares).toHaveLength(miniPayload.blocks.length);
  });

  it('groups squares by the skill sections, the root first under the skill name', () => {
    const { squares } = blockMap(miniPayload, null);
    expect(squares.map(s => [s.id, s.section])).toEqual([
      ['mini', miniPayload.skill],
      ['mini/run', 'Run'],
      ['mini/run/guard', 'Run'],
      ['mini/run/check', 'Run'],
      ['mini/gate', 'Notes'],
      ['mini/notes', 'Notes'],
    ]);
  });

  it('lists each fill present with its count', () => {
    expect(blockMap(miniPayload, null).legend).toEqual([
      { fill: 'mattstack', count: 5 },
      { fill: 'team', count: 1 },
    ]);
  });

  it('marks org, team and both on an org payload', () => {
    const { squares, legend } = blockMap(withOrg(), null);
    const fill = (id: string) => squares.find(s => s.id === id)?.fill;
    expect(fill('mini/gate')).toBe('org');
    expect(fill('mini/notes')).toBe('both');
    expect(legend).toEqual([
      { fill: 'mattstack', count: 3 },
      { fill: 'org', count: 1 },
      { fill: 'team', count: 1 },
      { fill: 'both', count: 1 },
    ]);
  });

  it('scopes to a block and its descendants, sectioned under that block', () => {
    const run = blockOf(miniPayload, 'mini/run');
    expect(
      blockMap(miniPayload, run).squares.map(s => [s.id, s.section])
    ).toEqual([
      ['mini/run', 'Run'],
      ['mini/run/guard', 'Run'],
      ['mini/run/check', 'Run'],
    ]);
  });
});

describe('lineTotals', () => {
  it('sums lines from segments by role, the Mermaid graph into mattstack', () => {
    expect(lineTotals(miniPayload, null)).toEqual([
      { layer: 'mattstack', label: 'default', count: 27 },
      { layer: 'team', label: 'pack', count: 2 },
    ]);
  });

  it('counts a replaced default from segments toward the replacing layer', () => {
    expect(lineTotals(withOrg(), null)).toEqual([
      { layer: 'mattstack', label: 'default', count: 26 },
      { layer: 'org', label: 'base', count: 2 },
      { layer: 'team', label: 'pack', count: 2 },
    ]);
  });

  it('counts a scope from segments of that block and its descendants', () => {
    const run = blockOf(miniPayload, 'mini/run');
    expect(lineTotals(miniPayload, run)).toEqual([
      { layer: 'mattstack', label: 'default', count: 7 },
    ]);
  });
});

describe('blockStrip', () => {
  it('reads a block from segments in order, a cleared prop as its default', () => {
    expect(blockStrip(blockOf(miniPayload, 'mini/gate'))).toEqual([
      { layer: 'mattstack', lines: 3, label: 'engine text' },
      { layer: 'mattstack', lines: 1, label: 'tiering · default' },
    ]);
  });

  it('names the layer that passes a value, from segments', () => {
    expect(blockStrip(blockOf(miniPayload, 'mini'))).toEqual([
      { layer: 'mattstack', lines: 12, label: 'engine text' },
      { layer: 'team', lines: 2, label: 'rules · pack' },
    ]);
  });
});
