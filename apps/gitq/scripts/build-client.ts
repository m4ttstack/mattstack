// Writes the client bundle to dist/client/ so `bun build --compile` (see the
// `build:binary` script) can embed it into the standalone binary via the text
// import in src/compiled.ts. Run automatically by `bun run build:binary`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildClientBundle } from '../src/server/client-bundle.ts';

const outDir = join(import.meta.dir, '..', 'dist', 'client');
mkdirSync(outDir, { recursive: true });
const { appJs } = await buildClientBundle();
// .txt, not .js: tsc treats a REAL .js file on disk as a resolvable module and
// tries to typecheck its exports (the bundle is a bare IIFE with none),
// bypassing the "*.js" ambient wildcard declaration entirely. .txt has no such
// special handling, so it always falls through to asset-text.d.ts.
writeFileSync(join(outDir, 'app.js.txt'), appJs);
console.log(`client bundle written to dist/client/app.js.txt (${appJs.length}b)`);
