import { useEffect, useState } from 'react';

import { Button, ListGroup, Modal, Spinner, Switch } from '@mattstack/tui-kit';
import {
  sectionLabel,
  type OwnerSkip,
  type OwnersPostPlan,
} from '../../codeowner-posts.ts';
import type { BoardMR } from '../../data.ts';
import { postAction, type ActionResult } from '../api.ts';
import { cleanTitle } from './format.ts';
import { mrRef } from './MrLinks.tsx';
import { OwnerMessageEditor } from './OwnerMessageEditor.tsx';
import { Sep, withSeps } from './Sep.tsx';

export type SlackPostPreview = Omit<OwnersPostPlan, 'channels'> & {
  /** `text`: the message that channel gets unless edited, prefix included. */
  channels: Array<OwnersPostPlan['channels'][number] & { text: string }>;
  /** The team channel's message unless edited. */
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
  only,
  post = postAction,
  onPosted,
  onClose,
}: {
  mr: BoardMR;
  /** A preview already read, so opening does not ask again. */
  initial?: SlackPostPreview;
  /** Start with only this Code Owner channel ticked. */
  only?: string;
  post?: (path: string, payload: unknown) => Promise<ActionResult>;
  /** Every confirmed channel was posted to. */
  onPosted: (channels: string[]) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<SlackPostPreview | null>(
    initial ?? null
  );
  const [off, setOff] = useState<ReadonlySet<string>>(() =>
    only && initial
      ? new Set(
          [
            initial.team.posted ? [] : [initial.team.channel],
            initial.channels.map(c => c.channel),
          ]
            .flat()
            .filter(c => c !== only)
        )
      : new Set()
  );
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PostOutcome | null>(null);
  const [posting, setPosting] = useState(false);
  const [edits, setEdits] = useState<Readonly<Record<string, string>>>({});

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
  const messageFor = (channel: string) => edits[channel] ?? defaultFor(channel);
  const defaultFor = (channel: string) =>
    (channel === team
      ? preview?.text
      : preview?.channels.find(c => c.channel === channel)?.text) ?? '';
  const link = mr.webUrl ?? '';
  const blank = chosen.some(c => {
    const m = messageFor(c).trim();
    return !m || (defaultFor(c).includes(link) && !m.includes(link));
  });
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
      texts: Object.fromEntries(chosen.map(c => [c, messageFor(c)])),
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
      title={
        <>
          ❯ post to slack
          <Sep />
          {mrRef(mr)}
        </>
      }
      ariaLabel={`post ${mrRef(mr)} to slack`}
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
        <section className="tui-owners-section">
          <p className="tui-owners-label">post to</p>
          <ListGroup>
            {rows.map(channel => {
              const owner = preview.channels.find(c => c.channel === channel);
              const on = !off.has(channel);
              return (
                <li
                  key={channel}
                  className="tui-owners-row"
                  data-off={on ? undefined : ''}
                >
                  <div className="tui-owners-row-head">
                    <span className="tui-owners-channel">#{channel}</span>
                    <span className="tui-owners-sections">
                      {owner
                        ? owner.sections
                            .map(s => sectionLabel(s, channel))
                            .join(', ')
                        : teamSections}
                      {unchecked.has(channel) && (
                        <>
                          <Sep />
                          could not check for an earlier post
                        </>
                      )}
                    </span>
                    <Switch
                      checked={on}
                      onChange={() => flip(channel)}
                      aria-label={`post to #${channel}`}
                    />
                  </div>
                  {on && (
                    <OwnerMessageEditor
                      value={messageFor(channel)}
                      link={mr.webUrl ?? ''}
                      linkLabel={mrRef(mr)}
                      label={`message to #${channel}`}
                      disabled={posting}
                      onChange={text =>
                        setEdits(prev => ({ ...prev, [channel]: text }))
                      }
                    />
                  )}
                </li>
              );
            })}
          </ListGroup>
        </section>
      )}
      {preview && rows.length === 0 && (
        <p className="tui-owners-note">nothing to post</p>
      )}
      {preview && (preview.team.posted || preview.skipped.length > 0) && (
        <section className="tui-owners-section">
          <p className="tui-owners-label">not posting</p>
          <ListGroup>
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
        </section>
      )}
      <div className="tui-draft-actions">
        {error && <span className="tui-draft-error">{error}</span>}
        {outcome && (
          <span className="tui-draft-error">
            {withSeps([
              ...outcome.posted.map(p => `posted to #${p.channel}`),
              ...outcome.failed.map(f => `#${f.channel} failed: ${f.error}`),
            ])}
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
            disabled={chosen.length === 0 || blank}
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
