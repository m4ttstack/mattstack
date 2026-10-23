import { describe, expect, it } from 'vitest';

import { shipShaped } from '../__tests__/aroundFixtures';
import { miniPayload, shipPayload } from '../__tests__/blocksFixture';
import { aroundBlock } from './around';
import {
  AROUND,
  aroundLayout,
  layerNodes,
  wholeLayout,
  type AroundNode,
} from './aroundLayout';

const sub = aroundBlock(shipShaped, 'fast_checks');

describe('layerNodes', () => {
  it('puts in-neighbours above the focus and the rest below by longest path', () => {
    expect(Object.fromEntries(layerNodes(sub, 'fast_checks'))).toEqual({
      tree_dirty: 0,
      commit_named: 0,
      stash_them: 0,
      rebase_status: 0,
      fast_checks: 1,
      fix_test_first: 2,
      checks_pass: 2,
      fix_rounds_left: 3,
    });
  });

  it('terminates on a cycle that skips the focus', () => {
    const looped = {
      nodes: sub.nodes,
      edges: [
        ...sub.edges,
        { ...sub.edges[0], from: 'checks_pass', to: 'fix_rounds_left' },
        { ...sub.edges[0], from: 'fix_rounds_left', to: 'checks_pass' },
      ],
    };

    expect(layerNodes(looped, 'fast_checks').get('fix_rounds_left')).toBe(3);
  });
});

describe('aroundLayout', () => {
  const layout = aroundLayout(sub, 'fast_checks');
  const nodeAt = (id: string) => {
    const node = layout.nodes.find(candidate => candidate.id === id);
    if (!node) throw new Error(`no node ${id}`);
    return node;
  };

  it('places in-neighbours above the focus and out-neighbours below', () => {
    const focusY = nodeAt('fast_checks').position.y;

    for (const id of ['tree_dirty', 'commit_named', 'stash_them']) {
      expect(nodeAt(id).position.y).toBeLessThan(focusY);
    }
    for (const id of ['checks_pass', 'fix_test_first', 'fix_rounds_left']) {
      expect(nodeAt(id).position.y).toBeGreaterThan(focusY);
    }
  });

  it('types a node by whether it opens a block and marks the focus', () => {
    expect(nodeAt('commit_named')).toMatchObject({
      type: 'block',
      data: {
        label: 'Commit named',
        shape: 'box',
        blockId: 'ship/flow/commit-named',
        focus: false,
      },
    });
    expect(nodeAt('tree_dirty')).toMatchObject({
      type: 'graphOnly',
      data: { blockId: null, shape: 'diamond', focus: false },
    });
    expect(nodeAt('fast_checks').data.focus).toBe(true);
  });

  it('labels a node without a label by its id', () => {
    const bare = aroundLayout(
      {
        nodes: [{ ...sub.nodes[0], id: 'run_step', label: null }],
        edges: [],
      },
      'run_step'
    );

    expect(bare.nodes[0].data.label).toBe('run_step');
  });

  it('draws no edge between two nodes on the same row', () => {
    const rowOf = (id: string) => nodeAt(id).position.y;

    for (const edge of layout.edges) {
      expect(rowOf(edge.source)).not.toBe(rowOf(edge.target));
    }
    expect(layout.edges).toHaveLength(9);
    expect(
      layout.edges.some(
        edge => edge.source === 'tree_dirty' && edge.target === 'commit_named'
      )
    ).toBe(false);
  });

  it('carries edge labels and the dashed style', () => {
    const edge = (from: string, to: string) =>
      layout.edges.find(
        candidate => candidate.source === from && candidate.target === to
      );

    expect(edge('fix_test_first', 'fast_checks')).toMatchObject({
      label: 'fix, then re-check',
      data: { dashed: false },
    });
    expect(edge('fast_checks', 'fix_test_first')).toMatchObject({
      label: 'red test',
      data: { dashed: true },
    });
    expect(edge('commit_named', 'fast_checks')?.label).toBeUndefined();
  });
});

