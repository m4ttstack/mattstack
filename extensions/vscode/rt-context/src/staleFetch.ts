export interface StaleFetch<T> {
  fetch: () => Promise<T | null>;
  timeoutMs: number;
  isLatest: () => boolean;
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
    if (args.isLatest()) args.render(fresh ?? args.fallback);
  }
}
