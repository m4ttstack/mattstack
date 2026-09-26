export interface Snapshot<T> {
  data: T;
  fetchedAt: number;
  fetchError: string | null;
}

const TTL_MS = 60_000;

/** Single-snapshot stale-while-revalidate cache (mr-board's, made generic).
    Serves the cached snapshot while a background refresh runs; only the very
    first call (no snapshot yet) waits. Concurrent refreshes share one
    in-flight promise. A failed refresh keeps the last good data and stamps
    fetchError. */
export class SnapshotCache<T> {
  private snapshot: Snapshot<T> | null = null;
  private inflight: Promise<Snapshot<T>> | null = null;
  private stale = false;
  private generation = 0;

  constructor(
    private fetchData: () => Promise<T>,
    private emptyData: T,
    private now: () => number = Date.now,
    private ttlMs: number = TTL_MS,
  ) {}

  /** Drop the snapshot entirely; the next get() blocks on a fresh fetch. */
  invalidate(): void {
    this.snapshot = null;
  }

  /** Keep serving the current snapshot but force the next get() to refresh.
      Bumps the generation so a refresh already in flight cannot clear the
      stale flag with pre-change data. */
  markStale(): void {
    this.stale = true;
    this.generation++;
  }

  async get(): Promise<Snapshot<T>> {
    if (!this.stale && this.snapshot && this.now() - this.snapshot.fetchedAt < this.ttlMs) {
      return this.snapshot;
    }
    const refresh = this.refresh();
    if (this.snapshot) {
      refresh.catch(() => {});
      return this.snapshot;
    }
    return refresh;
  }

  private refresh(): Promise<Snapshot<T>> {
    if (this.inflight) return this.inflight;
    const gen = this.generation;
    const settle = (snapshot: Snapshot<T>): Snapshot<T> => {
      this.snapshot = snapshot;
      if (gen === this.generation) this.stale = false;
      return snapshot;
    };
    this.inflight = this.fetchData()
      .then((data) => settle({ data, fetchedAt: this.now(), fetchError: null }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`board refresh failed: ${message}`);
        return settle(
          this.snapshot
            ? { ...this.snapshot, fetchError: message }
            : { data: this.emptyData, fetchedAt: this.now(), fetchError: message },
        );
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}
