/**
 * Wraps a daemon read so concurrent callers with the same key share one
 * in-flight call, and an `ok` answer is reused for `ttlMs`. A failed answer
 * is never cached.
 */
export function sharedRead<T extends { ok: boolean }>(
  read: (key: string) => Promise<T>,
  ttlMs = 0
): (key: string) => Promise<T> {
  const inflight = new Map<string, Promise<T>>();
  const cached = new Map<string, { at: number; value: T }>();
  return key => {
    const hit = cached.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
    const running = inflight.get(key);
    if (running) return running;
    const pending = read(key)
      .then(value => {
        if (value.ok && ttlMs > 0) cached.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
  };
}
