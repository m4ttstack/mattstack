import type { ReactedBy } from '../../slack-emoji.ts';
import type { SlackInfo } from '../types.ts';

export type SlackStage = 'looking' | 'commented' | 'approved';

const RUNG: Record<SlackStage, number> = {
  looking: 0,
  commented: 1,
  approved: 2,
};

/** The furthest review-signal reaction on the posted message, returned as
    the mark that carries it (its stage, icon title, emoji). Reactions on an
    unposted message are noise from another thread and count for nothing. */
export function slackLadder<M extends { emoji: string; stage: SlackStage }>(
  slack: SlackInfo | undefined,
  marks: ReadonlyArray<M>
): { posted: boolean; mark: M | null } {
  if (!slack?.posted) return { posted: false, mark: null };
  let mark: M | null = null;
  for (const m of marks) {
    if (!slack.reactions.includes(m.emoji)) continue;
    if (!mark || RUNG[m.stage] > RUNG[mark.stage]) mark = m;
  }
  return { posted: true, mark };
}

/** The furthest mark across several posts, and how many posts reached it. */
export function furthestAcross<M extends { emoji: string; stage: SlackStage }>(
  posts: ReadonlyArray<{ reactions?: string[] }>,
  marks: ReadonlyArray<M>
): { mark: M | null; count: number } {
  let mark: M | null = null;
  let count = 0;
  for (const post of posts) {
    const { mark: m } = slackLadder(
      { status: 'found', posted: true, reactions: post.reactions ?? [] },
      marks
    );
    if (!m) continue;
    if (!mark || RUNG[m.stage] > RUNG[mark.stage]) {
      mark = m;
      count = 1;
    } else if (m.stage === mark.stage) count++;
  }
  return { mark, count };
}

type Reactors = ReactedBy[string];

/** Everyone who left `emoji` on any of the posts; undefined when no post
    says who reacted. */
export function reactorsOf(
  posts: ReadonlyArray<{ reactedBy?: ReactedBy }>,
  emoji: string
): Reactors | undefined {
  let out: Reactors | undefined;
  for (const post of posts) {
    const who = post.reactedBy?.[emoji];
    if (!who) continue;
    out ??= { you: false, others: [] };
    out.you ||= who.you;
    for (const id of who.others)
      if (!out.others.includes(id)) out.others.push(id);
  }
  return out;
}

function whoText({ you, others }: Reactors): string {
  const n = others.length;
  const rest = `${n} other${n === 1 ? '' : 's'}`;
  if (you) return n ? `You and ${rest}` : 'You';
  if (n === 1) return 'Someone else';
  return n ? rest.replace(/^./, c => c.toUpperCase()) : 'Someone';
}

/** The Slack marks' tooltip: who left the furthest mark ("Someone" until
    the board knows who), and in how many channels. */
export function marksTip(
  mark: { word: string } | null,
  who: Reactors | undefined,
  across?: { reached: number; posts: number }
): string | null {
  if (!mark) return null;
  const where = across
    ? `${across.reached} of ${across.posts} Slack channels`
    : 'Slack';
  return `${who ? whoText(who) : 'Someone'} marked this ${mark.word} in ${where}`;
}
