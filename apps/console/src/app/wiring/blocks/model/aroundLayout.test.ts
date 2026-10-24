import { describe, expect, it } from 'vitest';

import { shipShaped } from '../__tests__/aroundFixtures';
import { miniPayload, shipPayload } from '../__tests__/blocksFixture';
import { aroundBlock } from './around';
import {
  AROUND,
  aroundLayout,
  DROP_CLEAR,
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
          node.width! / 2 + DROP_CLEAR
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
            ? { ...node, label: 'Done (ship again)?' }
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
    expect(data('rebase_status').label).toBe('Done (ship again)?');
    expect(data('rebase_status').title).toBeUndefined();
    expect(data('commit_named').title).toBeUndefined();
  });

  it('titles a node whose label runs past the cap', () => {
    const long = 'A question whose label runs on well past any sensible width?';
    const layout = aroundLayout(
      {
        nodes: sub.nodes.map(node =>
          node.id === 'checks_pass' ? { ...node, label: long } : node
        ),
        edges: sub.edges,
      },
      'fast_checks',
      Infinity,
      { measure }
    );
    expect(
      layout.nodes.find(node => node.id === 'checks_pass')!.data.title
    ).toBe(long);
  });

  it('seats a wrapped row of wider nodes in gaps clear of every drop above, so no drop takes a side channel', () => {
    const into = [
      'dirty answer?',
      'Commit named',
      'Stash them',
      'Fix test-first',
      'Rebase status?',
      'Continue result?',
    ];
    // dirty answer?, Commit named and Stash them at 150; Fix test-first,
    // Rebase status? and Continue result? at 160.
    const sized = (label: string) => (label.length >= 14 ? 100 : 80);
    const graph = {
      nodes: [
        ...into.map((label, i) => ({ ...sub.nodes[0], id: `n${i}`, label })),
        { ...sub.nodes[0], id: 'focus', label: 'Fast checks' },
      ],
      edges: into.map((_, i) => ({
        ...sub.edges[0],
        from: `n${i}`,
        to: 'focus',
      })),
    };
    const layout = aroundLayout(graph, 'focus', Infinity, {
      measure: sized,
      room: 700,
    });
    const top = layout.nodes.filter(node => node.position.y === 0);
    const wrapped = layout.nodes.filter(
      node => node.position.y === AROUND.nodeH + AROUND.rowGap
    );
    expect(top).toHaveLength(4);
    expect(wrapped.map(node => node.width)).toEqual([160, 160]);
    for (const lower of wrapped) {
      for (const upper of top) {
        const drop = upper.position.x + upper.width! / 2;
        const left = lower.position.x;
        const right = lower.position.x + lower.width!;
        expect(drop <= left - 10 || drop >= right + 10).toBe(true);
      }
    }
    expect(layout.edges.every(edge => edge.data?.channel == null)).toBe(true);
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

describe('edge routes and labels', () => {
  type Layout = ReturnType<typeof aroundLayout>;
  type Box = { left: number; top: number; right: number; bottom: number };
  const flow = shipPayload.graphs.find(g => g.blockId === 'ship/flow')!;
  const measure = (label: string) => label.length * 7;
  const layouts: [string, Layout][] = [
    [
      'the whole ship flow',
      wholeLayout(flow, null, Infinity, { measure, room: 1000 }),
    ],
    [
      'around Fast checks on the ship flow',
      aroundLayout(
        aroundBlock(flow, 'domain_fast_checks'),
        'domain_fast_checks',
        Infinity,
        {
          measure,
          room: 760,
        }
      ),
    ],
    [
      'around the ship-shaped graph',
      aroundLayout(sub, 'fast_checks', 2, { measure }),
    ],
  ];
  const boxOf = (node: AroundNode): Box => ({
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + node.width!,
    bottom: node.position.y + AROUND.nodeH,
  });
  /** Whether an axis-aligned segment enters a box's interior. */
  const crosses = (
    [x1, y1]: readonly [number, number],
    [x2, y2]: readonly [number, number],
    box: Box
  ) =>
    Math.max(x1, x2) > box.left &&
    Math.min(x1, x2) < box.right &&
    Math.max(y1, y2) > box.top &&
    Math.min(y1, y2) < box.bottom;
  const overlaps = (a: Box, b: Box) =>
    a.left < b.right &&
    b.left < a.right &&
    a.top < b.bottom &&
    b.top < a.bottom;

  it.each(layouts)(
    'routes every edge of %s clear of every node box',
    (_, layout) => {
      expect(layout.edges.length).toBeGreaterThan(3);
      for (const edge of layout.edges) {
        const points = edge.data!.points!;
        expect(points.length).toBeGreaterThan(1);
        for (let i = 1; i < points.length; i++) {
          const [a, b] = [points[i - 1]!, points[i]!];
          expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
          for (const node of layout.nodes) {
            if (crosses(a, b, boxOf(node)))
              throw new Error(`${edge.id} crosses ${node.id}`);
          }
        }
      }
    }
  );

  it.each(layouts)(
    'sets each label of %s beside its drop or under a run of its route, clear of every node',
    (_, layout) => {
      const labelled = layout.edges.filter(edge => edge.label);
      expect(labelled.length).toBeGreaterThan(0);
      for (const edge of labelled) {
        const at = edge.data!.labelAt!;
        const points = edge.data!.points!;
        const [[dropX, sourceY], bend] = points;
        const box: Box = {
          left: at.side === 'right' ? at.x : at.x - at.width,
          right: at.side === 'right' ? at.x + at.width : at.x,
          top: at.y,
          bottom: at.y + at.height,
        };
        // Beside the drop under its source, just under one of its route's
        // horizontal runs, or, where both meet a line, on its own drop.
        const besideDrop =
          box.top >= sourceY! &&
          box.bottom <= bend![1] &&
          (at.side === 'right' ? box.left > dropX! : box.right < dropX!);
        const underRun = points.slice(1, -1).some((from, i) => {
          const to = points[i + 2]!;
          if (from[1] !== to[1]) return false;
          const [lo, hi] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])];
          return box.top > from[1] && at.x >= lo - 4 && at.x <= hi + 4;
        });
        const onDrop =
          box.top >= sourceY! &&
          box.bottom <= bend![1] &&
          box.left < dropX! &&
          box.right > dropX!;
        if (!besideDrop && !underRun && !onDrop)
          throw new Error(`${edge.id}'s label sits off its own route`);
        for (const node of layout.nodes) {
          if (overlaps(box, boxOf(node)))
            throw new Error(`${edge.id}'s label covers ${node.id}`);
        }
      }
    }
  );

  const labelBox = (edge: Layout['edges'][number]): Box => {
    const at = edge.data!.labelAt!;
    return {
      left: at.side === 'right' ? at.x : at.x - at.width,
      right: at.side === 'right' ? at.x + at.width : at.x,
      top: at.y,
      bottom: at.y + at.height,
    };
  };

  it.each(layouts)('overlaps no two labels of %s', (_, layout) => {
    const boxes = layout.edges
      .filter(edge => edge.label)
      .map(edge => [edge.id, labelBox(edge)] as const);
    for (const [i, [id, box]] of boxes.entries())
      for (const [other, next] of boxes.slice(i + 1))
        if (overlaps(box, next)) throw new Error(`${id} overlaps ${other}`);
  });

  // The board's own case, a row of four: a wrapped row with a channel on
  // each side can leave a label no clear side.
  it.each([
    layouts[1]!,
    [
      'around the ship-shaped graph in one row',
      aroundLayout(sub, 'fast_checks', Infinity, { measure }),
    ] as [string, Layout],
  ])("keeps each label of %s off every other edge's line", (_, layout) => {
    for (const edge of layout.edges.filter(e => e.label)) {
      const box = labelBox(edge);
      for (const other of layout.edges) {
        if (other.id === edge.id) continue;
        const points = other.data!.points!;
        for (let i = 1; i < points.length; i++)
          if (crosses(points[i - 1]!, points[i]!, box))
            throw new Error(`${edge.id}'s label crosses ${other.id}`);
      }
    }
  });

  /** Every label that sits on, or within 3px of, another edge's line, as
      `label > line`: the canvas measures labels in its own font, a few px
      off the layout's estimate. */
  const labelsOnLines = (layout: Layout): string[] =>
    layout.edges
      .filter(edge => edge.label)
      .flatMap(edge => {
        const tight = labelBox(edge);
        const box = { ...tight, left: tight.left - 3, right: tight.right + 3 };
        return layout.edges
          .filter(
            other =>
              other.id !== edge.id &&
              other.data!.points!.some(
                (to, i, points) => i > 0 && crosses(points[i - 1]!, to, box)
              )
          )
          .map(other => `${edge.id} > ${other.id}`);
      });

  // From the narrowest canvas that holds two nodes a row (a window about
  // 700 wide) past the 1440 canvas's 760: the 900 canvas gets about 560.
  const ROOMS = Array.from({ length: 56 }, (_, i) => 340 + i * 20);

  it.each(
    [5.8, 6, 6.2, 6.4, 6.6, 6.8, 7, 7.2, 7.4].map(
      px => [`${px}px`, (label: string) => label.length * px] as const
    )
  )(
    'keeps every Fast checks label off the other lines at every room, %s a letter',
    (_, measureAt) => {
      const around = aroundBlock(flow, 'domain_fast_checks');
      for (const room of ROOMS) {
        const layout = aroundLayout(around, 'domain_fast_checks', Infinity, {
          measure: measureAt,
          room,
        });
        expect([room, labelsOnLines(layout)]).toEqual([room, []]);
      }
    }
  );

  // The whole graph has no board. Fan-outs with long labels (AFTER result?
  // and its six answers) leave some labels no clear place; this holds the
  // count to what the fix wave left, at the 900 and 1440 canvases.
  it.each([
    [560, 16],
    [760, 11],
  ])(
    'leaves at most a known few whole-graph labels on other lines at room %i',
    (room, most) => {
      const layout = wholeLayout(flow, null, Infinity, {
        measure: (label: string) => label.length * 6.6,
        room,
      });
      const on = new Set(
        labelsOnLines(layout).map(pair => pair.split(' > ')[0])
      );
      expect(on.size).toBeLessThanOrEqual(most);
      // The re-review's case: "yes: no push, no mr_create" over the drop of
      // Reopened's "no".
      expect([...on].some(id => id.startsWith('nothing_to_push->'))).toBe(
        false
      );
    }
  );

  it('keeps every ship-shaped label off the other lines at every room', () => {
    for (const room of ROOMS) {
      const layout = aroundLayout(sub, 'fast_checks', Infinity, {
        measure,
        room,
      });
      expect([room, labelsOnLines(layout)]).toEqual([room, []]);
    }
  });

  it('sets a label under its bend when a line runs close by on both sides of its drop', () => {
    // The canvas's wrapped row: Continue result? sits in the gap between
    // Commit named and Stash them, whose drops pass 90px either side.
    const into = [
      'dirty answer?',
      'Commit named',
      'Stash them',
      'Fix test-first',
      'Rebase status?',
      'Continue result?',
    ];
    const sized = (label: string) => (label.length >= 14 ? 100 : 80);
    const graph = {
      nodes: [
        ...into.map((label, i) => ({ ...sub.nodes[0], id: `n${i}`, label })),
        { ...sub.nodes[0], id: 'other', label: 'Rebase this pass?' },
        { ...sub.nodes[0], id: 'focus', label: 'Fast checks' },
      ],
      edges: [
        ...into.slice(0, 5).map((_, i) => ({
          ...sub.edges[0],
          from: `n${i}`,
          to: 'focus',
          label: null,
        })),
        { ...sub.edges[0], from: 'focus', to: 'other', label: null },
        {
          ...sub.edges[0],
          from: 'n5',
          to: 'other',
          label: 'rebase finished',
        },
      ],
    };
    const layout = aroundLayout(graph, 'focus', Infinity, {
      measure: sized,
      room: 700,
    });
    const edge = layout.edges.find(e => e.label === 'rebase finished')!;
    const [, bend] = edge.data!.points!;
    expect(edge.data!.labelAt!.y).toBeGreaterThan(bend![1]);
  });

  it('sends the edges out of one node from their own points, labels on either side', () => {
    const layout = aroundLayout(sub, 'fast_checks');
    const out = layout.edges.filter(edge => edge.source === 'fast_checks');
    expect(out.length).toBeGreaterThan(1);
    const drops = out.map(edge => edge.data!.points![0]![0]);
    expect(new Set(drops).size).toBe(out.length);
    const sides = out
      .filter(edge => edge.label)
      .map(edge => edge.data!.labelAt!.side);
    if (sides.length > 1) expect(new Set(sides).size).toBe(2);
  });
});