describe('aroundLayout with a row cap', () => {
  it('wraps a row wider than the cap onto more rows, pushing the rest down', () => {
    const capped = aroundLayout(sub, 'fast_checks', 3);
    const y = (id: string) =>
      capped.nodes.find(node => node.id === id)!.position.y;
    const stepY = AROUND.nodeH + AROUND.rowGap;
    const above = ['tree_dirty', 'commit_named', 'stash_them', 'rebase_status'];

    expect(new Set(above.map(y))).toEqual(new Set([0, stepY]));
    expect(y('fast_checks')).toBe(2 * stepY);
    expect(y('fix_rounds_left')).toBe(4 * stepY);
    expect(capped.rows).toBe(5);
    expect(
      Math.max(
        ...capped.nodes
          .filter(node => y(node.id) === 0)
          .map(node => Math.abs(node.position.x + AROUND.nodeW / 2))
      )
    ).toBeLessThanOrEqual(AROUND.nodeW + AROUND.columnGap);
  });

  it('sets a wrapped row between the columns above it, so drops pass clear', () => {
    const capped = aroundLayout(sub, 'fast_checks', 3);
    const stepY = AROUND.nodeH + AROUND.rowGap;
    const centres = (y: number) =>
      capped.nodes
        .filter(node => node.position.y === y)
        .map(node => node.position.x + AROUND.nodeW / 2);
    for (const lower of centres(stepY)) {
      for (const drop of centres(0)) {
        expect(Math.abs(lower - drop)).toBeGreaterThan(AROUND.nodeW / 2);
      }
    }
  });

  it('wraps a layer onto as many rows as the cap needs, never widening a row past it', () => {
    const capped = aroundLayout(sub, 'fast_checks', 2);
    const stepY = AROUND.nodeH + AROUND.rowGap;
    const y = (id: string) =>
      capped.nodes.find(node => node.id === id)!.position.y;
    const above = ['tree_dirty', 'commit_named', 'stash_them', 'rebase_status'];

    expect(new Set(above.map(y))).toEqual(new Set([0, stepY, 2 * stepY]));
    expect(y('fast_checks')).toBe(3 * stepY);
    const perRow = new Map<number, number>();
    for (const node of capped.nodes) {
      perRow.set(node.position.y, (perRow.get(node.position.y) ?? 0) + 1);
    }
    expect(Math.max(...perRow.values())).toBeLessThanOrEqual(2);
  });

  it('sends a drop that would pass behind a lower node down a side channel', () => {
    const capped = aroundLayout(sub, 'fast_checks', 2);
    const centre = (id: string) => {
      const node = capped.nodes.find(candidate => candidate.id === id)!;
      return { x: node.position.x + node.width! / 2, y: node.position.y };
    };
    const routed = capped.edges.filter(edge => edge.target === 'fast_checks');
    expect(routed.length).toBeGreaterThan(0);
    for (const edge of routed) {
      const from = centre(edge.source);
      const to = centre(edge.target);
      const between = capped.nodes.filter(
        node => node.position.y > from.y && node.position.y < to.y
      );
      const blocked = between.some(
        node =>
          Math.abs(node.position.x + node.width! / 2 - from.x) <
          node.width! / 2 + AROUND.columnGap / 2
      );
      if (blocked) {
        const channel = edge.data?.channel;
        expect(channel).toBeDefined();
        for (const node of between) {
          expect(channel!).toBeLessThan(node.position.x);
        }
      } else {
        expect(edge.data?.channel ?? null).toBeNull();
      }
    }
    expect(routed.some(edge => edge.data?.channel != null)).toBe(true);
  });

  it('gives each side-channelled drop its own channel and its own bend', () => {
    const capped = aroundLayout(sub, 'fast_checks', 1);
    const routed = capped.edges.filter(edge => edge.data?.channel != null);
    expect(routed.length).toBeGreaterThan(1);
    const channels = routed.map(edge => edge.data!.channel);
    const lanes = routed.map(edge => edge.data!.lane);
    expect(new Set(channels).size).toBe(routed.length);
    expect(new Set(lanes).size).toBe(routed.length);
  });

  it('lands each edge into a target at its own point, in the order of their sources', () => {
    const layout = aroundLayout(sub, 'fast_checks');
    const x = (id: string) =>
      layout.nodes.find(node => node.id === id)!.position.x;
    const into = layout.edges
      .filter(edge => edge.target === 'fast_checks')
      .sort((a, b) => x(a.source) - x(b.source));
    expect(into.length).toBeGreaterThan(1);
    const lands = into.map(edge => edge.data!.land!);
    expect(new Set(lands).size).toBe(into.length);
    expect([...lands].sort((a, b) => a - b)).toEqual(lands);
    for (const land of lands) {
      expect(Math.abs(land)).toBeLessThan(AROUND.nodeW / 2);
    }
  });

  it('counts one row per layer with no cap', () => {
    expect(aroundLayout(sub, 'fast_checks').rows).toBe(4);
  });
});

