import type { MRDetail } from '@mattstack/glance';
import {
  isAutomatedNote,
  isBotAuthor,
  summarizeDiscussions,
} from './discussions.ts';
import { latchKindOf } from './latch/markers.ts';

export interface RespondTarget {
  username: string;
  name: string;
  /** Resolvable threads this person started that await the author. */
  openThreads: number;
  /** This person's Overview comments the author has not answered. */
  openComments: number;
}

export function respondTargets(
  detail: MRDetail,
  author: string | null,
  botUsernames: string[] = []
): RespondTarget[] {
  const configBots = new Set(botUsernames.map(b => b.toLowerCase()));
  const byUser = new Map<string, RespondTarget>();
  const entry = (username: string, name: string): RespondTarget => {
    let t = byUser.get(username);
    if (!t) {
      t = { username, name, openThreads: 0, openComments: 0 };
      byUser.set(username, t);
    }
    return t;
  };

  for (const t of summarizeDiscussions(detail, author, botUsernames).threads) {
    const starter = t.notes[0];
    if (t.status !== 'awaiting' || !starter?.username) continue;
    if (starter.username === author || isBotAuthor(starter, configBots))
      continue;
    entry(starter.username, starter.name).openThreads++;
  }

  type Note = MRDetail['discussions'][number]['notes'][number];
  const candidates: Array<{ note: Note; answeredInThread: boolean }> = [];
  let authorLastOverviewAt = '';
  const approvedAt = new Map<string, string>();
  for (const d of detail.discussions) {
    for (const n of d.notes) {
      const who = n.author?.username;
      if (!n.system || !who) continue;
      const body = (n.body ?? '').trim();
      if (body === 'approved this merge request')
        approvedAt.set(who, n.createdAt);
      else if (body === 'unapproved this merge request') approvedAt.delete(who);
    }
    const notes = d.notes.filter(n => !n.system);
    if (!notes.length || latchKindOf(notes[0]!.body ?? '')) continue;
    if (notes.some(n => n.resolvable)) continue;
    notes.forEach((n, i) => {
      const isAuthor = !!author && n.author?.username === author;
      if (isAuthor) {
        if (n.createdAt > authorLastOverviewAt)
          authorLastOverviewAt = n.createdAt;
        return;
      }
      if (
        !n.author?.username ||
        isAutomatedNote(n.body ?? '') ||
        isBotAuthor(n.author, configBots)
      )
        return;
      const answeredInThread = notes
        .slice(i + 1)
        .some(l => !!author && l.author?.username === author);
      candidates.push({ note: n, answeredInThread });
    });
  }
  for (const { note, answeredInThread } of candidates) {
    if (answeredInThread || note.createdAt < authorLastOverviewAt) continue;
    const a = note.author!;
    if (note.createdAt <= (approvedAt.get(a.username!) ?? '')) continue;
    entry(a.username!, a.name ?? a.username!).openComments++;
  }

  return [...byUser.values()]
    .filter(t => t.openThreads + t.openComments > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
