import { describe, expect, it } from 'vitest';

import { shipPayload } from '../__tests__/blocksFixture';
import type { BlocksPayload } from '../../../../server/blocksPayload';
import {
  blockMap,
  formatBlockMap,
  type BlockMap,
  type MapKind,
  type MapLink,
} from './blockMap';
import { cutLabel } from './labels';
import { mapLayout } from './mapLayout';

type Graph = BlocksPayload['graphs'][number];
type Shape = Graph['nodes'][number]['shape'];
type NodeSpec = [
  id: string,
  blockId?: string | null,
  shape?: Shape,
  cls?: 'done' | 'stop',
  label?: string,
];
type EdgeSpec = [from: string, to: string, label?: string];

/** A graph whose block nodes carry their own id as `blockId`: pass `null`
    for a graph-only node. Unlisted nodes are blocks. */
function g(nodes: NodeSpec[], edges: EdgeSpec[]): Graph {
  return {
    blockId: 'test',
    nodes: nodes.map(([id, blockId = id, shape = 'box', cls, label], line) => ({
      id,
      label: label ?? id,
      shape,
      cls: cls ?? null,
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

const linkTo = (map: BlockMap, from: string, to: string): MapLink => {
  const link = map.links.find(
    l => (l.from === from || l.alsoFrom.includes(from)) && l.to.includes(to)
  );
  if (!link) throw new Error(`no link ${from} → ${to}`);
  return link;
};

const pairs = (map: BlockMap) =>
  map.links.map(link => `${link.from} → ${link.to.join(', ')}`);

describe('cutLabel', () => {
  it('keeps the text before the first colon, trimmed', () => {
    expect(cutLabel('no: redo with their note')).toBe('no');
    expect(cutLabel(' refused or errored ')).toBe('refused or errored');
    expect(cutLabel('a: b: c')).toBe('a');
  });
});

describe('blockMap', () => {
  it('links two blocks through graph-only steps and folds them', () => {
    const map = blockMap(
      g(
        [['A'], ['x', null], ['y', null], ['B']],
        [
          ['A', 'x'],
          ['x', 'y'],
          ['y', 'B'],
        ]
      ),
      asStep
    );

    expect(pairs(map)).toEqual(['A → B']);
    expect(linkTo(map, 'A', 'B')).toMatchObject({
      kind: 'line',
      folded: ['x', 'y'],
      label: null,
      trunk: null,
    });
    expect(map.foldedSteps).toBe(2);
  });

  it('a direct edge is a link with nothing folded', () => {
    const map = blockMap(g([['A'], ['B']], [['A', 'B']]), asStep);

    expect(linkTo(map, 'A', 'B').folded).toEqual([]);
  });

  it('stops on entering an exit node', () => {
    const map = blockMap(
      g(
        [['A'], ['q', null, 'diamond'], ['B'], ['hub', null], ['end', null]],
        [
          ['A', 'q'],
          ['q', 'B', 'no'],
          ['q', 'hub', 'yes'],
          ['hub', 'end'],
        ]
      ),
      asStep
    );

    expect(pairs(map)).toEqual(['A → B']);
    expect(linkTo(map, 'A', 'B').folded).toEqual(['q']);
  });

  it('a block with only exit paths links to the success end', () => {
    const map = blockMap(
      g(
        [['M'], ['hub', null], ['done', null, 'doublecircle', 'done']],
        [
          ['M', 'hub'],
          ['hub', 'done'],
        ]
      ),
      asStep
    );

    expect(map.nodes.map(node => [node.id, node.kind])).toEqual([
      ['M', 'step'],
      ['done', 'end'],
    ]);
    expect(linkTo(map, 'M', 'done')).toMatchObject({
      kind: 'line',
      folded: [],
    });
  });

  it('a block whose only link loops back to itself also links to the success end', () => {
    const map = blockMap(
      g(
        [
          ['M'],
          ['budget', null],
          ['spent', null, 'diamond'],
          ['hub', null],
          ['done', null, 'doublecircle', 'done'],
        ],
        [
          ['M', 'hub', 'go'],
          ['M', 'budget', 'iterate'],
          ['budget', 'spent'],
          ['spent', 'M', 'no: a new gate'],
          ['spent', 'hub', 'yes'],
          ['hub', 'done'],
        ]
      ),
      asStep
    );

    expect(linkTo(map, 'M', 'M')).toMatchObject({
      kind: 'jump-back',
      label: 'iterate',
    });
    expect(linkTo(map, 'M', 'done').kind).toBe('line');
  });

  it('a block whose only link goes back to an earlier block gets no end link', () => {
    const map = blockMap(
      g(
        [
          ['run', null, 'ellipse'],
          ['A'],
          ['B'],
          ['hub', null],
          ['done', null, 'doublecircle', 'done'],
        ],
        [
          ['run', 'A'],
          ['A', 'B'],
          ['B', 'A', 'again'],
          ['B', 'hub', 'finish'],
          ['hub', 'done'],
        ]
      ),
      asStep
    );

    expect(pairs(map)).toEqual(['A → B', 'B → A']);
    expect(linkTo(map, 'B', 'A').kind).toBe('jump-back');
  });

  it('with no success end there is no end node and no end link', () => {
    const map = blockMap(
      g(
        [['M'], ['hub', null], ['stop', null, 'doublecircle', 'stop']],
        [
          ['M', 'hub'],
          ['hub', 'stop'],
        ]
      ),
      asStep
    );

    expect(map.nodes.map(node => node.id)).toEqual(['M']);
    expect(map.links).toEqual([]);
  });

  it('a back edge is a jump back, labelled with the source exit cut at its colon', () => {
    const map = blockMap(
      g(
        [['run', null, 'ellipse'], ['A'], ['B'], ['x', null, 'diamond']],
        [
          ['run', 'A'],
          ['A', 'B'],
          ['B', 'x', 'iterate: go again'],
          ['x', 'A', 'no: redo'],
        ]
      ),
      asStep
    );

    expect(linkTo(map, 'B', 'A')).toMatchObject({
      kind: 'jump-back',
      label: 'iterate',
      folded: ['x'],
    });
    expect(linkTo(map, 'A', 'B').kind).toBe('line');
  });

  it('a path back to its own block is a jump back to itself', () => {
    const map = blockMap(
      g(
        [['A'], ['x', null], ['B']],
        [
          ['A', 'B'],
          ['A', 'x', 'again'],
          ['x', 'A'],
        ]
      ),
      asStep
    );

    expect(linkTo(map, 'A', 'A')).toMatchObject({
      to: ['A'],
      kind: 'jump-back',
      label: 'again',
      folded: ['x'],
    });
  });

  it('a forward link spanning JUMP_LAYERS layers is a jump; fewer is a line', () => {
    const map = blockMap(
      g(
        [['A'], ['B'], ['C'], ['D'], ['x', null], ['y', null]],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'D'],
          ['A', 'x', 'skip'],
          ['x', 'D'],
          ['A', 'y', 'hop'],
          ['y', 'C'],
        ]
      ),
      asStep
    );

    expect(map.layers).toEqual({ A: 0, B: 1, C: 2, D: 3 });
    expect(linkTo(map, 'A', 'D')).toMatchObject({
      kind: 'jump-forward',
      label: 'skip',
    });
    expect(linkTo(map, 'A', 'C')).toMatchObject({ kind: 'line', label: null });
  });

  it('one folded question reaching two blocks makes one jump with both targets', () => {
    const map = blockMap(
      g(
        [['run', null, 'ellipse'], ['B'], ['C'], ['A'], ['q', null, 'diamond']],
        [
          ['run', 'B'],
          ['B', 'C'],
          ['C', 'A'],
          ['A', 'q', 'yes'],
          ['q', 'B'],
          ['q', 'C'],
        ]
      ),
      asStep
    );

    const jumps = map.links.filter(link => link.from === 'A');
    expect(jumps).toHaveLength(1);
    expect(jumps[0]).toMatchObject({
      kind: 'jump-back',
      label: 'yes',
      folded: ['q'],
      fork: 'q',
    });
    expect([...jumps[0]!.to].sort()).toEqual(['B', 'C']);
  });

  it('sibling sources with the same jump share one link', () => {
    const map = blockMap(
      g(
        [['T'], ['S1'], ['S2'], ['x', null]],
        [
          ['T', 'S1'],
          ['T', 'S2'],
          ['S1', 'x', 'retry: once more'],
          ['S2', 'x', 'retry'],
          ['x', 'T'],
        ]
      ),
      asStep
    );

    const back = map.links.filter(link => link.kind === 'jump-back');
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({
      from: 'S1',
      alsoFrom: ['S2'],
      to: ['T'],
      label: 'retry',
      fork: 'x',
    });
  });

  it('identical jumps from sources that are not siblings stay apart', () => {
    const map = blockMap(
      g(
        [['T'], ['S1'], ['S2'], ['x', null]],
        [
          ['T', 'S1'],
          ['S1', 'S2'],
          ['S1', 'x', 'retry'],
          ['S2', 'x', 'retry'],
          ['x', 'T'],
        ]
      ),
      asStep
    );

    expect(
      map.links
        .filter(link => link.kind === 'jump-back')
        .map(link => [link.from, link.alsoFrom])
    ).toEqual([
      ['S1', []],
      ['S2', []],
    ]);
  });

  it('a question several blocks pass on the way to several targets becomes one shared split', () => {
    const map = blockMap(
      g(
        [
          ['A'],
          ['B'],
          ['p', null],
          ['r', null],
          ['f', null, 'diamond'],
          ['C'],
          ['D'],
        ],
        [
          ['A', 'B'],
          ['A', 'p'],
          ['B', 'r'],
          ['p', 'f'],
          ['r', 'f'],
          ['f', 'C', 'left: go'],
          ['f', 'D', 'right'],
        ]
      ),
      asStep
    );

    expect(map.nodes.find(node => node.id === 'f')).toEqual({
      id: 'f',
      blockId: null,
      label: 'f',
      kind: 'split',
    });
    expect(pairs(map).sort()).toEqual([
      'A → B',
      'A → f',
      'B → f',
      'f → C',
      'f → D',
    ]);
    expect(linkTo(map, 'A', 'f').folded).toEqual(['p']);
    expect(linkTo(map, 'f', 'C')).toMatchObject({
      kind: 'line',
      label: 'left',
      folded: [],
    });
    expect(linkTo(map, 'f', 'D').label).toBe('right');
    expect(map.foldedSteps).toBe(2);
  });

  it("a split's long links leave its trunk for the jump rule, main included", () => {
    const map = blockMap(
      g(
        [
          ['A'],
          ['B'],
          ['p', null],
          ['r', null],
          ['f', null, 'diamond'],
          ['s', null, 'diamond'],
          ['E'],
          ['G'],
          ['H'],
          ['C'],
          ['D'],
        ],
        [
          ['A', 'B'],
          ['A', 'p'],
          ['B', 'r'],
          ['p', 'f'],
          ['r', 'f'],
          ['f', 's', 'left: the far side'],
          ['f', 'E', 'right'],
          ['s', 'C', 'x'],
          ['s', 'D', 'y'],
          ['E', 'G'],
          ['G', 'H'],
          ['H', 'C'],
          ['H', 'D'],
        ]
      ),
      asStep
    );

    expect(map.layers.C! - map.layers.f!).toBeGreaterThanOrEqual(3);
    const far = linkTo(map, 'f', 'C');
    expect(far).toMatchObject({
      kind: 'jump-forward',
      label: 'left',
      fork: 's',
      trunk: null,
    });
    expect([...far.to].sort()).toEqual(['C', 'D']);
    expect(linkTo(map, 'f', 'E')).toMatchObject({
      kind: 'line',
      label: 'right',
    });
  });

  it('a budget question and a merge point are never splits', () => {
    const withCommand = (command: string) =>
      blockMap(
        g(
          [
            ['A'],
            ['B'],
            ['budget', null, 'plaintext', undefined, command],
            ['spent', null, 'diamond'],
            ['m', null, 'diamond'],
            ['n', null],
            ['C'],
            ['D'],
          ],
          [
            ['A', 'B'],
            ['A', 'budget'],
            ['B', 'budget'],
            ['budget', 'spent'],
            ['spent', 'C', 'yes'],
            ['spent', 'm', 'no'],
            ['m', 'n', 'yes'],
            ['m', 'D', 'no'],
            ['n', 'D'],
            ['n', 'C'],
          ]
        ),
        asStep
      );
    const splitsOf = (map: BlockMap) =>
      map.nodes.filter(node => node.kind === 'split').map(node => node.id);

    expect(splitsOf(withCommand('git status --porcelain'))).toEqual(['spent']);
    expect(
      splitsOf(
        withCommand('run_budget {key: ship:fix-rounds, limit: 4, stage}')
      )
    ).toEqual([]);
  });

  it('a split that stops qualifying after an undo dissolves', () => {
    const map = blockMap(
      g(
        [
          ['B'],
          ['b', null],
          ['M'],
          ['T2'],
          ['A'],
          ['C'],
          ['a', null],
          ['c', null],
          ['F', null, 'diamond'],
          ['T1'],
        ],
        [
          ['B', 'b', 'go'],
          ['b', 'M'],
          ['b', 'F'],
          ['M', 'T2'],
          ['T2', 'A'],
          ['T2', 'C'],
          ['A', 'a'],
          ['C', 'c'],
          ['a', 'F'],
          ['c', 'F'],
          ['F', 'T1', 'one'],
          ['F', 'T2', 'two'],
        ]
      ),
      asStep
    );

    expect(map.nodes.filter(node => node.kind === 'split')).toEqual([]);
    expect(linkTo(map, 'A', 'T1').folded).toEqual(['a', 'F']);
    expect(linkTo(map, 'C', 'T1').folded).toEqual(['c', 'F']);
  });

  it('a link into a split stays a line, however far it spans', () => {
    const map = blockMap(
      g(
        [
          ['A'],
          ['B'],
          ['C'],
          ['D'],
          ['p', null],
          ['q', null],
          ['f', null, 'diamond'],
          ['E'],
          ['G'],
        ],
        [
          ['A', 'p'],
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'D'],
          ['p', 'f'],
          ['D', 'q'],
          ['q', 'f'],
          ['f', 'E', 'l'],
          ['f', 'G', 'r'],
        ]
      ),
      asStep
    );

    expect(map.layers.f! - map.layers.A!).toBeGreaterThanOrEqual(3);
    expect(linkTo(map, 'A', 'f')).toMatchObject({ kind: 'line', trunk: null });
  });

  it('a trunk splits where the branch leaves the main path; the main line follows first-declared edges', () => {
    const map = blockMap(
      g(
        [['A'], ['p', null], ['s', null, 'diamond'], ['B'], ['C']],
        [
          ['A', 'p'],
          ['p', 's'],
          ['s', 'B', 'ok: go on'],
          ['s', 'C', 'refused: no'],
        ]
      ),
      asStep
    );

    const main = linkTo(map, 'A', 'B');
    const branch = linkTo(map, 'A', 'C');
    expect(map.order.indexOf('C')).toBeLessThan(map.order.indexOf('B'));
    expect(main).toMatchObject({ kind: 'line', label: null });
    expect(main.trunk).toEqual({ group: main.id, splitAt: 's', main: true });
    expect(branch).toMatchObject({ kind: 'line', label: 'refused' });
    expect(branch.trunk).toEqual({ group: main.id, splitAt: 's', main: false });
  });

  it('a long main line sharing folded steps with a short branch stays a line in the trunk', () => {
    const map = blockMap(
      g(
        [
          ['A'],
          ['q', null, 'diamond'],
          ['x', null],
          ['B'],
          ['C'],
          ['E'],
          ['D'],
        ],
        [
          ['A', 'q'],
          ['q', 'x', 'a: the long way'],
          ['q', 'B', 'b'],
          ['x', 'D'],
          ['B', 'C'],
          ['C', 'E'],
          ['E', 'D'],
        ]
      ),
      asStep
    );

    expect(map.layers.D! - map.layers.A!).toBe(4);
    expect(linkTo(map, 'A', 'D')).toMatchObject({
      kind: 'line',
      label: null,
      trunk: { main: true },
    });
    expect(linkTo(map, 'A', 'B')).toMatchObject({
      kind: 'line',
      label: 'b',
      trunk: { splitAt: 'q', main: false },
    });
  });

  it('a long branch beyond the main leaves the trunk as a jump, while a long branch short of the main stays in it', () => {
    const map = blockMap(
      g(
        [
          ['A'],
          ['q', null, 'diamond'],
          ['x', null],
          ['y', null],
          ['z', null],
          ['B'],
          ['C'],
          ['E'],
          ['D'],
          ['F'],
        ],
        [
          ['A', 'q', 'go: on'],
          ['q', 'x', 'main'],
          ['x', 'D'],
          ['q', 'y', 'short of it'],
          ['y', 'E'],
          ['q', 'z', 'beyond it'],
          ['z', 'F'],
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'E'],
          ['E', 'D'],
          ['D', 'F'],
        ]
      ),
      asStep
    );

    expect(map.layers).toMatchObject({ A: 0, E: 3, D: 4, F: 5 });
    expect(linkTo(map, 'A', 'D').trunk?.main).toBe(true);
    expect(linkTo(map, 'A', 'E')).toMatchObject({
      kind: 'line',
      label: 'short of it',
      trunk: { splitAt: 'q', main: false },
    });
    expect(linkTo(map, 'A', 'F')).toMatchObject({
      kind: 'jump-forward',
      label: 'go',
      trunk: null,
    });
  });

  it('a trunk left with only its main is no trunk', () => {
    const map = blockMap(
      g(
        [
          ['A'],
          ['q', null, 'diamond'],
          ['z', null],
          ['B'],
          ['C'],
          ['D'],
          ['F'],
        ],
        [
          ['A', 'q'],
          ['q', 'B', 'main'],
          ['q', 'z', 'far'],
          ['z', 'F'],
          ['B', 'C'],
          ['C', 'D'],
          ['D', 'F'],
        ]
      ),
      asStep
    );

    expect(linkTo(map, 'A', 'B')).toMatchObject({ kind: 'line', trunk: null });
    expect(linkTo(map, 'A', 'F')).toMatchObject({
      kind: 'jump-forward',
      trunk: null,
    });
  });

  it('a trunk keeps only links that share a step with its main', () => {
    const map = blockMap(
      g(
        [['S'], ['x', null], ['y', null], ['z', null], ['A'], ['B'], ['C']],
        [
          ['S', 'x'],
          ['S', 'y'],
          ['x', 'A'],
          ['x', 'z'],
          ['y', 'z'],
          ['z', 'B'],
          ['y', 'C'],
        ]
      ),
      asStep
    );

    const main = linkTo(map, 'S', 'A');
    expect(main.trunk).toMatchObject({ main: true });
    expect(linkTo(map, 'S', 'B').trunk).toEqual({
      group: main.id,
      splitAt: 'x',
      main: false,
    });
    expect(linkTo(map, 'S', 'C')).toMatchObject({ kind: 'line', trunk: null });
  });

  it('a graph-only cycle with no block ends the walk', () => {
    const map = blockMap(
      g(
        [['A'], ['c1', null], ['c2', null], ['B']],
        [
          ['A', 'c1'],
          ['c1', 'c2'],
          ['c2', 'c1'],
          ['A', 'B'],
        ]
      ),
      asStep
    );

    expect(pairs(map)).toEqual(['A → B']);
    for (const link of map.links) {
      expect(link.folded).not.toContain('c1');
      expect(link.folded).not.toContain('c2');
    }
  });
});

describe('blockMap on ship flow', () => {
  const graph = shipPayload.graphs.find(each => each.blockId === 'ship/flow')!;
  const blockOf = (blockId: string) => {
    const block = shipPayload.blocks.find(each => each.id === blockId)!;
    if (block.kind === 'note' || block.kind === 'shared') {
      throw new Error(`${blockId} is not a flow kind`);
    }
    return {
      label: block.label,
      kind: block.kind as Exclude<MapKind, 'end' | 'split'>,
    };
  };
  const map = blockMap(graph, blockOf);

  it('one node per block with a node, plus Shipped and the shared splits', () => {
    const named = shipPayload.blocks.filter(
      block => block.parentId === 'ship/flow' && block.node !== null
    );

    expect(map.nodes.filter(node => node.blockId !== null)).toHaveLength(
      named.length
    );
    expect(map.nodes.filter(node => node.kind === 'end')).toEqual([
      { id: 'shipped', blockId: null, label: 'Shipped', kind: 'end' },
    ]);
    expect(
      map.nodes.filter(node => node.kind === 'split').map(node => node.id)
    ).toEqual(['create_forge_host', 'browser_case', 'every_case_tried']);
    expect(map.foldedSteps).toBe(graph.nodes.length - named.length - 1 - 3);
  });

  it('the links the spec names', () => {
    expect(linkTo(map, 'domain_fast_checks', 'fix_test_first')).toMatchObject({
      kind: 'line',
      folded: ['checks_pass', 'run_budget_fix_rounds', 'fix_rounds_spent'],
    });
    expect(linkTo(map, 'fix_test_first', 'domain_fast_checks')).toMatchObject({
      from: 'fix_test_first',
      alsoFrom: [],
      kind: 'jump-back',
      label: null,
    });
    expect(linkTo(map, 'gate_ship', 'domain_steps_before_gate')).toMatchObject({
      kind: 'jump-back',
      label: 'iterate',
    });
    expect(linkTo(map, 'domain_fast_checks', 'gate_ship')).toMatchObject({
      from: 'domain_fast_checks',
      alsoFrom: [],
      kind: 'jump-back',
    });

    const captures = linkTo(map, 'reopened_recapture', 'capture_after_browser');
    expect(captures).toMatchObject({ kind: 'jump-forward', label: 'yes' });
    expect([...captures.to].sort()).toEqual([
      'capture_after_browser',
      'capture_after_case',
    ]);

    expect(captures.fork).toBe('browser_case');

    const conflictLoops = map.links.filter(
      link => link.from === 'resolve_conflict_files'
    );
    expect(conflictLoops.map(link => link.to)).toEqual([
      ['gate_ship'],
      ['domain_fast_checks'],
      ['resolve_conflict_files'],
    ]);

    expect(linkTo(map, 'gate_mark_ready', 'shipped').kind).toBe('line');
    expect(linkTo(map, 'gate_mark_ready', 'gate_mark_ready').kind).toBe(
      'jump-back'
    );

    for (const link of map.links) {
      expect(link.folded).not.toContain('which_exit');
      expect(link.folded.filter(id => id.startsWith('run_close_'))).toEqual([]);
    }
  });

  it('the forge question is one shared split', () => {
    const into = map.links.filter(link =>
      link.to.includes('create_forge_host')
    );
    expect(into.map(link => link.from)).toEqual([
      'domain_rebases_unfinished',
      'gate_push_refused',
      'confirm_human_push',
    ]);
    expect(linkTo(map, 'create_forge_host', 'mr_create').label).toBe('GitLab');
    expect(linkTo(map, 'create_forge_host', 'gate_which_forge').label).toBe(
      'anything else'
    );
    const github = linkTo(map, 'create_forge_host', 'capture_after_browser');
    expect(github).toMatchObject({ kind: 'jump-forward', label: 'GitHub' });
    expect([...github.to].sort()).toEqual([
      'capture_after_browser',
      'capture_after_case',
    ]);
  });

  it('a link never folds a map node, so one that only passes a split is solid', () => {
    const onMap = new Set(map.nodes.map(node => node.id));
    for (const link of map.links) {
      expect({
        link: link.id,
        folded: link.folded.filter(id => onMap.has(id)),
      }).toEqual({ link: link.id, folded: [] });
    }
    const through = linkTo(map, 'gate_which_forge', 'mr_create');
    expect(through).toMatchObject({ kind: 'line', folded: [] });
    const edge = mapLayout(map, graph, {
      dotsOf: () => [],
      measure: text => text.length * 7,
    }).edges.find(each => each.id === through.id)!;
    expect(edge.folded).toBe(false);
  });

  it("every_case_tried keeps its short trunk while the forge split's long links jump", () => {
    const main = linkTo(map, 'every_case_tried', 'record_evidence');
    expect(main).toMatchObject({
      kind: 'line',
      label: 'yes',
      trunk: { main: true },
    });
    expect(linkTo(map, 'every_case_tried', 'attach_evidence')).toMatchObject({
      kind: 'line',
      label: 'no',
      trunk: {
        group: main.trunk!.group,
        splitAt: 'after_captured',
        main: false,
      },
    });
  });

  it('Rebases unfinished keeps its trunk branch to Push refused at push_result', () => {
    const main = linkTo(map, 'domain_rebases_unfinished', 'create_forge_host');
    expect(main.trunk).toMatchObject({ main: true });
    expect(
      linkTo(map, 'domain_rebases_unfinished', 'gate_push_refused')
    ).toMatchObject({
      kind: 'line',
      label: 'refused or errored',
      trunk: { group: main.trunk!.group, splitAt: 'push_result', main: false },
    });
  });

  it('the whole map', async () => {
    await expect(formatBlockMap(map)).toMatchFileSnapshot(
      './__snapshots__/blockMap.ship.txt'
    );
  });
});
