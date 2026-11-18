import { describe, expect, it } from 'vitest';

import { renderedSourceOf, type RenderedSourceInput } from './renderedSource';

const husk = { rendered: { husk: true as const, text: 'full' } };
const full = { rendered: {} };
const base: RenderedSourceInput = {
  fromFile: false,
  ready: true,
  readOnly: false,
  anatomy: husk,
  anatomyError: null,
  anatomyFetching: false,
  blocksFetching: false,
};
const of = (change: Partial<RenderedSourceInput>) =>
  renderedSourceOf({ ...base, ...change });

describe('renderedSourceOf', () => {
  it('reads the file for a board skill, a hand-written skill, or blocks not in hand', () => {
    expect(of({ fromFile: true })).toEqual({ kind: 'file' });
    expect(of({ readOnly: true })).toEqual({ kind: 'file' });
    expect(of({ ready: false })).toEqual({ kind: 'file' });
  });

  it('waits for anatomy before it reads anything', () => {
    expect(of({ anatomy: undefined })).toEqual({ kind: 'pending' });
  });

  it('says anatomy failed rather than read a file that may be the husk', () => {
    expect(of({ anatomy: undefined, anatomyError: 'boom' })).toEqual({
      kind: 'error',
      message: 'boom',
    });
    expect(of({ anatomyError: 'boom' })).toEqual({
      kind: 'error',
      message: 'boom',
    });
  });

  it('reads the file for a pack that commits full skills, even past a failed refetch', () => {
    expect(of({ anatomy: full })).toEqual({ kind: 'file' });
    expect(of({ anatomy: full, anatomyError: 'boom' })).toEqual({
      kind: 'file',
    });
  });

  it("hands a husk pack's text, settled only once both reads land", () => {
    expect(of({})).toEqual({ kind: 'husk', text: 'full', settled: true });
    expect(of({ anatomyFetching: true })).toMatchObject({ settled: false });
    expect(of({ blocksFetching: true })).toMatchObject({ settled: false });
  });
});
