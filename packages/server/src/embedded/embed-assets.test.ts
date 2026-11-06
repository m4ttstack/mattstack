// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { manifestSource } from '../../bin/mattstack-embed-assets';

describe('manifestSource', () => {
  const dist = '/app/dist';
  const out = '/app/src/server/embedded/manifest.ts';
  const source = manifestSource(dist, out, [
    '/app/dist/assets/index-abc.js',
    '/app/dist/index.html',
  ]);

  it('imports every file with the file loader', () => {
    expect(source).toContain(
      "import asset0 from '../../../dist/assets/index-abc.js' with { type: 'file' };"
    );
    expect(source).toContain(
      "import asset1 from '../../../dist/index.html' with { type: 'file' };"
    );
  });

  it('resolves each import against the module dir, never the cwd', () => {
    expect(source).toContain('resolve(import.meta.dir, p)');
    expect(source).toContain('indexHtmlPath: at(asset1),');
    expect(source).toContain('"/assets/index-abc.js": at(asset0),');
    expect(source).toContain('"/index.html": at(asset1),');
  });
});
