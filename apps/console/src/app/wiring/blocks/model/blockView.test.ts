import { describe, expect, it } from 'vitest';

import {
  miniPayload,
  shipPayload,
  withInclude,
} from '../__tests__/blocksFixture';
import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import {
  blockCount,
  bodyOf,
  graphOfBlock,
  includeNameOf,
  labelledGraph,
  leadOf,
  mapGraphOf,
  renderedRangeOf,
  scopeStats,
  sharedRootOf,
  withoutLead,
} from './blockView';

const byId = (id: string) => miniPayload.blocks.find(block => block.id === id)!;

const block = (
  id: string,
  parentId: string | null,
  extra: Partial<PayloadBlock> = {}
): PayloadBlock => ({
  ...byId('mini/run'),
  id,
  parentId,
  kind: 'note',
  ...extra,
});

describe('bodyOf', () => {
  it("drops the block's own title line from its text", () => {
    const body = bodyOf(byId('mini/run'));
    expect(body.segments.map(segment => segment.text)).toEqual([
      'Do the work for the widget.',
    ]);
  });

  it('keeps a headless block as it is', () => {
    const guard = byId('mini/run/guard');
    expect(bodyOf(guard)).toBe(guard);
  });

  it('keeps the prop segments after the title', () => {
    const gate = bodyOf(byId('mini/gate'));
    expect(gate.segments.map(segment => segment.prop)).toEqual([
      null,
      'tiering',
    ]);
    expect(gate.segments[0].text.startsWith('Ask the human')).toBe(true);
  });
});

describe('shared blocks', () => {
  const payload: BlocksPayload = {
    ...miniPayload,
    blocks: [
      block('s', null),
      block('gate-protocol', 's', { kind: 'shared' }),
      block('wrap-up', 's', { kind: 'shared' }),
      block('wrap-up/form', 'wrap-up', { kind: 'shared' }),
      block('s/own', 's'),
    ],
    includes: [
      { name: 'gate-protocol', blockId: 's' },
      { name: 'wrap-up-form', blockId: 's' },
    ],
  };
  const of = (id: string) => payload.blocks.find(b => b.id === id)!;

  it('walks a shared block up to the top of its shared tree', () => {
    expect(sharedRootOf(payload, of('wrap-up/form'))?.id).toBe('wrap-up');
    expect(sharedRootOf(payload, of('s/own'))).toBeNull();
  });

  it("names a shared tree by its includer's include in the same place", () => {
    expect(includeNameOf(payload, of('gate-protocol'))).toBe('gate-protocol');
    expect(includeNameOf(payload, of('wrap-up'))).toBe('wrap-up-form');
    expect(includeNameOf(payload, of('s/own'))).toBeNull();
  });
});

describe('renderedRangeOf', () => {
  it('spans a block and everything under it', () => {
    expect(renderedRangeOf(miniPayload, byId('mini/run'))).toEqual([36, 48]);
    expect(renderedRangeOf(miniPayload, byId('mini/gate'))).toEqual([49, 56]);
  });
});

describe('graphs', () => {
  it("finds the graph a block's node sits in", () => {
    expect(graphOfBlock(miniPayload, byId('mini/gate'))).toMatchObject({
      node: 'ask_gate',
      graph: { blockId: 'mini' },
    });
    expect(graphOfBlock(miniPayload, byId('mini/notes'))).toBeNull();
  });

  it("labels a block's node with the block's short label", () => {
    const graph = labelledGraph(miniPayload, miniPayload.graphs[0]);
    expect(graph.nodes.map(node => node.label)).toEqual([
      'Trigger: the step opens',
      'Run',
      'Gate',
      'Finished',
    ]);
  });

  it('returns the same labelled graph for the same payload and graph', () => {
    const graph = miniPayload.graphs[0]!;
    expect(labelledGraph(miniPayload, graph)).toBe(
      labelledGraph(miniPayload, graph)
    );
    expect(labelledGraph(miniPayload, { ...graph })).not.toBe(
      labelledGraph(miniPayload, graph)
    );
  });

  it("finds the graph a zoom level's block map draws", () => {
    expect(
      mapGraphOf(miniPayload, { level: 'block', block: byId('mini/gate') })
    ).toMatchObject({ highlight: 'ask_gate', graph: { blockId: 'mini' } });
    expect(
      mapGraphOf(miniPayload, { level: 'block', block: byId('mini/notes') })
    ).toBeNull();
    expect(mapGraphOf(miniPayload, { level: 'skill' })).toMatchObject({
      highlight: null,
      graph: { blockId: 'mini' },
    });
    expect(
      mapGraphOf(miniPayload, { level: 'parent', block: byId('mini/run') })
    ).toBeNull();
  });

  it('counts every block under the root', () => {
    expect(blockCount(miniPayload)).toBe(5);
    expect(blockCount(withInclude())).toBe(6);
  });
});

describe('leadOf', () => {
  const ship = (id: string) => shipPayload.blocks.find(b => b.id === id)!;

  it("reads the block's first prose paragraph as plain text", () => {
    expect(leadOf(bodyOf(ship('ship/flow')))).toBe(
      "<root> is the worktree root, the absolute path git rev-parse --show-toplevel prints. <default> is the repo's default branch, git symbolic-ref --short refs/remotes/origin/HEAD minus origin/, never guessed."
    );
  });

  it('skips a graph that comes first', () => {
    expect(leadOf(bodyOf(ship('ship/run')))).toMatch(
      /^An own run is a fresh, resumed or reopened one: .* hands back to the verb that invoked it\.$/
    );
  });

  it('is null for a block with no prose of its own', () => {
    expect(leadOf(block('x', null, { segments: [] }))).toBeNull();
  });

  it('drops that paragraph from the text, wherever it sits', () => {
    const run = bodyOf(ship('ship/run'));
    const rest = withoutLead(run, leadOf(run));
    expect(rest.segments[0]!.text).toContain('```mermaid');
    expect(rest.segments[0]!.text).not.toContain('An own run is a fresh');
    expect(rest.segments[0]!.text).toContain('The flags, rendered');
  });
});

describe('scopeStats', () => {
  it('counts the blocks, the ones with props, the values passed, graphs and shared trees', () => {
    expect(scopeStats(shipPayload, null)).toMatchObject({
      blocks: blockCount(shipPayload),
      graphs: 2,
      shared: 5,
    });
    const flow = scopeStats(
      shipPayload,
      shipPayload.blocks.find(b => b.id === 'ship/flow')!
    );
    expect(flow).toEqual({
      blocks: 21,
      withProps: 13,
      values: 4,
      graphs: 1,
      shared: 0,
    });
  });

  it('counts an include inside a block once: its heading, not its tree too', () => {
    const run = shipPayload.blocks.find(b => b.id === 'ship/run')!;
    expect(scopeStats(shipPayload, run)).toMatchObject({
      blocks: 8,
      shared: 1,
    });
  });
});
