import { DOCS_HOST } from "./docs-moves.ts";

export type SmokeCheck = { url: string; status: number; location?: string };

// The host answers a bare path with a 307 to its slash form, so page checks name the slash form.
export const SMOKE_CHECKS: SmokeCheck[] = [
  { url: `${DOCS_HOST}/`, status: 200 },
  { url: `${DOCS_HOST}/rt/reference/cd/`, status: 200 },
  { url: `${DOCS_HOST}/gitq/`, status: 200 },
  { url: "https://rt.cool/reference/cd", status: 301, location: `${DOCS_HOST}/rt/reference/cd` },
];

export const SMOKE_TIMEOUT_MS = 15_000;
export const SMOKE_RETRY_DELAY_MS = 5_000;

export type SmokeFetch = (url: string, init: RequestInit) => Promise<Response>;
export type SmokeDeps = { fetch: SmokeFetch; sleep: (ms: number) => Promise<void> };

export function evaluate(check: SmokeCheck, got: { status: number; location: string | null }): string | null {
  if (got.status !== check.status) return `${check.url}: expected ${check.status}, got ${got.status}`;
  if (check.location && got.location !== check.location) {
    return `${check.url}: redirects to ${got.location}, expected ${check.location}`;
  }
  return null;
}

export async function probe(check: SmokeCheck, fetchFn: SmokeFetch): Promise<string | null> {
  try {
    const res = await fetchFn(check.url, { redirect: "manual", signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS) });
    return evaluate(check, { status: res.status, location: res.headers.get("location") });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `${check.url}: fetch failed (${message})`;
  }
}

// A fresh deploy can take a few seconds to answer everywhere, so a failing check gets one retry.
export async function runSmoke(checks: SmokeCheck[], deps: SmokeDeps): Promise<string[]> {
  const failing: SmokeCheck[] = [];
  for (const c of checks) {
    if (await probe(c, deps.fetch)) failing.push(c);
  }
  if (failing.length === 0) return [];
  await deps.sleep(SMOKE_RETRY_DELAY_MS);
  const failures: string[] = [];
  for (const c of failing) {
    const why = await probe(c, deps.fetch);
    if (why) failures.push(why);
  }
  return failures;
}
