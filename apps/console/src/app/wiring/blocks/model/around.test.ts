import { describe, expect, it } from 'vitest';

import { graphOf, shipShaped } from '../__tests__/aroundFixtures';
import { aroundBlock, aroundOrder } from './around';

const ids = (sub: ReturnType<typeof aroundBlock>) =>
  sub.nodes.map(node => node.id).sort();

describe('aroundBlock', () => {
  it('keeps one hop each way plus the 2- and 3-hop cycles back', () => {
    const sub = aroundBlock(shipShaped, 'fast_checks');

    expect(ids(sub)).toEqual(
      [
        'checks_pass',
        'commit_named',
        'fast_checks',
        'fix_rounds_left',
        'fix_test_first',
        'rebase_status',
        'stash_them',
        'tree_dirty',
      ].sort()
    );
  });

  it('leaves out rebase_this_pass and its far side', () => {
    const kept = ids(aroundBlock(shipShaped, 'fast_checks'));

    expect(kept).not.toContain('rebase_this_pass');
    expect(kept).not.toContain('push_branch');
    expect(kept).not.toContain('watch_ci');
  });

  it('keeps only the edges between kept nodes', () => {
    const sub = aroundBlock(shipShaped, 'fast_checks');
    const kept = new Set(sub.nodes.map(node => node.id));

    expect(sub.edges).toHaveLength(11);
    for (const edge of sub.edges) {
      expect(kept.has(edge.from) && kept.has(edge.to)).toBe(true);
    }
  });

  it('drops the far side of a 4-hop cycle and terminates', () => {
    const graph = graphOf(
      [
        ['enter', null, 'box', null],
        ['focus', null, 'box', 'b/focus'],
        ['a', null, 'box', null],
        ['far_one', null, 'box', null],
        ['far_two', null, 'box', null],
        ['c', null, 'box', null],
      ],
      [
        ['enter', 'focus'],
        ['focus', 'a'],
        ['a', 'far_one'],
        ['a', 'far_two'],
        ['far_one', 'far_two'],
        ['far_two', 'far_one'],
        ['far_one', 'c'],
        ['far_two', 'c'],
        ['c', 'focus'],
      ]
    );

    expect(ids(aroundBlock(graph, 'focus'))).toEqual(
      ['a', 'c', 'enter', 'focus'].sort()
    );
  });

  it('on the real ship flow keeps only domain_fast_checks one-hop neighbours', () => {
    // ship-flow.dot:156-182; every cycle back to the focus there is 5 hops.
    const edges: [string, string][] = [
      ['dirty_answer', 'commit_named_files'],
      ['dirty_answer', 'stash_them'],
      ['dirty_answer', 'domain_fast_checks'],
      ['commit_named_files', 'domain_fast_checks'],
      ['stash_them', 'domain_fast_checks'],
      ['domain_fast_checks', 'checks_pass'],
      ['checks_pass', 'domain_rebases_unfinished'],
      ['checks_pass', 'run_budget_fix_rounds'],
      ['run_budget_fix_rounds', 'fix_rounds_spent'],
      ['fix_rounds_spent', 'fix_test_first'],
      ['fix_rounds_spent', 'run_budget_gate_reopenings'],
      ['fix_test_first', 'domain_fast_checks'],
      ['domain_rebases_unfinished', 'git_rebase_onto'],
      ['domain_rebases_unfinished', 'needs_force_lease'],
      ['git_rebase_onto', 'rebase_status'],
      ['rebase_status', 'domain_fast_checks'],
      ['rebase_status', 'run_budget_conflict_rounds'],
      ['rebase_status', 'which_exit'],
      ['run_budget_conflict_rounds', 'conflict_rounds_spent'],
      ['conflict_rounds_spent', 'resolve_conflict_files'],
      ['conflict_rounds_spent', 'run_budget_gate_reopenings'],
      ['run_budget_gate_reopenings', 'gate_reopenings_spent'],
      ['gate_reopenings_spent', 'gate_ship'],
      ['gate_reopenings_spent', 'rebase_in_progress'],
      ['resolve_conflict_files', 'continue_result'],
      ['continue_result', 'run_budget_conflict_rounds'],
      ['continue_result', 'domain_fast_checks'],
      ['continue_result', 'git_rebase_abort'],
    ];
    const nodeIds = [...new Set(edges.flat())];
    const graph = graphOf(
      nodeIds.map(id => [id, null, 'box', null]),
      edges
    );
    const focus = 'domain_fast_checks';
    const oneHop = new Set([focus]);
    for (const [from, to] of edges) {
      if (to === focus) oneHop.add(from);
      if (from === focus) oneHop.add(to);
    }

    expect(ids(aroundBlock(graph, focus))).toEqual([...oneHop].sort());
    expect([...oneHop].sort()).toEqual(
      [
        'checks_pass',
        'commit_named_files',
        'continue_result',
        'dirty_answer',
        'domain_fast_checks',
        'fix_test_first',
        'rebase_status',
        'stash_them',
      ].sort()
    );
  });

  it('returns an empty subgraph for a node the graph lacks', () => {
    expect(aroundBlock(shipShaped, 'nope')).toEqual({ nodes: [], edges: [] });
  });
});

describe('aroundOrder', () => {
  it('puts the steps into the focus first, then the focus, then the rest, each in flow order', () => {
    const sub = aroundBlock(shipShaped, 'fast_checks');
    const order = [
      'tree_dirty',
      'commit_named',
      'stash_them',
      'fast_checks',
      'checks_pass',
      'fix_rounds_left',
      'fix_test_first',
      'rebase_this_pass',
      'push_branch',
      'watch_ci',
      'rebase_status',
    ];

    expect(aroundOrder(sub, 'fast_checks', order)).toEqual([
      'tree_dirty',
      'commit_named',
      'stash_them',
      'fix_rounds_left',
      'fix_test_first',
      'rebase_status',
      'fast_checks',
      'checks_pass',
    ]);
  });
});
