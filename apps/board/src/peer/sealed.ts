import type {
  OpenResult,
  SealBinding,
  SealFields,
  textOpen,
} from '@mattstack/rt-client';
import { FORGE_NOT_YET } from '../config.ts';
import { canonicalUsername, DECLINE_REASONS } from './envelope.ts';

/** What a sealed ask, outcome or review state is bound to: opened on any
    other message, it is refused. */
export const askBinding = (
  e: { type: string; from: string; id: string },
  mrUrl: string
): SealBinding => ({
  type: e.type,
  from: e.from,
  subject: `${mrUrl} ${e.id}`,
});

export const outcomeBinding = (
  from: string,
  mrUrl: string,
  nudgeId: string
): SealBinding => ({
  type: 'nudge-outcome',
  from,
  subject: `${mrUrl} ${nudgeId}`,
});

export const reviewStateBinding = (
  from: string,
  p: { mrUrl: string; status: string; updatedAt: number }
): SealBinding => ({
  type: 'review-state',
  from,
  subject: `${p.mrUrl} ${p.status} ${p.updatedAt}`,
});

/** Every reason the code itself writes, as a code or as the words an older
    board shows. Anything else is text a person or an agent wrote, and leaves
    sealed. */
export const WIRE_REASONS: ReadonlySet<string> = new Set([
  ...Object.values(DECLINE_REASONS),
  FORGE_NOT_YET,
  'stale',
  'not-your-mr',
  'respond-in-flight',
  'review-in-flight',
  'already-reviewed',
  'no-commented-review',
  'budget-exhausted',
  'cooldown',
  'asks-off',
  'launch-failed',
  'pane closed',
  'review held',
  'abandoned',
  'superseded',
  'pruned',
  'closed',
]);

export type SealedRead =
  | { state: 'open'; fields: SealFields }
  /** This Mac cannot open it yet: the daemon is down or its key is locked. */
  | { state: 'pending' }
  | { state: 'unreadable' };

export interface SealedReader {
  read(sealed: string, binding: SealBinding): SealedRead;
}

/** Only the open's own answer is read, so a test needs no daemon. */
export type OpenText = (
  ...args: Parameters<typeof textOpen>
) => Promise<{ ok: boolean; data?: OpenResult; failure?: { code: string } }>;

export async function openOnce(
  open: OpenText,
  sealed: string,
  binding: SealBinding
): Promise<SealedRead> {
  try {
    const res = await open({ sealed, binding });
    // The daemon refuses to look at text this malformed, so it never opens.
    if (res.failure?.code === 'text-invalid') return { state: 'unreadable' };
    if (!res.ok || !res.data) return { state: 'pending' };
    if (res.data.ok) return { state: 'open', fields: res.data.fields };
    return {
      state: res.data.reason === 'unavailable' ? 'pending' : 'unreadable',
    };
  } catch {
    return { state: 'pending' };
  }
}

const RETRY_MS = 30_000;
const HELD_MAX = 500;
/** An entry looked at this recently is on screen, and letting go of it would
    open it again at the next draw. */
const IN_USE_MS = 60_000;
/** Each open is a process launch in the daemon. */
const AT_ONCE = 4;

interface Held {
  read: SealedRead;
  opening: boolean;
  triedAt: number;
  readAt: number;
}

/** Opens sealed text as it is shown. A read never waits: it answers what is
    known, asks the daemon once behind it, and says when that changed. Opened
    text lives in memory only. */
export function createSealedReader(deps: {
  open: OpenText;
  changed(): void;
  now(): number;
}): SealedReader {
  // In order of the last read, oldest first.
  const held = new Map<string, Held>();
  const queue: (() => Promise<void>)[] = [];
  let running = 0;

  function pump(): void {
    while (running < AT_ONCE && queue.length > 0) {
      running++;
      void queue.shift()!().finally(() => {
        running--;
        pump();
      });
    }
  }

  function ask(entry: Held, sealed: string, binding: SealBinding): void {
    entry.opening = true;
    queue.push(async () => {
      const read = await openOnce(deps.open, sealed, binding);
      entry.opening = false;
      entry.triedAt = deps.now();
      if (read.state === 'pending') return;
      entry.read = read;
      deps.changed();
    });
    pump();
  }

  function makeRoom(now: number): boolean {
    if (held.size < HELD_MAX) return true;
    const oldest = held.entries().next().value;
    if (!oldest || now - oldest[1].readAt < IN_USE_MS) return false;
    held.delete(oldest[0]);
    return true;
  }

  return {
    read(sealed, binding) {
      const now = deps.now();
      const key = JSON.stringify([
        binding.type,
        canonicalUsername(binding.from),
        binding.subject,
        sealed,
      ]);
      let entry = held.get(key);
      if (entry) {
        held.delete(key);
        entry.readAt = now;
      } else {
        if (!makeRoom(now)) return { state: 'pending' };
        entry = {
          read: { state: 'pending' },
          opening: false,
          triedAt: Number.NEGATIVE_INFINITY,
          readAt: now,
        };
      }
      held.set(key, entry);
      if (
        entry.read.state === 'pending' &&
        !entry.opening &&
        now - entry.triedAt >= RETRY_MS
      )
        ask(entry, sealed, binding);
      return entry.read;
    },
  };
}
