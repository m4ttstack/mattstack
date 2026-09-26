const warned = new Set<string>();

/**
 * Warns once per process for a settings key whose store resolver threw,
 * then suppresses every further identical warning for that key -- a wedged
 * rt daemon connection would otherwise re-warn on every read in a hot path.
 * Prints only the error's message, never the Error object itself, so no
 * store contents riding along on the error can leak into logs.
 */
export function warnStoreFallback(key: string, fallbackDescription: string, err: unknown): void {
  if (warned.has(key)) return;
  warned.add(key);
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`gitq: ${key} unavailable, falling back to ${fallbackDescription}`, message);
}

/** Test seam: clears the once-per-process state so a test can assert the warn-then-suppress behavior from a clean slate. */
export function resetStoreFallbackWarnings(): void {
  warned.clear();
}
