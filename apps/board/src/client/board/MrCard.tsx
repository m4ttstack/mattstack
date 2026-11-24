import type { BoardMRWithReview } from '../types.ts';
import { ago, cleanTitle } from './format.ts';
import { MrLinks, mrRef, onGitHub } from './MrLinks.tsx';
import { usePeople } from './people.ts';
import { PersonLead } from './PersonLead.tsx';
import { Sep } from './Sep.tsx';

/** A review gate's identity card: the invader, the author and the MR's links
    share the top line; the title, the branch with the one it merges into, and
    the age and diff size each take a line below it. */
export function MrCard({ mr }: { mr: BoardMRWithReview }) {
  const people = usePeople(mr);
  return (
    <div className="tui-id-card tui-mr-card">
      <PersonLead
        id={mr.author.username}
        name={people.short(mr.author.username)}
        trailing={<MrLinks mr={mr} />}
      >
        opened <MrRef mr={mr} />
      </PersonLead>
      <p className="tui-id-card-title">{cleanTitle(mr.title)}</p>
      {mr.sourceBranch && (
        <p className="tui-mr-card-branches">
          <span className="tui-id-card-branch" title={mr.sourceBranch}>
            {mr.sourceBranch}
          </span>{' '}
          <span className="tui-mr-card-target" title={mr.targetBranch}>
            → {mr.targetBranch}
          </span>
        </p>
      )}
      <p className="tui-id-card-meta">
        <span>{ago(mr.createdAt, Date.now())}</span>
        {mr.diff && (
          <>
            <Sep />
            <span className="tui-mr-card-diff">
              <span className="tui-mr-card-diff-add">+{mr.diff.additions}</span>
              <span className="tui-mr-card-diff-del">-{mr.diff.deletions}</span>
            </span>
          </>
        )}
      </p>
    </div>
  );
}

function MrRef({ mr }: { mr: BoardMRWithReview }) {
  const ref = mrRef(mr);
  if (!mr.webUrl) return <span className="tui-id-card-ref">{ref}</span>;
  const forge = onGitHub(mr) ? 'GitHub' : 'GitLab';
  return (
    <a
      className="tui-id-card-ref"
      href={mr.webUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`open ${ref} in ${forge}`}
    >
      {ref}
    </a>
  );
}
