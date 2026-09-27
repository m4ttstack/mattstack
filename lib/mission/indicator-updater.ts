import type { IndicatorTarget } from "./indicator-refresh.ts";

export const INITIAL_DELAY_MS = 2 * 60_000;
export const REFRESH_INTERVAL_MS = 15 * 60_000;
export const SKEW_MAX_MS = 30_000;

export function randomSkewMs(): number {
  return Math.ceil(Math.random() * SKEW_MAX_MS);
}

export interface IndicatorUpdaterDeps {
  targets: () => IndicatorTarget[];
  /** The signal aborts on pause or stop; an aborted repo is refreshed again once the pass resumes. */
  refreshOne: (target: IndicatorTarget, signal: AbortSignal) => Promise<void>;
  onPassStart?: () => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  now: () => number;
  skewMs: number;
}

/** Port of GitHub Desktop's RepositoryIndicatorUpdater (app/src/lib/stores/helpers/repository-indicator-updater.ts). */
export class IndicatorUpdater {
  private running = false;
  private timer: unknown = null;
  private paused = false;
  private pauseWaiter: Promise<void> = Promise.resolve();
  private release: (() => void) | null = null;
  private lastPassStartedAt: number | null = null;
  private generation = 0;
  private inFlight: AbortController | null = null;

  constructor(private readonly deps: IndicatorUpdaterDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.generation++;
    this.inFlight?.abort();
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    this.resume();
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.inFlight?.abort();
    this.pauseWaiter = new Promise((resolve) => { this.release = resolve; });
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.release?.();
    this.release = null;
  }

  private schedule(): void {
    if (!this.running || this.timer !== null) return;
    const base = this.lastPassStartedAt === null
      ? INITIAL_DELAY_MS
      : Math.max(REFRESH_INTERVAL_MS - (this.deps.now() - this.lastPassStartedAt), 0);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.pass();
    }, base + this.deps.skewMs);
  }

  private async pass(): Promise<void> {
    const gen = this.generation;
    if (this.paused) await this.pauseWaiter;
    if (!this.running || gen !== this.generation) return;
    this.lastPassStartedAt = this.deps.now();
    this.deps.onPassStart?.();
    const done = new Set<string>();
    let next: IndicatorTarget | undefined;
    while (this.running && gen === this.generation && (next = this.deps.targets().find((t) => !done.has(t.id))) !== undefined) {
      const controller = new AbortController();
      this.inFlight = controller;
      try {
        await this.deps.refreshOne(next, controller.signal);
      } catch {
        // refreshIndicator already maps git failures to a null badge; anything reaching here is a bug in a caller's publish and must not end the pass.
      }
      if (this.inFlight === controller) this.inFlight = null;
      if (!controller.signal.aborted) done.add(next.id);
      if (this.paused) await this.pauseWaiter;
    }
    if (gen === this.generation) this.schedule();
  }
}
