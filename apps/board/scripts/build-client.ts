// Writes the client bundle to dist/client/ so `bun build --compile` (see the
// `build` script) can embed it into the standalone binary via text imports in
// src/compiled.ts. Run automatically by `bun run build`.
import { join } from 'path';

import { writeClientBundle } from '../src/client-assets.ts';
import { buildClientBundle } from '../src/client-bundle.ts';

const outDir = join(import.meta.dir, '..', 'dist', 'client');
const bundle = await buildClientBundle();
writeClientBundle(outDir, bundle);
const chunks = Object.values(bundle.chunks);
console.log(
  `client bundle written to dist/client/ (js ${bundle.appJs.length}b, css ${bundle.appCss.length}b, ${chunks.length} chunks ${chunks.reduce((n, c) => n + c.length, 0)}b)`
);
