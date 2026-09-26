import { describe, test, expect } from 'bun:test';
import { fileDependencies } from '../scripts/release.ts';

describe('fileDependencies', () => {
  test('empty when there are no dependencies at all', () => {
    expect(fileDependencies({})).toEqual([]);
  });

  test('empty when every dependency is a registry spec', () => {
    expect(fileDependencies({ dependencies: { picomatch: '^4.0.2', '@mattstack/glance': '^0.19.0' } })).toEqual([]);
  });

  test('names a dependency pinned to a local path', () => {
    expect(
      fileDependencies({ dependencies: { '@mattstack/rt-client': 'file:../repo-tools/packages/rt-client' } }),
    ).toEqual(['@mattstack/rt-client']);
  });

  test('names every offending dependency, leaving registry ones out', () => {
    const deps = {
      '@mattstack/rt-client': 'file:../repo-tools/packages/rt-client',
      picomatch: '^4.0.2',
      '@mattstack/glance': 'file:../glance',
    };
    expect(fileDependencies({ dependencies: deps })).toEqual(['@mattstack/rt-client', '@mattstack/glance']);
  });
});
