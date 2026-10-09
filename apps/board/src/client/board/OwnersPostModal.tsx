import { useEffect, useState } from 'react';

import { Button, ListGroup, Modal, Spinner } from '@mattstack/tui-kit';
import { useAutoGrowTextarea } from '@mattstack/tui-kit/hooks';
import type { OwnerSkip, OwnersPostPlan } from '../../codeowner-posts.ts';
import type { BoardMR } from '../../data.ts';
import { postAction, type ActionResult } from '../api.ts';
import { cleanTitle } from './format.ts';

export type SlackPostPreview = OwnersPostPlan & {
  text: string;
  team: { channel: string; posted: boolean; permalink?: string };
  /** Only the team channel is left to post to: no dialog needed. */
  direct: boolean;
  /** Channels the board could not read for an earlier post. */
  unchecked: string[];
};
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

/** Confirm step for posting an MR to Slack: the team channel first, then
    each Code Owner channel still waiting on approval. Opening it only reads;
    nothing is sent until the confirm, and only to the channels still
    switched on. */
function OwnersPostModal({
  mr,
  initial,
  post = postAction,
  onPosted,
  onClose,
}: {
  mr: BoardMR;
  /** A preview already read, so opening does not ask again. */
  initial?: SlackPostPreview;
  post?: (path: string, payload: unknown) => Promise<ActionResult>;
  /** Every confirmed channel was posted to. */
  onPosted: (channels: string[]) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<SlackPostPreview | null>(
    initial ?? null
  );
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PostOutcome | null>(null);
  const [posting, setPosting] = useState(false);
  const [edited, setEdited] = useState<string | null>(null);
  const message = edited ?? preview?.text ?? '';
  const messageRef = useAutoGrowTextarea([message]);

  const load = async () => {
    const res = await post('/slack/owners/preview', { mrUrl: mr.webUrl });
    if (!res.ok) {
      setError(res.text || `could not load the channels (${res.status})`);
      return;
    }
    setPreview(res.body as unknown as SlackPostPreview);
  };
  useEffect(() => {
    if (!initial) void load();
  }, []);

  const team = preview && !preview.team.posted ? preview.team.channel : null;
  const rows = [
    ...(team ? [team] : []),
    ...(preview?.channels ?? []).map(c => c.channel),
  ];
  const chosen = rows.filter(c => !off.has(c));
  const flip = (channel: string) =>
    setOff(prev => {
      const next = new Set(prev);
      if (!next.delete(channel)) next.add(channel);
      return next;
    });

  const confirm = async () => {
    setPosting(true);
    setError(null);
    setOutcome(null);
    const res = await post('/slack/owners/post', {
      mrUrl: mr.webUrl,
      ...(edited !== null && edited !== preview?.text ? { text: edited } : {}),
      team: !!team && chosen.includes(team),
      channels: (preview?.channels ?? [])
        .map(c => c.channel)
        .filter(c => chosen.includes(c)),
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

  const unchecked = new Set(preview?.unchecked ?? []);
  const teamSections = [
    'team review',
    ...(preview?.ownSections ?? []).map(s =>
      sectionLabel(s, / - #([\w-]+)\s*$/.exec(s)?.[1])
    ),
  ].join(', ');

  return (
    <Modal
      title={<>❯ post to slack · !{mr.iid}</>}
      ariaLabel={`post !${mr.iid} to slack`}
      onClose={onClose}
      className="tui-owners-modal"
    >
      <p className="tui-modal-sub">{cleanTitle(mr.title)}</p>
      {!preview && !error && (
        <p className="tui-owners-note">
          <Spinner size="xs" /> checking approvals…
        </p>
      )}
      {preview && rows.length > 0 && (
        <ListGroup footer="One message per channel. Switch off any you do not want.">
          {team && (
            <ListGroup.Toggle
              label={
                <>
                  #{team}
                  <span className="tui-owners-sections">{teamSections}</span>
                </>
              }
              aria-label={`post to #${team}`}
              checked={!off.has(team)}
              onChange={() => flip(team)}
            />
          )}
          {preview.channels.map(c => (
            <ListGroup.Toggle
              key={c.channel}
              label={
                <>
                  #{c.channel}
                  <span className="tui-owners-sections">
                    {c.sections.map(s => sectionLabel(s, c.channel)).join(', ')}
                    {unchecked.has(c.channel) &&
                      ' · could not check for an earlier post'}
                  </span>
                </>
              }
              aria-label={`post to #${c.channel}`}
              checked={!off.has(c.channel)}
              onChange={() => flip(c.channel)}
            />
          ))}
        </ListGroup>
      )}
      {preview && rows.length === 0 && (
        <p className="tui-owners-note">nothing to post</p>
      )}
      {preview && (preview.team.posted || preview.skipped.length > 0) && (
        <ListGroup footer="Not posting for these.">
          {preview.team.posted && (
            <ListGroup.Fact
              label="team review"
              value={
                <a
                  href={preview.team.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  already posted to #{preview.team.channel}
                </a>
              }
            />
          )}
          {preview.skipped.map(s => (
            <ListGroup.Fact
              key={s.section}
              label={sectionLabel(s.section, s.channel)}
              value={skipReason(s)}
            />
          ))}
        </ListGroup>
      )}
      {preview && rows.length > 0 && (
        <textarea
          ref={messageRef}
          className="tui-draft-body tui-draft-edit"
          rows={3}
          value={message}
          aria-label="message to post"
          disabled={posting}
          onChange={e => setEdited(e.currentTarget.value)}
        />
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
          {preview && rows.length === 0 ? 'close' : 'cancel'}
        </Button>
        {preview && rows.length > 0 && (
          <Button
            size="sm"
            intent="accent"
            variant="filled"
            busy={posting}
            disabled={chosen.length === 0 || !message.trim()}
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
