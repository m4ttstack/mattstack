import type { BoardMR } from './data.ts';

/** What the logo links need from an MR: a board row, or a peer's ask that
    names an MR this board may not list. */
export type MrLinkTarget = Pick<BoardMR, 'iid'> &
  Partial<Pick<BoardMR, 'webUrl' | 'sourceBranch' | 'title' | 'provider'>>;

/** Whether an MR lives on GitHub: its provider when the row carries one,
    else its URL (or a gate's `mr:<url>` subject); GitLab otherwise. */
export function onGitHub(mr?: MrLinkTarget, subject?: string): boolean {
  if (mr?.provider) return mr.provider === 'github';
  return (mr?.webUrl ?? subject ?? '').includes('github.com');
}

/** "#12" on GitHub, "!12" on GitLab: each forge's own way to name one. */
export function mrRef(mr: MrLinkTarget): string {
  return `${onGitHub(mr) ? '#' : '!'}${mr.iid}`;
}

/** The forge's name as the menus write it, lowercase. */
export function forgeWord(mr?: MrLinkTarget): 'github' | 'gitlab' {
  return onGitHub(mr) ? 'github' : 'gitlab';
}

const GITHUB_ANCHORS: ReadonlyArray<[string, string]> = [
  ['gh-issue-comment-', 'issuecomment-'],
  ['gh-review-thread-', 'discussion_r'],
  ['gh-review-', 'pullrequestreview-'],
];

/** A link that lands on one comment: GitLab's `#note_<id>`, or the GitHub
    anchor its discussion id names (the bare PR for any other id shape).
    Null when the MR has no URL. */
export function commentUrl(
  mr: MrLinkTarget,
  discussionId: string,
  noteId: number
): string | null {
  if (!mr.webUrl) return null;
  if (!onGitHub(mr)) return `${mr.webUrl}#note_${noteId}`;
  const hit = GITHUB_ANCHORS.find(([prefix]) =>
    discussionId.startsWith(prefix)
  );
  return hit ? `${mr.webUrl}#${hit[1]}${noteId}` : mr.webUrl;
}
