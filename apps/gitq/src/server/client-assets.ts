import { buildClientBundle, type ClientBundle } from './client-bundle.ts';

let injected: ClientBundle | null = null;
let resolved = false;

/**
 * The compiled entry (src/compiled.ts) hands over a pre-built, embedded client
 * bundle BEFORE importing the server -- a standalone binary cannot run
 * Bun.build against a source tree it does not carry. Must be called before
 * getClientAssets(); a later call would be ignored by a server that already
 * bundled, so it throws instead of lying.
 */
export function injectClientAssets(assets: ClientBundle): void {
  if (resolved) throw new Error('injectClientAssets called after the server already loaded its client bundle');
  injected = assets;
}

/** Injected assets when running compiled; a fresh runtime bundle in dev. */
export async function getClientAssets(): Promise<ClientBundle> {
  resolved = true;
  return injected ?? (await buildClientBundle());
}

/** Test seam: clears both the injection and the resolved latch. */
export function resetClientAssets(): void {
  injected = null;
  resolved = false;
}
