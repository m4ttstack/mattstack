import type { BlocksPayload } from '../../../../server/blocksPayload';

type Graph = BlocksPayload['graphs'][number];
type Shape = Graph['nodes'][number]['shape'];
type EdgeSpec = [from: string, to: string, label?: string, dashed?: boolean];

export function graphOf(
  nodes: [
    id: string,
    label: string | null,
    shape: Shape,
    blockId: string | null,
  ][],
  edges: EdgeSpec[]
): Graph {
  return {
    blockId: 'ship/flow',
    nodes: nodes.map(([id, label, shape, blockId], line) => ({
      id,
      label,
      shape,
      cls: null,
      line,
      blockId,
    })),
    edges: edges.map(([from, to, label, dashed], line) => ({
      from,
      to,
      label: label ?? null,
      style: dashed ? 'dashed' : null,
      line,
    })),
  };
}

/** The plan's ship-shaped cases: a 2-hop cycle through `fix_test_first`,
    a 3-hop cycle through `fix_rounds_left`, and `rebase_this_pass` two hops
    out on a 6-hop loop back. */
export const shipShaped = graphOf(
  [
    ['tree_dirty', 'Tree dirty?', 'diamond', null],
    ['commit_named', 'Commit named', 'box', 'ship/flow/commit-named'],
    ['stash_them', 'Stash them', 'box', 'ship/flow/stash-them'],
    ['rebase_status', 'Rebase status?', 'diamond', null],
    ['fast_checks', 'Fast checks', 'box', 'ship/flow/fast-checks'],
    ['checks_pass', 'Checks pass?', 'diamond', null],
    ['fix_test_first', 'Fix test-first', 'box', 'ship/flow/fix-test-first'],
    ['fix_rounds_left', 'Fix rounds left?', 'diamond', null],
    ['rebase_this_pass', 'Rebase this pass?', 'diamond', null],
    ['push_branch', 'Push', 'box', 'ship/flow/push'],
    ['watch_ci', 'Watch CI', 'box', 'ship/flow/watch-ci'],
  ],
  [
    ['tree_dirty', 'commit_named', 'commit'],
    ['tree_dirty', 'stash_them', 'stash'],
    ['tree_dirty', 'fast_checks', 'clean'],
    ['commit_named', 'fast_checks'],
    ['stash_them', 'fast_checks'],
    ['fast_checks', 'checks_pass'],
    ['fast_checks', 'fix_test_first', 'red test', true],
    ['fix_test_first', 'fast_checks', 'fix, then re-check'],
    ['checks_pass', 'fix_rounds_left', 'no'],
    ['fix_rounds_left', 'fast_checks', 'no'],
    ['checks_pass', 'rebase_this_pass', 'yes'],
    ['rebase_this_pass', 'push_branch', 'then push'],
    ['push_branch', 'watch_ci'],
    ['watch_ci', 'rebase_status'],
    ['rebase_status', 'fast_checks', 'clean or finished'],
  ]
);
