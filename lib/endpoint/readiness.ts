export interface ProbeDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export type ProbeOutcome = {
  answered: boolean;
  status: number | null;
  answeredAfterMs: number | null;
};

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

export async function waitForAnswers(
  targets: Array<{ role: string; url: string }>,
  o: {
    waitMs: number;
    intervalMs?: number;
    requestTimeoutMs?: number;
    signal?: AbortSignal;
    progress?: () => void;
  },
  deps: ProbeDeps,
): Promise<{ outcomes: Record<string, ProbeOutcome>; waitedMs: number }> {
  const intervalMs = o.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = o.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const start = deps.now();
  const outcomes: Record<string, ProbeOutcome> = {};
  for (const t of targets) outcomes[t.role] = { answered: false, status: null, answeredAfterMs: null };

  const probe = async (t: { role: string; url: string }, roundAt: number): Promise<void> => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
    try {
      const res = await deps.fetch(t.url, { redirect: "manual", signal });
      outcomes[t.role] = { answered: true, status: res.status, answeredAfterMs: roundAt - start };
      try {
        res.body?.cancel().catch(() => {});
      } catch {
        // a locked body cannot be cancelled; the status is all a probe needs
      }
    } catch {
      // not answered this round
    }
  };

  for (;;) {
    const roundAt = deps.now();
    const pending = targets.filter((t) => !outcomes[t.role]!.answered);
    await Promise.all(pending.map((t) => probe(t, roundAt)));
    o.progress?.();
    const done = targets.every((t) => outcomes[t.role]!.answered);
    if (done || o.signal?.aborted || deps.now() - start >= o.waitMs) break;
    await deps.sleep(intervalMs);
  }
  return { outcomes, waitedMs: deps.now() - start };
}
