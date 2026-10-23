import { describe, expect, it } from 'vitest';

import { shipShaped } from '../__tests__/aroundFixtures';
import { miniPayload } from '../__tests__/blocksFixture';
import { aroundBlock } from './around';
import { AROUND, aroundLayout, layerNodes, wholeLayout } from './aroundLayout';

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

describe('wholeLayout', () => {
  const graph = miniPayload.graphs[0];

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
