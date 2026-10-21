import { mkdirSync, watch, writeFileSync, type FSWatcher } from 'fs';
import { join } from 'path';

import {
  buildClientBundle,
  type ClientBundle,
  type ClientChunks,
} from './client-bundle.ts';

const CHUNK_PATH = /^\/(chunk-[a-z0-9]+\.js)$/;

function chunkMap(chunks: ClientChunks): Record<string, string> {
  return typeof chunks === 'function' ? chunks() : chunks;
}

/** A chunk map read the first time a chunk is asked for, then kept. */
export function lazyChunks(
  load: () => Record<string, string>
): () => Record<string, string> {
  let map: Record<string, string> | null = null;
  return () => (map ??= load());
}

/** A request for one of the bundle's code-split chunks: the chunk, cached
    for good since its name is its content hash, or a 404. Null for every
    other path. */
export function clientChunkResponse(
  pathname: string,
  chunks: ClientChunks
): Response | null {
  const name = CHUNK_PATH.exec(pathname)?.[1];
  if (!name) return null;
  const map = chunkMap(chunks);
  const text = Object.hasOwn(map, name) ? map[name] : undefined;
  if (text === undefined) return new Response('unknown chunk', { status: 404 });
  return new Response(text, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

/** A dev rebuild's bundle, still holding the chunks the one before it
    emitted: a page loaded before the rebuild imports those names until it
    reloads. */
export function withEarlierChunks(
  prev: ClientBundle,
  next: ClientBundle
): ClientBundle {
  return {
    ...next,
    chunks: { ...chunkMap(prev.chunks), ...chunkMap(next.chunks) },
  };
}

/** Writes the bundle where src/compiled.ts text-imports it. .txt, not .js:
    tsc treats a REAL .js file on disk as a resolvable module and tries to
    typecheck its exports, bypassing the "*.js" ambient wildcard; .txt always
    falls through to asset-text.d.ts's "*.txt" rule. The chunks ride as one
    JSON text file, so the compiled entry embeds every chunk with one import
    whatever the chunk count. */
export function writeClientBundle(outDir: string, bundle: ClientBundle): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'app.js.txt'), bundle.appJs);
  writeFileSync(join(outDir, 'app.css'), bundle.appCss);
  writeFileSync(
    join(outDir, 'chunks.json.txt'),
    JSON.stringify(chunkMap(bundle.chunks))
  );
}

/** The chunk map writeClientBundle embedded, as the compiled entry reads it. */
export function parseChunkManifest(text: string): Record<string, string> {
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.values(parsed).some(v => typeof v !== 'string')
  )
    throw new Error('embedded client chunks are not a name to text map');
  return parsed as Record<string, string>;
}

let injected: ClientBundle | null = null;

/**
 * The compiled entry (src/compiled.ts) hands over pre-built, embedded client
 * assets BEFORE importing the server — a standalone binary cannot run
 * Bun.build against a source tree it does not carry. Must be called before
 * getClientAssets(); a later call would be ignored by a server that already
 * bundled, so it throws instead of lying.
 */
export function injectClientAssets(assets: ClientBundle): void {
  if (resolved)
    throw new Error(
      'injectClientAssets called after the server already loaded its client bundle'
    );
  injected = assets;
}

let resolved = false;

/** Injected assets when running compiled; a fresh runtime bundle in dev. */
export async function getClientAssets(): Promise<ClientBundle> {
  resolved = true;
  return injected ?? (await buildClientBundle());
}

/**
 * Coalesces a burst of file events into one build, and a change that lands
 * mid-build into exactly one more, so the served bundle always reflects the
 * last save. A failed build (a half-typed file) is reported and the previous
 * bundle stays up.
 */
export function createRebuilder<T>(opts: {
  build: () => Promise<T>;
  onBuilt: (result: T, ms: number) => void;
  onFailed: (err: unknown) => void;
  delayMs: number;
}): { poke: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let building = false;
  let dirty = false;
  const run = async () => {
    building = true;
    do {
      dirty = false;
      const started = performance.now();
      try {
        const result = await opts.build();
        opts.onBuilt(result, Math.round(performance.now() - started));
      } catch (err) {
        opts.onFailed(err);
      }
    } while (dirty);
    building = false;
  };
  return {
    poke() {
      if (building) {
        dirty = true;
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, opts.delayMs);
    },
  };
}

/**
 * Dev only: rebuild the client bundle whenever a file under src/client
 * changes, and report a stylesheet save (which /style.css already re-reads
 * from disk) so the caller can tell browsers to reload either way. Returns
 * the stop function.
 */
export function watchClientAssets(handlers: {
  onBundle: (assets: ClientBundle) => void;
  onStyle: () => void;
}): () => void {
  const clientDir = join(import.meta.dir, 'client');
  const stylePath = join(import.meta.dir, 'style.css');
  const rebuilder = createRebuilder({
    build: buildClientBundle,
    onBuilt: (assets, ms) => {
      console.log(`client bundle rebuilt in ${ms}ms`);
      handlers.onBundle(assets);
    },
    onFailed: err =>
      console.error(
        `client bundle rebuild failed, serving the previous one: ${String(err)}`
      ),
    delayMs: 120,
  });
  const watchers: FSWatcher[] = [
    watch(clientDir, { recursive: true }, () => rebuilder.poke()),
    watch(stylePath, () => handlers.onStyle()),
  ];
  return () => {
    for (const w of watchers) w.close();
  };
}
