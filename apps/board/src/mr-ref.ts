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
