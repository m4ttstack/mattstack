import type { BoardMR } from '../../data.ts';
import { mrRef, onGitHub, type MrLinkTarget } from '../../mr-ref.ts';
import { extractTicketId, ticketUrl } from '../../ticket.ts';
import { GitHubLogo, GitLabLogo, LinearLogo } from './icons.tsx';

export { mrRef, onGitHub, type MrLinkTarget };

/** "pull request" on GitHub, "merge request" on GitLab. */
export function forgeNoun(mr?: BoardMR, subject?: string): string {
  return onGitHub(mr, subject) ? 'pull request' : 'merge request';
}

/** The MR's two external homes as logo links: its forge page, and the
    Linear ticket its branch or title names (absent when it names none). */
export function MrLinks({ mr }: { mr: MrLinkTarget }) {
  const ticket = mr.sourceBranch
    ? extractTicketId(mr.sourceBranch, mr.title ?? '')
    : null;
  const github = onGitHub(mr);
  const forge = github ? 'GitHub' : 'GitLab';
  return (
    <span className="tui-mr-links">
      {mr.webUrl && (
        <a
          className="tui-mr-link"
          href={mr.webUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={`open ${mrRef(mr)} in ${forge}`}
          aria-label={`open ${mrRef(mr)} in ${forge}`}
        >
          {github ? <GitHubLogo /> : <GitLabLogo />}
        </a>
      )}
      {ticket && (
        <a
          className="tui-mr-link"
          href={ticketUrl(ticket)}
          target="_blank"
          rel="noopener noreferrer"
          title={`open ${ticket} in Linear`}
          aria-label={`open ${ticket} in Linear`}
        >
          <LinearLogo />
        </a>
      )}
    </span>
  );
}
