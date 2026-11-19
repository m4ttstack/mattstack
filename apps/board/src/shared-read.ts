/** One read per key at a time, its result reused for `freshMs` and its
    failure replayed for `failMs`. A slow daemon must not get one read per
    caller per poll, each timing out and retried on the next: that load is
    what keeps it slow. */
export function sharedRead<T>(
  read: (key: string) => Promise<T>,
  opts: { freshMs: number; failMs: number; now?: () => number }
): (key: string) => Promise<T> {
  const now = opts.now ?? Date.now;
  const settled = new Map<
    string,
    { at: number; ok: true; value: T } | { at: number; ok: false; err: unknown }
  >();
  const inFlight = new Map<string, Promise<T>>();
  return key => {
    const hit = settled.get(key);
    if (hit) {
      const age = now() - hit.at;
      if (hit.ok && age < opts.freshMs) return Promise.resolve(hit.value);
      if (!hit.ok && age < opts.failMs) return Promise.reject(hit.err);
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
    const p = read(key)
      .then(
        value => {
          settled.set(key, { at: now(), ok: true, value });
          return value;
        },
        (err: unknown) => {
          settled.set(key, { at: now(), ok: false, err });
          throw err;
        }
      )
      .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  };
}
