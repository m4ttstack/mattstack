import { describe, expect, it } from 'vitest';

import { miniPayload } from '../__tests__/blocksFixture';
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
  renderedRangeOf,
  sharedRootOf,
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

  it('counts every block under the root', () => {
    expect(blockCount(miniPayload)).toBe(5);
  });
});
