import { readdirSync, readFileSync, statSync } from 'node:fs';
import { getMimeType } from 'hono/utils/mime';

import { injectHostSignal } from './host-signal';
import { buildIdOf, type HealthState } from './instance';

export interface SnapshotFs {
  /** Every file under `root`, as paths relative to it. */
  list(root: string): string[];
  read(path: string): Uint8Array;
  mtimeMs(path: string): number;
}

export interface StaticSnapshot {
  files: Map<string, { body: Uint8Array; type: string }>;
  indexHtml: string | null;
  buildId: string | null;
  indexMtimeMs: number | null;
}

export const nodeSnapshotFs: SnapshotFs = {
  list(root) {
    const out: string[] = [];
    const walk = (rel: string) => {
      for (const entry of readdirSync(rel ? `${root}/${rel}` : root, {
        withFileTypes: true,
      })) {
        const child = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(child);
        else if (entry.isFile()) out.push(child);
      }
    };
    walk('');
    return out;
  },
  read: path => readFileSync(path),
  mtimeMs: path => statSync(path).mtimeMs,
};

const isMissing = (err: unknown) =>
  (err as { code?: unknown } | null)?.code === 'ENOENT';

const emptySnapshot = (): StaticSnapshot => ({
  files: new Map(),
  indexHtml: null,
  buildId: null,
  indexMtimeMs: null,
});

/** Throws on any read failure except a `distRoot` that does not exist. */
export function readSnapshot(
  distRoot: string,
  fs: SnapshotFs
): StaticSnapshot {
  let paths: string[];
  try {
    paths = fs.list(distRoot);
  } catch (err) {
    if (isMissing(err)) return emptySnapshot();
    throw err;
  }
  const snapshot = emptySnapshot();
  for (const rel of paths) {
    const path = `${distRoot}/${rel}`;
    if (rel === 'index.html') {
      // Stat before reading: a rebuild landing in between leaves an older
      // mtime behind, so the next index request reads again.
      snapshot.indexMtimeMs = fs.mtimeMs(path);
      const raw = new TextDecoder().decode(fs.read(path));
      snapshot.buildId = buildIdOf(raw);
      snapshot.indexHtml = injectHostSignal(raw, snapshot.buildId);
      continue;
    }
    snapshot.files.set(`/${rel}`, {
      body: fs.read(path),
      type: getMimeType(rel) ?? 'application/octet-stream',
    });
  }
  return snapshot;
}

export function createMemoryStatic(
  distRoot: string,
  fs: SnapshotFs = nodeSnapshotFs
): {
  serve(path: string): Response | null;
  index(): Response | null;
  health(): HealthState;
} {
  const indexPath = `${distRoot}/index.html`;
  let snapshot = emptySnapshot();
  let state: HealthState = { ok: true, buildId: null };

  const load = (): boolean => {
    try {
      snapshot = readSnapshot(distRoot, fs);
      state = { ok: true, buildId: snapshot.buildId };
      return true;
    } catch {
      return false;
    }
  };
  if (!load()) state = { ok: false, buildId: null };

  const refreshIfRebuilt = (): void => {
    let mtime: number;
    try {
      mtime = fs.mtimeMs(indexPath);
    } catch {
      return;
    }
    if (mtime !== snapshot.indexMtimeMs) load();
  };

  const existsOnDisk = (path: string): boolean => {
    if (path.includes('..')) return false;
    try {
      fs.mtimeMs(`${distRoot}${path}`);
      return true;
    } catch {
      return false;
    }
  };

  const fileResponse = (path: string): Response | null => {
    const file = snapshot.files.get(path);
    return file
      ? new Response(file.body as Uint8Array<ArrayBuffer>, {
          headers: { 'content-type': file.type },
        })
      : null;
  };

  return {
    serve(path) {
      const hit = fileResponse(path);
      if (hit) return hit;
      refreshIfRebuilt();
      const afterIndex = fileResponse(path);
      if (afterIndex || !existsOnDisk(path)) return afterIndex;
      // Vite can write index.html before its larger chunks, so a snapshot
      // taken in between lacks files the index mtime will never flag again.
      load();
      return fileResponse(path);
    },
    index() {
      refreshIfRebuilt();
      return snapshot.indexHtml === null
        ? null
        : new Response(snapshot.indexHtml, {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
    },
    health: () => state,
  };
}
