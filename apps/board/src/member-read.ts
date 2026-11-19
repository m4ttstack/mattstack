import { sharedRead } from './shared-read.ts';

/** Under the client's 15s member poll, so one tab still gets a fresh read
    each tick while other tabs on the same member share it. */
export const MEMBER_FRESH_MS = 12_000;
export const MEMBER_FAIL_MS = 60_000;

/** Each member fetch reads every project and then every MR's discussions
    from the daemon; concurrent polls for one member share that work. */
export function memberRead<T>(
  fetch: (username: string) => Promise<T>,
  now?: () => number
): (username: string) => Promise<T> {
  return sharedRead(fetch, {
    freshMs: MEMBER_FRESH_MS,
    failMs: MEMBER_FAIL_MS,
    now,
  });
}
