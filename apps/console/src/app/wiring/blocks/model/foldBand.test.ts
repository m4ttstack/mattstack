import { describe, expect, it } from 'vitest';

import { shipPayload } from '../__tests__/blocksFixture';
import type { BlocksPayload } from '../../../../server/blocksPayload';
import { blockMap, type MapKind } from './blockMap';
import { budgetLabel, foldBand } from './foldBand';

type Graph = BlocksPayload['graphs'][number];
type Shape = Graph['nodes'][number]['shape'];
type NodeSpec = [id: string, blockId?: string | null, shape?: Shape];
type EdgeSpec = [from: string, to: string, label?: string];

/** Block nodes carry their own id as `blockId`; pass `null` for a
    graph-only node. */
function g(nodes: NodeSpec[], edges: EdgeSpec[]): Graph {
  return {
    blockId: 'acme/flow',
    nodes: nodes.map(([id, blockId = id, shape = 'box'], line) => ({
      id,
      label: id,
      shape,
      cls: null,
      line,
      blockId,
    })),
    edges: edges.map(([from, to, label], line) => ({
      from,
      to,
      label: label ?? null,
      style: null,
      line,
    })),
  };
}

const asStep = (blockId: string) => ({
  label: blockId,
  kind: 'step' as const,
});

function bandOf(graph: Graph, from: string, to: string) {
  const map = blockMap(graph, asStep);
  const link = map.links.find(l => l.from === from && l.to.includes(to));
  if (!link) throw new Error(`no link ${from} → ${to}`);
  return foldBand(graph, link, map);
}

const node = (band: ReturnType<typeof foldBand>, id: string) => {
  const found = band.nodes.find(each => each.id === id);
  if (!found) throw new Error(`no band node ${id}`);
  return found;
};

/** A → q; q's "yes" reaches B, its "no" retries through x and y to C, and
    its "error" goes to the exit question `which_exit`. `end` is an exit
    node with an edge on to D, which a jump must never reach through it. */
const branching = g(
  [
    ['A'],
    ['q', null, 'diamond'],
    ['B'],
    ['x', null],
    ['end', null, 'doublecircle'],
    ['D'],
    ['y', null],
    ['C'],
    ['which_exit', null, 'diamond'],
    ['failed', null, 'doublecircle'],
  ],
  [
    ['A', 'q'],
    ['q', 'B', 'yes: carry on'],
    ['q', 'x', 'no: retry'],
    ['q', 'which_exit', 'error: a failure'],
    ['x', 'end'],
    ['x', 'y'],
    ['end', 'D'],
    ['y', 'C'],
    ['which_exit', 'failed'],
  ]
);

const shipGraph = shipPayload.graphs.find(
  each => each.blockId === 'ship/flow'
)!;
const shipMap = blockMap(shipGraph, blockId => {
  const block = shipPayload.blocks.find(each => each.id === blockId)!;
  return {
    label: block.label,
    kind: block.kind as Exclude<MapKind, 'end' | 'split'>,
  };
});

