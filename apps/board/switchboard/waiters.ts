export const MAX_WAITERS_PER_BOARD = 4;
export const MAX_WAIT_SECONDS = 25;

interface Waiter {
  settle(cursor: number | null): void;
}

/** Parked `/inbox/wait` requests, per board, in this one relay process. A
    second relay replica would never see the other's waiters. */
export class InboxWaiters {
  private byBoard = new Map<string, Waiter[]>();

  wait(
    username: string,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<number | null> {
    if (signal.aborted) return Promise.resolve(null);
    return new Promise(resolve => {
      let settled = false;
      const waiter: Waiter = {
        settle: cursor => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          this.remove(username, waiter);
          resolve(cursor);
        },
      };
      const onAbort = () => waiter.settle(null);
      const timer = setTimeout(() => waiter.settle(null), timeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });
      const list = this.byBoard.get(username) ?? [];
      list.push(waiter);
      this.byBoard.set(username, list);
      while (list.length > MAX_WAITERS_PER_BOARD) list[0]!.settle(null);
    });
  }

  wake(usernames: string[], cursor: number): void {
    for (const u of usernames)
      for (const w of [...(this.byBoard.get(u) ?? [])]) w.settle(cursor);
  }

  boards(): string[] {
    return [...this.byBoard.keys()];
  }

  count(username: string): number {
    return this.byBoard.get(username)?.length ?? 0;
  }

  private remove(username: string, waiter: Waiter): void {
    const list = this.byBoard.get(username);
    if (!list) return;
    const i = list.indexOf(waiter);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this.byBoard.delete(username);
  }
}
