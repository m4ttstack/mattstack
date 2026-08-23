import { join } from 'node:path';

export interface ClientBundle {
  appJs: string;
}

/**
 * Bundle the React client from source. The dev server calls this at boot and
 * serves the result from memory; scripts/build-client.ts calls it at build
 * time so the compiled binary can embed the output instead -- a standalone
 * binary has no source tree to bundle from.
 */
export async function buildClientBundle(): Promise<ClientBundle> {
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, '..', 'client', 'client.tsx')],
    target: 'browser',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  if (!build.success) {
    console.error(build.logs.join('\n'));
    throw new Error('client bundle failed');
  }
  const entries = build.outputs.filter((o) => o.kind === 'entry-point');
  if (entries.length !== 1) throw new Error(`expected 1 JS entry-point output, got ${entries.length}`);
  return { appJs: await entries[0]!.text() };
}
