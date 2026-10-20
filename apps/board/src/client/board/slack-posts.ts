import type { BoardMRWithReview } from '../types.ts';

/** One place an MR was posted in Slack. */
export interface SlackPostLink {
  /** Absent when the team thread's channel is not known to the board. */
  channel?: string;
  permalink: string;
  /** The team review thread, which carries the review reactions. */
  team?: true;
  postedAt?: number;
  reactions?: string[];
}

/** Slack permalinks end `p` + the message ts without its dot. */
function postedAtFromPermalink(permalink: string): number | undefined {
  const m = /\/p(\d{10})(\d{6})(?:$|[?#])/.exec(permalink);
  return m ? Number(m[1]) * 1000 + Math.floor(Number(m[2]) / 1000) : undefined;
}

/** Every post of this MR the board can open: the team thread first, then
    the Code Owner channels oldest first. */
export function slackPosts(
  mr: Pick<BoardMRWithReview, 'slack' | 'slackChannel' | 'ownerPosts'>
): SlackPostLink[] {
  const out: SlackPostLink[] = [];
  const team = mr.slack?.status === 'found' ? mr.slack.permalink : undefined;
  if (team) {
    const postedAt = postedAtFromPermalink(team);
    out.push({
      ...(mr.slackChannel ? { channel: mr.slackChannel } : {}),
      permalink: team,
      team: true,
      ...(postedAt ? { postedAt } : {}),
      reactions: mr.slack!.reactions,
    });
  }
  for (const post of mr.ownerPosts ?? []) {
    if (post.permalink === team) continue;
    out.push({
      channel: post.channel,
      permalink: post.permalink,
      postedAt: post.postedAt,
      ...(post.reactions ? { reactions: post.reactions } : {}),
    });
  }
  return out;
}
