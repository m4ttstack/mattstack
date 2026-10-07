import { describe, expect, it } from 'vitest';

import { baseLabel, ownerOf } from './owner';

describe('ownerOf', () => {
  it('reads origin first, so a team-pack copy of a base file is the base', () => {
    expect(
      ownerOf(
        'acme:dev-servers',
        { origin: 'base', base: 'acme-base', baseVersion: '0.1.0' },
        'acme'
      )
    ).toEqual({ kind: 'base', name: 'acme-base', version: '0.1.0' });
  });
  it('is the pack when the ref is the pack and nothing says base', () => {
    expect(ownerOf('acme:plan-policy', {}, 'acme')).toEqual({ kind: 'pack' });
  });
  it('is a plugin otherwise, including an older rt that sends no origin', () => {
    expect(ownerOf('acme-base:reply-rules', undefined, 'acme')).toEqual({
      kind: 'plugin',
      name: 'acme-base',
    });
    expect(ownerOf('mattstack:model-tiering', null, 'acme')).toEqual({
      kind: 'plugin',
      name: 'mattstack',
    });
  });
  it('keeps a missing base version null', () => {
    expect(
      ownerOf('acme-base:x', { origin: 'base', base: 'acme-base' }, 'acme')
    ).toEqual({ kind: 'base', name: 'acme-base', version: null });
  });
});

describe('baseLabel', () => {
  it('names the version only when there is one, never the org token', () => {
    expect(
      baseLabel({ kind: 'base', name: 'acme-base', version: '0.1.0' })
    ).toBe('acme-base 0.1.0');
    expect(baseLabel({ kind: 'base', name: 'acme-base', version: null })).toBe(
      'acme-base'
    );
  });
});
