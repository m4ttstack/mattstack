export interface StaleFetch<T> {
  fetch: () => Promise<T | null>;
  timeoutMs: number;
  store: (fresh: T) => void;
  render: (data: T | null) => void;
  fallback: T | null;
  onError: (message: string) => void;
}

export async function settleStaleFetch<T>(args: StaleFetch<T>): Promise<void> {
  let fresh: T | null = null;
  try {
    fresh = await Promise.race([
      args.fetch(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), args.timeoutMs)),
    ]);
    if (fresh) args.store(fresh);
  } catch (err) {
    args.onError(err instanceof Error ? err.message : 'Unknown error');
  } finally {
    args.render(fresh ?? args.fallback);
  }
}

/**
 * The newest update that has not rejected owns the bar. A rejected update
 * hands it back to the newest older one, whose held result then paints, so
 * the bar never stays on a spinner nobody will clear. A finished update
 * retires every older one.
 */
export function createUpdateGate() {
  let next = 0;
  const live = new Set<number>();
  const held = new Map<number, () => void>();
  const latest = () => Math.max(0, ...live);

  return {
    async run(update: (id: number) => Promise<void>): Promise<void> {
      const id = ++next;
      live.add(id);
      try {
        await update(id);
      } catch (err) {
        live.delete(id);
        held.delete(id);
        const owner = latest();
        const paint = held.get(owner);
        held.delete(owner);
        paint?.();
        throw err;
      }
      for (const older of [...live]) {
        if (older < id) live.delete(older);
      }
      for (const older of [...held.keys()]) {
        if (older < id) held.delete(older);
      }
    },
    isLatest(id: number): boolean {
      return id === latest();
    },
    paint(id: number, fn: () => void): void {
      if (id === latest()) fn();
      else if (live.has(id)) held.set(id, fn);
    },
  };
}