describe('wholeLayout', () => {
  const graph = miniPayload.graphs[0];

  it('keeps every side channel within a few lanes of the nodes, however many drops take one', () => {
    const flow = shipPayload.graphs.find(g => g.blockId === 'ship/flow')!;
    const layout = wholeLayout(flow, null, 3);
    const channels = layout.edges
      .map(edge => edge.data?.channel)
      .filter((x): x is number => typeof x === 'number');
    expect(channels.length).toBeGreaterThan(5);
    const left = Math.min(...layout.nodes.map(node => node.position.x));
    expect(left - Math.min(...channels)).toBeLessThanOrEqual(
      AROUND.columnGap / 2 + 4 * 8
    );
  });

  it('lays the whole graph out from its entry, one row per step, from the top', () => {
    const layout = wholeLayout(graph, 'ask_gate');
    const y = (id: string) =>
      layout.nodes.find(node => node.id === id)!.position.y;
    const step = AROUND.nodeH + AROUND.rowGap;

    expect(layout.rows).toBe(4);
    expect([y('start'), y('run_step'), y('ask_gate'), y('finish')]).toEqual([
      0,
      step,
      2 * step,
      3 * step,
    ]);
  });

  it('marks only the highlighted node as the focus', () => {
    const layout = wholeLayout(graph, 'ask_gate');
    expect(
      layout.nodes.filter(node => node.data.focus).map(node => node.id)
    ).toEqual(['ask_gate']);
  });

  it('draws nothing for an empty graph', () => {
    expect(wholeLayout({ nodes: [], edges: [] }, null)).toEqual({
      nodes: [],
      edges: [],
      rows: 0,
    });
  });
});

describe('aroundLayout sizes nodes to their labels', () => {
  // About 7px a character at 13px, the estimate the layout falls back to.
  const measure = (label: string) => label.length * 7;
  const width = (layout: ReturnType<typeof aroundLayout>, id: string) =>
    layout.nodes.find(node => node.id === id)!.width!;

  it('grows a node from 150 to fit its label, and caps it at 240', () => {
    const long = {
      nodes: [
        ...sub.nodes,
        {
          ...sub.nodes[0],
          id: 'wordy',
          label: 'A question whose label runs on well past any sensible width?',
        },
      ],
      edges: [
        ...sub.edges,
        { ...sub.edges[0], from: 'wordy', to: 'fast_checks' },
      ],
    };
    const layout = aroundLayout(long, 'fast_checks', Infinity, { measure });
    expect(width(layout, 'commit_named')).toBe(AROUND.nodeW);
    expect(width(layout, 'rebase_status')).toBeGreaterThan(AROUND.nodeW);
    expect(width(layout, 'wordy')).toBe(AROUND.maxNodeW);
  });

  it('keeps nodes on one row from overlapping, whatever their widths', () => {
    const layout = aroundLayout(sub, 'fast_checks', 2, { measure });
    const rows = new Map<number, AroundNode[]>();
    for (const node of layout.nodes) {
      rows.set(node.position.y, [...(rows.get(node.position.y) ?? []), node]);
    }
    for (const row of rows.values()) {
      const sorted = [...row].sort((a, b) => a.position.x - b.position.x);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        expect(sorted[i]!.position.x).toBeGreaterThanOrEqual(
          prev.position.x + prev.width! + AROUND.columnGap
        );
      }
    }
  });

  it("drops a graph-only label's parenthetical naming the skill in view, keeping the whole label as its title", () => {
    const named = {
      nodes: sub.nodes.map(node =>
        node.id === 'checks_pass'
          ? { ...node, label: 'Checks pass (ship)?' }
          : node.id === 'rebase_status'
            ? { ...node, label: 'Nothing to push (ship re-capture)?' }
            : node
      ),
      edges: sub.edges,
    };
    const layout = aroundLayout(named, 'fast_checks', Infinity, {
      skill: 'ship',
    });
    const data = (id: string) =>
      layout.nodes.find(node => node.id === id)!.data;
    expect(data('checks_pass')).toMatchObject({
      label: 'Checks pass?',
      title: 'Checks pass (ship)?',
    });
    expect(data('rebase_status').label).toBe(
      'Nothing to push (ship re-capture)?'
    );
  });

  it('fits as many nodes on a row as the room holds', () => {
    const topRow = (room: number) =>
      aroundLayout(sub, 'fast_checks', Infinity, {
        measure,
        room,
      }).nodes.filter(node => node.position.y === 0).length;
    // The four in-neighbours: three at 150 and Rebase status? at 160.
    expect(topRow(Infinity)).toBe(4);
    expect(topRow(700)).toBe(4);
    expect(topRow(690)).toBe(3);
    expect(topRow(330)).toBe(2);
    expect(topRow(100)).toBe(1);
  });
});