describe('foldBand', () => {
  it('foldBand merges a budget pair', () => {
    const link = shipMap.links.find(
      l =>
        l.from === 'domain_rebases_unfinished' &&
        l.to.includes('resolve_conflict_files')
    )!;

    const band = foldBand(shipGraph, link, shipMap);

    expect(band.nodes).toEqual([
      {
        id: 'git_rebase_onto',
        kind: 'command',
        text: 'git_rebase {tree: <root>, onto: origin/<resolved target>}',
      },
      {
        id: 'rebase_status',
        kind: 'question',
        label: 'Rebase status?',
        jumps: [
          { label: 'clean', target: 'domain_fast_checks', direction: 'back' },
          { label: 'error', target: 'which_exit', direction: 'forward' },
        ],
        pills: ['conflict'],
      },
      {
        id: 'run_budget_conflict_rounds',
        kind: 'budget',
        label: 'Conflict rounds left? · 4',
        jumps: [{ label: 'no', target: 'gate_ship', direction: 'back' }],
        pills: ['yes'],
      },
    ]);
    expect(band.edges).toEqual([
      {
        id: 'git_rebase_onto->rebase_status',
        source: 'git_rebase_onto',
        target: 'rebase_status',
      },
      {
        id: 'rebase_status->run_budget_conflict_rounds',
        source: 'rebase_status',
        target: 'run_budget_conflict_rounds',
      },
    ]);
  });

  it('an exit inside the band is a pill, cut at its first colon', () => {
    const band = bandOf(branching, 'A', 'C');

    expect(band.nodes.map(each => each.id)).toEqual(['q', 'x', 'y']);
    expect(node(band, 'q')).toMatchObject({ pills: ['no'] });
  });

  it('an exit to the link target is a pill', () => {
    const band = bandOf(branching, 'A', 'B');

    expect(node(band, 'q')).toMatchObject({ pills: ['yes'] });
  });

  it('an exit leaving the band jumps to the first block a breadth-first walk reaches, skipping exit nodes', () => {
    const band = bandOf(branching, 'A', 'B');

    expect(node(band, 'q')).toMatchObject({
      jumps: expect.arrayContaining([
        { label: 'no', target: 'C', direction: 'forward' },
      ]),
    });
  });

  it('with no block found the jump goes to the exit it entered', () => {
    const band = bandOf(branching, 'A', 'C');

    expect(node(band, 'q')).toMatchObject({
      jumps: [
        { label: 'yes', target: 'B', direction: 'forward' },
        { label: 'error', target: 'which_exit', direction: 'forward' },
      ],
    });
  });

  it('on ship, jumps that find no block target the exit node they enter', () => {
    const blocks = new Set(shipMap.nodes.map(each => each.id));
    const exitJumps: string[] = [];
    for (const link of shipMap.links) {
      for (const each of foldBand(shipGraph, link, shipMap).nodes) {
        if (each.kind === 'command') continue;
        for (const jump of each.jumps) {
          if (blocks.has(jump.target) || jump.target === 'which_exit') continue;
          exitJumps.push(
            `${link.from} → ${link.to.join(', ')} · ${each.id} · ${jump.label} → ${jump.target} · ${jump.direction}`
          );
        }
      }
    }

    expect(exitJumps).toEqual([
      'reopened_recapture → domain_steps_before_gate · on_default_branch · yes → own_run_default_branch · forward',
      'gate_ship → domain_steps_before_gate · run_budget_gate_rounds · no → rebase_in_progress · forward',
      'domain_fast_checks → gate_ship · run_budget_gate_reopenings · no → rebase_in_progress · forward',
      'domain_rebases_unfinished → gate_ship · run_budget_gate_reopenings · no → rebase_in_progress · forward',
      'run_watch_ci → gate_mark_ready · watch_ci_result · held → held_in_watch_ci · forward',
      'resolve_conflict_files → gate_ship · run_budget_gate_reopenings · no → rebase_in_progress · back',
      'resolve_conflict_files → gate_ship · continue_result · error → git_rebase_abort · forward',
      'resolve_conflict_files → domain_fast_checks · continue_result · error → git_rebase_abort · forward',
      'resolve_conflict_files → resolve_conflict_files · continue_result · error → git_rebase_abort · forward',
    ]);
  });

  it('keeps only the edges between band nodes', () => {
    const band = bandOf(branching, 'A', 'C');

    expect(band.edges.map(edge => edge.id)).toEqual(['q->x', 'x->y']);
  });
});

describe('budgetLabel', () => {
  it('names a skill-prefixed key', () => {
    expect(budgetLabel('ship:conflict-rounds', 4)).toBe(
      'Conflict rounds left? · 4'
    );
  });

  it('drops a trailing case id', () => {
    expect(budgetLabel('ship:after-attempts:<case id>', 3)).toBe(
      'After attempts left? · 3'
    );
  });

  it('names a key with no prefix', () => {
    expect(budgetLabel('fix-rounds', 2)).toBe('Fix rounds left? · 2');
  });
});
