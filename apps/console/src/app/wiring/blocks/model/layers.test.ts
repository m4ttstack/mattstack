import { describe, expect, it } from 'vitest';

import { miniPayload } from '../__tests__/blocksFixture';
import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import { documentLayers, linesOf } from './layers';

const blockOf = (payload: BlocksPayload, id: string): PayloadBlock =>
  payload.blocks.find(block => block.id === id)!;

/** mini with an org base that replaces `tiering` on gate, and a team value
    added to an `add` prop on notes. */
function withLayers(): BlocksPayload {
  const payload = structuredClone(miniPayload);
  payload.layers.splice(1, 0, { name: 'acme', label: 'base', color: 'org' });
  const gate = blockOf(payload, 'mini/gate');
  gate.props[0]!.fromDefault = false;
  gate.segments[1] = {
    layer: 'base',
    color: 'org',
    prop: 'tiering',
    text: 'org one\norg two',
  };
  const notes = blockOf(payload, 'mini/notes');
  notes.props[0]!.merge = 'add';
  notes.segments.push({
    layer: 'pack',
    color: 'team',
    prop: 'style',
    text: 'team rule',
  });
  return payload;
}

describe('linesOf', () => {
  it('counts lines in a segment, ignoring one trailing newline', () => {
    expect(linesOf('')).toBe(0);
    expect(linesOf('one')).toBe(1);
    expect(linesOf('one\ntwo\n')).toBe(2);
  });
});

describe('documentLayers', () => {
  it('counts a block mattstack wrote alone, naming no layer as quiet', () => {
    const { layers, quiet } = documentLayers(
      miniPayload,
      blockOf(miniPayload, 'mini/run')
    );
    expect(layers.map(entry => entry.layer)).toEqual(['mattstack']);
    expect(layers[0]!.what).toBeNull();
    expect(quiet).toEqual([]);
  });

  it('counts a replaced default for the layer that replaced it', () => {
    const payload = withLayers();
    const { layers, quiet } = documentLayers(
      payload,
      blockOf(payload, 'mini/gate')
    );
    expect(layers).toEqual([
      expect.objectContaining({ layer: 'mattstack', what: null }),
      {
        layer: 'org',
        name: 'acme',
        lines: 2,
        what: 'replaces the default',
      },
    ]);
    expect(quiet).toEqual(['widgets']);
  });

  it("names an added prop's values as its own", () => {
    const payload = withLayers();
    const { layers, quiet } = documentLayers(
      payload,
      blockOf(payload, 'mini/notes')
    );
    expect(layers.at(-1)).toEqual({
      layer: 'team',
      name: 'widgets',
      lines: 1,
      what: 'its style',
    });
    expect(quiet).toEqual(['acme']);
  });
});
