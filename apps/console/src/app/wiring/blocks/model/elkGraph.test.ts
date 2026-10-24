import type { ElkNode } from 'elkjs/lib/elk-api';
import { describe, expect, it } from 'vitest';

import { bundledEngine } from '../layoutEngine';
import { fromElk, toElk, type LayoutInput } from './elkGraph';

const engine = bundledEngine();

const node = (
  id: string,
  extra: Partial<LayoutInput['nodes'][number]> = {}
) => ({
  id,
  width: 120,
  height: 40,
  ...extra,
});

const chain: LayoutInput = {
  nodes: [node('a'), node('b'), node('c')],
  edges: [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'bc', source: 'b', target: 'c' },
  ],
};

const compound: LayoutInput = {
  nodes: [
    node('start'),
    { id: 'fold', width: 0, height: 0 },
    node('inner1', { parent: 'fold' }),
    node('inner2', { parent: 'fold' }),
    node('end'),
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'inner1' },
    { id: 'e2', source: 'inner1', target: 'inner2' },
    { id: 'e3', source: 'inner2', target: 'end' },
  ],
};

describe('toElk', () => {
  it("toElk puts a node with a parent inside its parent's children", () => {
    const root = toElk(compound);
    expect(root.children?.map(c => c.id)).toEqual(['start', 'fold', 'end']);
    const fold = root.children?.find(c => c.id === 'fold');
    expect(fold?.children?.map(c => c.id)).toEqual(['inner1', 'inner2']);
  });

  it('toElk gives a node fixed top and bottom ports at anchorX', () => {
    const root = toElk({
      nodes: [node('a', { anchorX: 30 }), node('b')],
      edges: [],
    });
    const [a, b] = root.children ?? [];
    expect(a.layoutOptions?.['org.eclipse.elk.portConstraints']).toBe(
      'FIXED_POS'
    );
    expect(
      a.ports?.map(p => [
        p.layoutOptions?.['org.eclipse.elk.port.side'],
        p.x,
        p.y,
      ])
    ).toEqual([
      ['NORTH', 30, 0],
      ['SOUTH', 30, 40],
    ]);
    expect(b.ports?.map(p => p.x)).toEqual([60, 60]);
  });
});

describe('fromElk', () => {
  it('fromElk returns absolute boxes for compound children', () => {
    const root: ElkNode = {
      id: 'root',
      width: 300,
      height: 200,
      children: [
        {
          id: 'fold',
          x: 50,
          y: 20,
          width: 200,
          height: 150,
          children: [{ id: 'inner', x: 10, y: 30, width: 120, height: 40 }],
        },
      ],
      edges: [],
    };
    const out = fromElk(root);
    expect(out.width).toBe(300);
    expect(out.height).toBe(200);
    expect(out.nodes.fold).toEqual({ x: 50, y: 20, width: 200, height: 150 });
    expect(out.nodes.inner).toEqual({ x: 60, y: 50, width: 120, height: 40 });
  });
});

describe('layout', () => {
  it('a three-node chain runs top to bottom, rows 36px apart', async () => {
    const out = await engine.layout(chain);
    const { a, b, c } = out.nodes;
    expect(b.y - (a.y + a.height)).toBe(36);
    expect(c.y - (b.y + b.height)).toBe(36);
    expect(new Set([a.x, b.x, c.x]).size).toBe(1);
  });

  it('every edge segment is horizontal or vertical', async () => {
    const out = await engine.layout({
      nodes: [
        node('top'),
        node('left'),
        node('right', { width: 200 }),
        node('join'),
      ],
      edges: [
        {
          id: 'tl',
          source: 'top',
          target: 'left',
          label: { text: 'yes', width: 24, height: 14 },
        },
        {
          id: 'tr',
          source: 'top',
          target: 'right',
          label: { text: 'no', width: 18, height: 14 },
        },
        { id: 'lj', source: 'left', target: 'join' },
        { id: 'rj', source: 'right', target: 'join' },
      ],
    });
    const segments = Object.values(out.edges).flatMap(({ points }) =>
      points.slice(1).map((p, i) => [points[i], p])
    );
    expect(segments.length).toBeGreaterThan(4);
    for (const [[x1, y1], [x2, y2]] of segments) {
      expect(x1 === x2 || y1 === y2).toBe(true);
    }
    expect(out.edges.tl.label).not.toBeNull();
    expect(out.edges.lj.label).toBeNull();
  });

  it('an edge leaves its source at anchorX', async () => {
    const out = await engine.layout({
      nodes: [node('a', { anchorX: 20 }), node('b')],
      edges: [{ id: 'ab', source: 'a', target: 'b' }],
    });
    const a = out.nodes.a;
    expect(out.edges.ab.points[0]).toEqual([a.x + 20, a.y + a.height]);
  });

  it("a compound node's box contains its children", async () => {
    const out = await engine.layout(compound);
    const fold = out.nodes.fold;
    for (const id of ['inner1', 'inner2']) {
      const child = out.nodes[id];
      expect(child.x).toBeGreaterThanOrEqual(fold.x);
      expect(child.y).toBeGreaterThanOrEqual(fold.y);
      expect(child.x + child.width).toBeLessThanOrEqual(fold.x + fold.width);
      expect(child.y + child.height).toBeLessThanOrEqual(fold.y + fold.height);
    }
    expect(out.nodes.start.y + out.nodes.start.height).toBeLessThanOrEqual(
      fold.y
    );
    expect(out.nodes.end.y).toBeGreaterThanOrEqual(fold.y + fold.height);
    const inner1 = out.nodes.inner1;
    expect(out.edges.e2.points[0]).toEqual([
      inner1.x + inner1.width / 2,
      inner1.y + inner1.height,
    ]);
  });
});
