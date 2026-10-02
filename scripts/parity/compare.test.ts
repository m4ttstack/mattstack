import { describe, expect, it } from 'bun:test';

import {
  compare,
  normColor,
  visibleOnly,
  withoutNestedRoots,
} from './compare';
import type { ParityNode } from './config';

const n = (key: string, o: Partial<ParityNode> = {}): ParityNode => ({
  key,
  kind: 'box' as const,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  fill: null,
  stroke: null,
  color: null,
  text: null,
  ...o,
});

describe('parity compare', () => {
  it('passes identical trees', () => {
    expect(compare([n('A')], [n('A')], { dynamicText: [] })).toEqual([]);
  });
  it('flags a box off by 2px', () => {
    expect(compare([n('A')], [n('A', { x: 2 })], { dynamicText: [] })).toEqual([
      { key: 'A', field: 'x', design: '0', app: '2' },
    ]);
  });
  it('tolerates text width only', () => {
    expect(
      compare(
        [n('T', { kind: 'text', w: 40, text: 'Hi' })],
        [n('T', { kind: 'text', w: 44, text: 'Hi' })],
        { dynamicText: [] }
      )
    ).toEqual([]);
    expect(
      compare(
        [n('T', { kind: 'text', h: 14, text: 'Hi' })],
        [n('T', { kind: 'text', h: 16, text: 'Hi' })],
        { dynamicText: [] }
      ).map(m => m.field)
    ).toEqual(['h']);
  });
  it('normalises colours', () => {
    expect(
      compare(
        [n('A', { fill: '#111113' })],
        [n('A', { fill: 'rgb(17, 17, 19)' })],
        { dynamicText: [] }
      )
    ).toEqual([]);
  });
  it('reports missing and extra keys', () => {
    const r = compare([n('A')], [n('B')], { dynamicText: [] });
    expect(r.map(m => m.field)).toEqual(['missing', 'extra']);
  });
  it('prefix-matches dynamic text', () => {
    expect(
      compare(
        [n('Fresh Label', { kind: 'text', text: 'Synced 4 min ago' })],
        [n('Fresh Label', { kind: 'text', text: 'Synced 5 min ago' })],
        { dynamicText: ['Fresh Label'] }
      )
    ).toEqual([]);
  });
  it('matches dynamic text by key suffix only, and still checks the words', () => {
    expect(
      compare(
        [n('RS Head/RS Sub', { kind: 'text', text: 'No progress for 42s' })],
        [n('RS Head/RS Sub', { kind: 'text', text: 'No news for 21s' })],
        { dynamicText: ['RS Sub'] }
      ).map(m => m.field)
    ).toEqual(['text']);
  });
  it('flags text, stroke and opacity differences', () => {
    const r = compare(
      [n('A', { kind: 'text', text: 'One', stroke: '#363a3f', opacity: 0.35 })],
      [n('A', { kind: 'text', text: 'Two', stroke: null, opacity: 1 })],
      { dynamicText: [] }
    );
    expect(r.map(m => m.field)).toEqual(['stroke', 'opacity', 'text']);
  });
  it('reads an en or em dash in a key as a hyphen', () => {
    const [en, em] = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
    expect(
      compare(
        [n(`text · L1${en}15`), n(`text · L16${em}20`)],
        [n('text · L1-15'), n('text · L16-20')],
        { dynamicText: [] }
      )
    ).toEqual([]);
  });
  it('flags a duplicate app key', () => {
    const r = compare([n('A')], [n('A'), n('A')], { dynamicText: [] });
    expect(r).toEqual([
      { key: 'A', field: 'duplicate', design: '1', app: '2' },
    ]);
  });
});

describe('normColor', () => {
  it.each([
    ['#fff', 'rgb(255, 255, 255)'],
    ['#111113', 'rgb(17, 17, 19)'],
    ['#3e63dd80', 'rgba(62, 99, 221, 0.5)'],
    ['#3e63ddff', 'rgb(62, 99, 221)'],
    ['rgb(1, 2, 3)', 'rgb(1, 2, 3)'],
    ['rgba(1, 2, 3, 0.25)', 'rgba(1, 2, 3, 0.25)'],
    ['rgba(1, 2, 3, 1)', 'rgb(1, 2, 3)'],
    ['color(srgb 1 0.5 0 / 0.5)', 'rgba(255, 128, 0, 0.5)'],
  ])('%s -> %s', (input, out) => {
    expect(normColor(input)).toBe(out);
  });
  it('reads a fully transparent colour as none', () => {
    expect(normColor('rgba(0, 0, 0, 0)')).toBeNull();
    expect(normColor('transparent')).toBeNull();
    expect(normColor(null)).toBeNull();
  });
});

describe('visibleOnly', () => {
  const raw = (
    name: string,
    parent: number,
    o: Partial<ParityNode> = {}
  ): ParityNode => n(name, { name, parent, tag: 'div', ...o });

  it('drops invisible frames and rekeys through them', () => {
    const nodes = [
      raw('Board', -1, { fill: '#111113' }),
      raw('Row', 0, { stroke: '#363a3f' }),
      raw('Cell #', 1),
      raw('Pos', 2, { kind: 'text', text: '1' }),
      raw('Row', 0, { stroke: '#363a3f' }),
      raw('Cell #', 4),
      raw('Pos', 5, { kind: 'text', text: '2' }),
      raw('Spacer', 0),
      raw('Icon', 0, { tag: 'svg' }),
    ];
    expect(visibleOnly(nodes).map(v => v.key)).toEqual([
      'Board',
      'Row[0]',
      'Row[0]/Pos',
      'Row[1]',
      'Row[1]/Pos',
      'Icon',
    ]);
  });

  it('indexes names that only collide once invisible frames are flattened', () => {
    const nodes = [
      raw('Board', -1),
      raw('Group A', 0),
      raw('Dot', 1, { fill: '#fff' }),
      raw('Group B', 0),
      raw('Dot', 3, { fill: '#fff' }),
    ];
    expect(visibleOnly(nodes).map(v => v.key)).toEqual([
      'Board',
      'Dot[0]',
      'Dot[1]',
    ]);
  });
});

describe('withoutNestedRoots', () => {
  const raw = (
    name: string,
    parent: number,
    o: Partial<ParityNode> = {}
  ): ParityNode => n(name, { name, parent, tag: 'div', ...o });

  it('keys through another root that paints nothing, as the design does', () => {
    const nodes = [
      raw('Stage', -1),
      raw('Focus header', 0),
      raw('title', 1, { kind: 'text', text: 'plan' }),
      raw('badge', 1, { fill: '#e8e8ec' }),
      raw('Spacer', 0),
      raw('pill', 4, { fill: '#fff' }),
    ];
    expect(
      withoutNestedRoots(nodes, ['Stage', 'Focus header']).map(v => v.key)
    ).toEqual(['Stage', 'title', 'badge', 'Spacer', 'Spacer/pill']);
  });

  it('keeps a nested root that paints, and the compared root itself', () => {
    const nodes = [
      raw('Focus header', -1),
      raw('Banner', 0, { fill: '#fff' }),
      raw('l', 1, { kind: 'text', text: 'unsynced' }),
    ];
    expect(
      withoutNestedRoots(nodes, ['Focus header', 'Banner']).map(v => v.key)
    ).toEqual(['Focus header', 'Banner', 'Banner/l']);
  });
});
