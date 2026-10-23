import { describe, expect, it } from 'vitest';

import type { BlocksPayload } from './blocksPayload';
import mini from './fixtures/design/blocks.mini.json';

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
});
