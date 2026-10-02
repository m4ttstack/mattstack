import { CRON_CLAIM_STALE_MS } from './memory-store.ts';

const CLAIM_POLL_MS = 1_000;

export function triageShouldRun(
  peerMode: boolean,
  on: { triage: boolean; reReview: boolean; peerAsks: boolean }
): boolean {
  return peerMode ? on.peerAsks : on.triage || on.reReview || on.peerAsks;
}

/** A pass waits for a held claim instead of exiting, so the work it was
    triggered for is not stranded until the next broadcast. Defaults to the
    stale window, after which the claim is reclaimable anyway. */
export async function claimCronWaiting(opts: {
  tryClaim: (now: number) => string | false;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  pollMs?: number;
}): Promise<string | false> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  const deadline = now() + (opts.maxWaitMs ?? CRON_CLAIM_STALE_MS);
  for (;;) {
    const token = opts.tryClaim(now());
    if (token !== false) return token;
    if (now() >= deadline) return false;
    await sleep(opts.pollMs ?? CLAIM_POLL_MS);
  }
}

/** Only a respond ask checks authorship, so the board and GitLab fetch behind
    it is skipped unless an unhandled one is waiting. */
export function needsOwnMrs(
  nudges: readonly { kind?: string; handled?: unknown }[]
): boolean {
  return nudges.some(n => n.kind === 'respond' && !n.handled);
}
