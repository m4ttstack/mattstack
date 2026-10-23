import { describe, expect, it } from 'vitest';

import { withInclude } from '../__tests__/blocksFixture';
import type { BlocksPayload } from '../../../../server/blocksPayload';
import { includedTree, shownLabel } from './blockFacts';
import { sidebarRows } from './sidebar';
import { crumbsOf, zoomOf } from './zoom';

/** withInclude with the heading named apart from its tree, as rt names
    `wrap-up-form-contract` over the `wrap-up-form` tree. */
function payload(): BlocksPayload {
  const p = withInclude();
  p.blocks.find(b => b.id === 'mini/gate-protocol')!.label =
    'Gate protocol contract';
  return p;
}

const at = (p: BlocksPayload, id: string) => p.blocks.find(b => b.id === id)!;

describe('an include heading', () => {
  it('stands for the one shared tree under it', () => {
    const p = payload();
    expect(includedTree(p, at(p, 'mini/gate-protocol'))?.id).toBe(
      'gate-protocol'
    );
    expect(includedTree(p, at(p, 'mini/run'))).toBeNull();
  });

  it("names the tree by the heading's label", () => {
    const p = payload();
    expect(shownLabel(p, at(p, 'gate-protocol'))).toBe(
      'Gate protocol contract'
    );
    expect(shownLabel(p, at(p, 'gate-protocol/ask'))).toBe('Ask');
  });

  it('opens as its shared tree', () => {
    const p = payload();
    expect(zoomOf(p, 'mini/gate-protocol')).toEqual({
      zoom: { level: 'parent', block: at(p, 'gate-protocol') },
      missing: null,
    });
  });

  it('is one crumb, the tree under the heading label', () => {
    const p = payload();
    expect(crumbsOf(p, at(p, 'gate-protocol/ask'))).toEqual([
      { id: null, label: 'mini' },
      { id: 'gate-protocol', label: 'Gate protocol contract' },
      { id: 'gate-protocol/ask', label: 'Ask' },
    ]);
  });

  it('marks its row selected and open when the link names the heading', () => {
    const rows = sidebarRows(payload(), 'mini/gate-protocol');
    const row = rows.find(r => r.id === 'gate-protocol')!;
    expect([row.selected, row.open]).toEqual([true, true]);
  });

  it("is one sidebar row under Shared, holding the tree's own blocks", () => {
    const p = payload();
    const rows = sidebarRows(p, 'gate-protocol/ask');
    expect(
      rows
        .filter(r => r.depth > 0)
        .map(r => [r.id, r.label, r.depth, r.count, r.open, r.selected])
    ).toEqual([
      ['gate-protocol', 'Gate protocol contract', 1, 1, true, false],
      ['gate-protocol/ask', 'Ask', 2, null, false, true],
    ]);
  });
});
