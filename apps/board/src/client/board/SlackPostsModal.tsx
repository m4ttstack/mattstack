import { ListGroup, Modal } from '@mattstack/tui-kit';
import type { BoardMRWithReview } from '../types.ts';
import { ago, cleanTitle, getSlackMarks } from './format.ts';
import { slackLadder } from './slack-ladder.ts';
import type { SlackPostLink } from './slack-posts.ts';

/** Where an MR was posted in Slack, one row per channel, each opening its
    own message with the furthest review reaction on it. */
function SlackPostsModal({
  mr,
  posts,
  now = Date.now(),
  onOpen,
  onClose,
}: {
  mr: BoardMRWithReview;
  posts: SlackPostLink[];
  now?: number;
  onOpen: (url: string) => void;
  onClose: () => void;
}) {
  const owner = (channel?: string) =>
    mr.ownerTeams?.find(t => t.channel === channel)?.team;
  return (
    <Modal
      title={<>❯ open in slack · !{mr.iid}</>}
      ariaLabel={`open !${mr.iid} in slack`}
      onClose={onClose}
      className="tui-owners-modal"
      overlayClassName="tui-slack-posts-overlay"
    >
      <p className="tui-modal-sub">{cleanTitle(mr.title)}</p>
      <ListGroup footer="Each row opens that channel's message in Slack.">
        {posts.map(post => {
          const who = post.team ? 'team review' : owner(post.channel);
          const when = post.postedAt
            ? ago(new Date(post.postedAt).toISOString(), now)
            : '';
          const { mark } = slackLadder(
            { status: 'found', posted: true, reactions: post.reactions ?? [] },
            getSlackMarks()
          );
          const stage = mark?.glyph ?? '';
          return (
            <ListGroup.Nav
              key={post.permalink}
              label={
                <>
                  {post.channel ? `#${post.channel}` : 'team channel'}
                  {who && <span className="tui-owners-sections">{who}</span>}
                </>
              }
              value={[stage, when].filter(Boolean).join(' · ') || undefined}
              onClick={() => {
                onOpen(post.permalink);
                onClose();
              }}
            />
          );
        })}
      </ListGroup>
    </Modal>
  );
}

export { SlackPostsModal };
