/**
 * One header off a response, whichever shape the HTTP client handed back.
 *
 * Octokit gives a plain lowercase-keyed object; gitbeaker's errors carry a
 * `Headers` instance. Kept free of imports: the events watcher is its own
 * build entrypoint and must not pull Octokit in through this.
 */
export function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const get = (headers as { get?: unknown }).get;
  const raw =
    typeof get === 'function'
      ? (get as (n: string) => unknown).call(headers, name)
      : (headers as Record<string, unknown>)[name];
  return raw === undefined || raw === null ? null : String(raw);
}
