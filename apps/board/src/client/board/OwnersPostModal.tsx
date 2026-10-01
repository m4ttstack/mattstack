import { useEffect, useState } from 'react';

import { Button, ListGroup, Modal, Spinner } from '@mattstack/tui-kit';
import type { OwnerSkip, OwnersPostPlan } from '../../codeowner-posts.ts';
import type { BoardMR } from '../../data.ts';
import { postAction, type ActionResult } from '../api.ts';
import { cleanTitle } from './format.ts';

type Preview = OwnersPostPlan & { text: string };
interface PostOutcome {
  posted: Array<{ channel: string; permalink: string }>;
  failed: Array<{ channel: string; error: string }>;
}

/** A section name without the channel it carries: `Acme - #pod-acme` reads
    `Acme` beside a row that already shows the channel. */
function sectionLabel(section: string, channel?: string): string {
  if (!channel) return section;
  const bare = section
    .replace(new RegExp(`\\s*-?\\s*#${channel}\\s*$`, 'i'), '')
    .trim();
  return bare || section;
}

function skipReason(skip: OwnerSkip) {
  switch (skip.reason) {
    case 'approved':
      return 'already approved';
    case 'no-channel':
      return 'no channel in its name';
    case 'already-posted':
      return (
        <a href={skip.permalink} target="_blank" rel="noopener noreferrer">
          already posted to #{skip.channel}
        </a>
      );
    case 'channel-missing':
      return `#${skip.channel} was not found in Slack`;
    case 'not-member':
      return `you are not in #${skip.channel}, join it in Slack to post`;
  }
}

/** Confirm step for posting an MR to its Code Owners' channels. Opening it
    only reads; nothing is sent until the confirm, and only to the channels
    still switched on. */
function OwnersPostModal({
  mr,
  post = postAction,
  onPosted,
  onClose,
}: {
  mr: BoardMR;
  post?: (path: string, payload: unknown) => Promise<ActionResult>;
  /** Every confirmed channel was posted to. */
  onPosted: (channels: string[]) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PostOutcome | null>(null);
  const [posting, setPosting] = useState(false);

  const load = async () => {
    const res = await post('/slack/owners/preview', { mrUrl: mr.webUrl });
    if (!res.ok) {
      setError(res.text || `could not load the channels (${res.status})`);
      return;
    }
    setPreview(res.body as unknown as Preview);
  };
  useEffect(() => {
    void load();
  }, []);

  const chosen = (preview?.channels ?? [])
    .map(c => c.channel)
    .filter(c => !off.has(c));

  const confirm = async () => {
    setPosting(true);
    setError(null);
    setOutcome(null);
    const res = await post('/slack/owners/post', {
      mrUrl: mr.webUrl,
      channels: chosen,
    });
    const body = res.body as unknown as PostOutcome | null;
    if (res.ok && body && body.failed.length === 0) {
      onPosted(body.posted.map(p => p.channel));
      return;
    }
    if (body?.failed?.length) setOutcome(body);
    else
      setError(`post failed (${res.status})${res.text ? `: ${res.text}` : ''}`);
    await load();
    setPosting(false);
  };

  return (
    <Modal
      title={<>❯ post to code owners · !{mr.iid}</>}
      ariaLabel={`post !${mr.iid} to code owners`}
      onClose={onClose}
      className="tui-owners-modal"
    >
      <p className="tui-modal-sub">{cleanTitle(mr.title)}</p>
      {!preview && !error && (
        <p className="tui-owners-note">
          <Spinner size="xs" /> checking approvals…
        </p>
      )}
      {preview && preview.channels.length > 0 && (
        <ListGroup footer="One message per channel. Switch off any you do not want.">
          {preview.channels.map(c => (
            <ListGroup.Toggle
              key={c.channel}
              label={
                <>
                  #{c.channel}
                  <span className="tui-owners-sections">
                    {c.sections.map(s => sectionLabel(s, c.channel)).join(', ')}
                  </span>
                </>
              }
              aria-label={`post to #${c.channel}`}
              checked={!off.has(c.channel)}
              onChange={() =>
                setOff(prev => {
                  const next = new Set(prev);
                  if (!next.delete(c.channel)) next.add(c.channel);
                  return next;
                })
              }
            />
          ))}
        </ListGroup>
      )}
      {preview && preview.channels.length === 0 && (
        <p className="tui-owners-note">
          {preview.skipped.length === 0
            ? 'this MR has no code owner sections'
            : 'nothing to post'}
        </p>
      )}
      {preview && preview.skipped.length > 0 && (
        <ListGroup footer="Not posting for these sections.">
          {preview.skipped.map(s => (
            <ListGroup.Fact
              key={s.section}
              label={sectionLabel(s.section, s.channel)}
              value={skipReason(s)}
            />
          ))}
        </ListGroup>
      )}
      {preview && preview.channels.length > 0 && (
        <pre className="tui-draft-body">{preview.text}</pre>
      )}
      <div className="tui-draft-actions">
        {error && <span className="tui-draft-error">{error}</span>}
        {outcome && (
          <span className="tui-draft-error">
            {[
              ...outcome.posted.map(p => `posted to #${p.channel}`),
              ...outcome.failed.map(f => `#${f.channel} failed: ${f.error}`),
            ].join(' · ')}
          </span>
        )}
        <Button size="sm" intent="muted" onClick={onClose}>
          {preview && preview.channels.length === 0 ? 'close' : 'cancel'}
        </Button>
        {preview && preview.channels.length > 0 && (
          <Button
            size="sm"
            intent="accent"
            variant="filled"
            busy={posting}
            disabled={chosen.length === 0}
            onClick={() => void confirm()}
          >
            {posting
              ? 'posting…'
              : chosen.length === 0
                ? 'no channel selected'
                : `post to ${chosen.length} channel${chosen.length === 1 ? '' : 's'}`}
          </Button>
        )}
      </div>
    </Modal>
  );
}

export { OwnersPostModal };
