/** Wraps a poll task so a tick that lands while the previous request is
    still pending is dropped: a slow server must not pile up requests. */
export function skipWhileBusy(task: () => Promise<unknown>): () => void {
  let busy = false;
  return () => {
    if (busy) return;
    busy = true;
    task()
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  };
}
