import { describe, expect, it } from 'vitest';

import {
  miniPayload,
  shipPayload,
  withInclude,
} from '../__tests__/blocksFixture';
import { sectionsAt } from './sections';
import { zoomOf } from './zoom';

const at = (id: string | null) =>
  sectionsAt(miniPayload, zoomOf(miniPayload, id).zoom);

describe('sectionsAt', () => {
  it('gathers top-level include blocks into a last Shared band, read by their shared tree', () => {
    const bands = sectionsAt(withInclude(), { level: 'skill' });
    expect(bands.map(b => [b.id, b.title, b.glyph])).toEqual([
      ['mini/run', 'Run', 'step'],
      ['notes', 'Notes', 'note'],
      ['shared', 'Shared', 'shared'],
    ]);
    expect(bands[2]!.rows.map(r => [r.id, r.summary])).toEqual([
      ['mini/gate-protocol', 'How a gate asks.'],
    ]);
  });

  it('splits the skill into a band per parent plus Notes for the leaves', () => {
    const bands = at(null);
    expect(bands.map(b => [b.id, b.title, b.blockCount])).toEqual([
      ['mini/run', 'Run', 2],
      ['notes', 'Notes', 2],
    ]);
    expect(bands[1]!.rows.map(r => r.id)).toEqual(['mini/gate', 'mini/notes']);
  });

  it('counts the blocks that carry props', () => {
    expect(at(null).map(b => b.propsCount)).toEqual([0, 2]);
  });

  it('shows a parent as one band of its children', () => {
    const bands = at('mini/run');
    expect(bands).toHaveLength(1);
    expect(bands[0]!.title).toBe('Run');
    expect(bands[0]!.rows.map(r => r.label)).toEqual(['Guard', 'Check']);
  });

  it('reads a row from the payload as given', () => {
    const gate = at(null)[1]!.rows[0]!;
    expect(gate).toMatchObject({
      glyph: 'gate',
      label: 'Gate',
      hasProps: true,
      selected: false,
    });
    expect(gate.summary).toBe(
      miniPayload.blocks.find(b => b.id === 'mini/gate')!.summary
    );
  });

  it('shows an empty node block with its label, empty summary and props', () => {
    const payload = structuredClone(miniPayload);
    const gate = payload.blocks.find(b => b.id === 'mini/gate')!;
    gate.text = '';
    gate.summary = '';
    const row = sectionsAt(payload, { level: 'skill' })[1]!.rows[0]!;
    expect(row).toMatchObject({ label: 'Gate', summary: '', hasProps: true });
  });

  it('marks the selected sibling at a block', () => {
    const bands = at('mini/run/check');
    expect(bands).toHaveLength(1);
    expect(bands[0]!.rows.map(r => [r.id, r.selected])).toEqual([
      ['mini/run/guard', false],
      ['mini/run/check', true],
    ]);
  });

  it('keeps the skill bands for a top-level leaf and marks it', () => {
    const bands = at('mini/gate');
    expect(bands.map(b => b.title)).toEqual(['Run', 'Notes']);
    expect(bands[1]!.rows[0]!.selected).toBe(true);
  });

  it('labels a headless block with no label from its id', () => {
    const payload = structuredClone(miniPayload);
    const guard = payload.blocks.find(b => b.id === 'mini/run/guard')!;
    guard.label = '';
    guard.id = 'mini/run/pre-check';
    const row = sectionsAt(payload, {
      level: 'parent',
      block: payload.blocks.find(b => b.id === 'mini/run')!,
    })[0]!.rows[0]!;
    expect(row.label).toBe('Pre check');
  });

  it("gives a Shared row its include's name and the tree's line count", () => {
    const payload = withInclude();
    const span = (id: string) => {
      const [from, to] = payload.blocks.find(b => b.id === id)!.lines;
      return to - from + 1;
    };
    const shared = sectionsAt(payload, { level: 'skill' }).at(-1)!;
    expect(shared.rows[0]!.shared).toEqual({
      name: 'gate-protocol',
      lines: span('gate-protocol') + span('gate-protocol/ask'),
    });
    expect(at(null)[0]!.rows[0]!.shared).toBeNull();
  });

  it('marks the band of the entry graph, other graph bands, and the rest by kind', () => {
    const bands = sectionsAt(shipPayload, { level: 'skill' });
    expect(bands.map(b => [b.title, b.icon])).toEqual([
      ['Run', 'entry'],
      ['Flow', 'graph'],
      ['Notes', 'note'],
      ['Shared', 'shared'],
    ]);
    expect(at(null).map(b => b.icon)).toEqual(['step', 'note']);
  });

  it("leads a section band with its block's first sentence", () => {
    const bands = sectionsAt(shipPayload, { level: 'skill' });
    const run = shipPayload.blocks.find(b => b.id === 'ship/run')!;
    expect(bands[0]!.intro).toBe(run.summary);
    expect(bands.find(b => b.id === 'notes')!.intro).toBeNull();
  });
});
