import { describe, expect, it } from 'vitest';

import { drawersOf, withParams } from './drawerParams';

describe('withParams', () => {
  it('keeps a bare flag bare and drops a cleared one', () => {
    expect(withParams('?inputs&x=1', p => p.set('doc', 'plan'))).toBe(
      '?inputs&x=1&doc=plan'
    );
    expect(withParams('?inputs', p => p.delete('inputs'))).toBe('');
  });
});

describe('drawersOf', () => {
  it('lets a stage doc win over the inputs drawer, keeping the way back', () => {
    expect(drawersOf('?inputs&doc=plan')).toEqual({
      inputs: false,
      doc: 'plan',
    });
    expect(drawersOf('?inputs')).toEqual({ inputs: true, doc: null });
    expect(drawersOf('')).toEqual({ inputs: false, doc: null });
  });
});
