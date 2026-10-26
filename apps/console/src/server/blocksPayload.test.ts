import { describe, expect, it } from 'vitest';

import type { BlocksPayload } from './blocksPayload';
import mini from './fixtures/design/blocks.mini.json';
import ship from './fixtures/design/blocks.ship.json';
import stagePlan from './fixtures/design/blocks.stage-plan.json';

/** What a JSON import can prove: its tuples read as arrays and its literal unions as strings. */
type Loose<T> = T extends string
  ? string
  : T extends readonly unknown[]
    ? Loose<T[number]>[]
    : T extends object
      ? { [K in keyof T]: Loose<T[K]> }
      : T;

describe('the blocks payload type', () => {
  it('is satisfied by the committed mini payload', () => {
    const payload: Loose<BlocksPayload> = mini;
    expect(payload.skill).toBe('mini');
    expect(payload.blocks.length).toBeGreaterThan(0);
  });

  it('is satisfied by the payloads rt made from the real ship and stage-plan engines', () => {
    const verb: Loose<BlocksPayload> = ship;
    const stage: Loose<BlocksPayload> = stagePlan;
    expect(verb.kind).toBe('verb');
    expect(stage.kind).toBe('stage');
  });
});

describe('the committed blocks payloads', () => {
  const committed = { mini, ship, 'stage-plan': stagePlan };

  for (const [name, payload] of Object.entries(committed)) {
    it(`declares and counts every layer ${name} uses`, () => {
      const loose: Loose<BlocksPayload> = payload;
      const used = new Set<string>();
      for (const block of loose.blocks) {
        for (const prop of block.props)
          for (const value of prop.values) used.add(value.layer);
        for (const segment of block.segments) used.add(segment.layer);
      }
      used.delete('default');
      const labels = new Set(loose.layers.map(layer => layer.label));
      for (const layer of used)
        expect(labels, `${layer} has no layers entry`).toContain(layer);
      const counted = new Set(loose.lines.map(row => row.layer));
      for (const layer of loose.layers)
        expect(counted, `${layer.label} has no lines row`).toContain(
          layer.label
        );
    });
  }
});
