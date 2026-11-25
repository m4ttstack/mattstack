import type { Database } from 'bun:sqlite';

import {
  ANNOUNCEMENT_PLACEHOLDER,
  announcementBinding,
  parseAnnouncementPayload,
  type AnnouncementPayload,
} from '@mattstack/rt-client';
import { getStateDb, runCriticalWrite } from '../state/index.ts';
import { deleteKvValue, listKvValues, setKvValue } from '../state/kv-blob.ts';
import { openOnce, type OpenText, type SealedRead } from './sealed.ts';

export const SEALED_ANNOUNCEMENT_NS = 'sealed-announcement';
/** The placeholder it came with is for boards too old to open any. */
export const ANNOUNCEMENT_UNREADABLE = {
  title: ANNOUNCEMENT_PLACEHOLDER.title,
  message:
    "This Mac can't read it. Ask an org admin to run rt team members sync.",
};
export const ANNOUNCEMENT_MAX_AGE_MS = 24 * 60 * 60_000;

export interface KeptAnnouncement {
  id: string;
  from: string;
  receivedAt: number;
  sealed: string;
}

/** Kept before its envelope is acked, so a restart loses none. */
export function keepAnnouncement(
  a: KeptAnnouncement,
  db: Database = getStateDb()
): void {
  runCriticalWrite('sealed announcement write', () =>
    setKvValue(SEALED_ANNOUNCEMENT_NS, a.id, a, db)
  );
}

/** Show every kept announcement that opens. One that never will, or has not
    in a day, says it can't be read instead. The board server and the triage
    pass share this db: whichever deletes the row shows it. */
export async function openKeptAnnouncements(
  deps: {
    open: OpenText;
    notify(
      id: string,
      payload: AnnouncementPayload,
      from: string
    ): Promise<void>;
    log(line: string): void;
  },
  now: number = Date.now(),
  db: Database = getStateDb()
): Promise<void> {
  // One that cannot open yet means none can, and each try can wait on a dialog.
  let stuck = false;
  for (const [id, value] of listKvValues(SEALED_ANNOUNCEMENT_NS, db)) {
    const a = value as KeptAnnouncement;
    const read: SealedRead = stuck
      ? { state: 'pending' }
      : await openOnce(deps.open, a.sealed, announcementBinding(id, a.from));
    stuck ||= read.state === 'pending';
    if (
      read.state === 'pending' &&
      now - a.receivedAt <= ANNOUNCEMENT_MAX_AGE_MS
    )
      continue;
    const payload =
      (read.state === 'open' &&
        parseAnnouncementPayload({
          title: read.fields.title,
          message: read.fields.message,
        })) ||
      ANNOUNCEMENT_UNREADABLE;
    if (!deleteKvValue(SEALED_ANNOUNCEMENT_NS, id, db)) continue;
    try {
      await deps.notify(id, payload, a.from);
    } catch (err) {
      deps.log(
        `peer: announcement ${id} was not shown: ${err instanceof Error ? err.message : err}`
      );
    }
  }
}
