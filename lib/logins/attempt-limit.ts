export const ATTEMPT_WINDOW_MS = 5 * 60_000;
export const ATTEMPT_DAY_MS = 24 * 60 * 60_000;
export const ATTEMPTS_PER_DAY = 5;

export function loginFingerprint(login: { email: string; password: string }): string {
  return new Bun.CryptoHasher("sha256").update(`${login.email}\0${login.password}`).digest("hex");
}

// Counters reset when the stored login's fingerprint changes, which is how a
// replacement through rt logins add lifts the limit without the CLI having
// to reach into the daemon.
export class AttemptLimiter {
  private readonly entries = new Map<string, { fingerprint: string; times: number[] }>();

  constructor(private readonly now: () => number = Date.now) {}

  take(key: string, fingerprint: string): { ok: true } | { ok: false; until: number } {
    const t = this.now();
    let entry = this.entries.get(key);
    if (!entry || entry.fingerprint !== fingerprint) {
      entry = { fingerprint, times: [] };
      this.entries.set(key, entry);
    }
    entry.times = entry.times.filter((x) => t - x < ATTEMPT_DAY_MS);
    const last = entry.times.at(-1);
    if (last !== undefined && t - last < ATTEMPT_WINDOW_MS) return { ok: false, until: last + ATTEMPT_WINDOW_MS };
    if (entry.times.length >= ATTEMPTS_PER_DAY) return { ok: false, until: entry.times[0]! + ATTEMPT_DAY_MS };
    entry.times.push(t);
    return { ok: true };
  }
}
