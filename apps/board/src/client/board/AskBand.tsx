import { useRef, useState } from 'react';

import { Button, Popover } from '@mattstack/tui-kit';
import type { BoardMRWithReview, RowContext } from '../types.ts';
import {
  askBandModel,
  bandRemind,
  bandSource,
  clock,
  peerFailureBandModel,
  peerParkedBandModel,
  withReminder,
  type AskAction,
  type AskBand,
} from './ask-band.ts';
import { AskGlyph } from './ask-glyph.tsx';
import { CloudSpinner } from './icons.tsx';
import { usePeople } from './people.ts';

const ACTION: Record<AskAction, string> = {
  retry: 'Retry',
  remind: 'Remind',
  dismiss: 'Dismiss',
};

const SENT_FOOTER =
  'Dismiss clears it now. Retry drops the old ask and sends a fresh one.';
const peerFooter = (who: string) =>
  `Dismiss clears it now. Retry asks ${who} to review again.`;
const parkedFooter = (slackName: string | undefined) =>
  slackName
    ? `Dismiss clears it now. Remind sends ${slackName} a Slack DM.`
    : 'Dismiss clears it now.';
const remindTitle = (slackName: string) => `Send ${slackName} a Slack DM`;

/** The trail: what the row knows of the ask's life, oldest first. Clicks
    inside stay in the trail, since the row behind it opens on a click. */
function Trail({ band, foot }: { band: AskBand; foot: string }) {
  const last = band.steps.length - 1;
  const stop = band.tone === 'bad' || band.tone === 'warn';
  return (
    <div
      className="tui-ask-trail-body"
      onClick={e => e.stopPropagation()}
      onContextMenu={e => e.stopPropagation()}
    >
      <div className="tui-ask-trail-title">{band.title}</div>
      {band.steps.map((step, i) => (
        <div
          key={step.name}
          className="tui-ask-trail-step"
          data-stop={stop && i === last ? band.tone : undefined}
        >
          <AskGlyph
            name={stop && i === last ? band.icon : 'circle-check'}
            size={14}
          />
          <div className="tui-ask-trail-text">
            <span className="tui-ask-trail-name">{step.name}</span>
            <span className="tui-ask-trail-detail">
              {step.detail && <span>{step.detail}</span>}
              {step.at && (
                <span className="tui-ask-trail-time">{clock(step.at)}</span>
              )}
            </span>
          </div>
        </div>
      ))}
      {band.actions.length > 0 && (
        <div className="tui-ask-trail-foot">{foot}</div>
      )}
    </div>
  );
}

/** A teammate's agent on this MR, on its own line at the foot of the row:
    this board's own ask, or a review their board lost or parked. Its
    actions write through the local board, so a remote viewer sees the band
    without them. The left side is the click target that opens the trail. */
export function AskBand({
  mr,
  ctx,
}: {
  mr: BoardMRWithReview;
  ctx: RowContext;
}) {
  const [open, setOpen] = useState(false);
  const [reminding, setReminding] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const people = usePeople(mr);
  const source = bandSource(mr, ctx.self);
  if (!source) return null;
  const now = Date.now();
  const parked =
    source.kind === 'sent'
      ? source.sent.display === 'parked'
      : source.peer.status === 'parked';
  const model =
    source.kind === 'sent'
      ? askBandModel(source.sent, now, people.short(source.sent.reviewer))
      : parked
        ? peerParkedBandModel(
            source.peer,
            people.short(source.peer.reviewer),
            now
          )
        : peerFailureBandModel(source.peer, people.short(source.peer.reviewer));
  const remind = parked
    ? bandRemind(mr, ctx.self, ctx.slackNames ?? {}, model.name, now)
    : null;
  const band = withReminder(model, remind?.remindedAt, now);
  const foot = parked
    ? parkedFooter(remind?.slackName)
    : source.kind === 'sent'
      ? SENT_FOOTER
      : peerFooter(band.who);
  const run = (action: AskAction) => {
    if (action === 'retry') ctx.onAskRetry(mr);
    else if (action === 'remind') {
      setReminding(true);
      void Promise.resolve(ctx.onAskRemind?.(mr)).finally(() =>
        setReminding(false)
      );
    } else ctx.onAskDismiss(mr);
  };
  return (
    <div
      ref={bar}
      className="tui-ask"
      data-ask-tone={band.tone}
      data-ask={
        source.kind === 'sent'
          ? source.sent.display
          : parked
            ? 'peer-parked'
            : 'peer-failed'
      }
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="start"
        sideOffset={6}
        anchor={bar}
        ariaLabel={band.title}
        classNames={{ popup: 'tui-ask-trail' }}
        trigger={
          <button
            type="button"
            className="tui-ask-trigger"
            title={open ? 'hide the ask history' : 'show the ask history'}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <span className="tui-ask-where">
              <AskGlyph name="cloud" />
              {band.who}
            </span>
            <span className="tui-ask-state">
              {band.icon === 'loader' ? (
                <CloudSpinner />
              ) : (
                <AskGlyph name={band.icon} />
              )}
              <span className="tui-ask-label" title={band.label}>
                {band.label}
              </span>
            </span>
            <span className="tui-ask-caret" data-open={open ? '1' : undefined}>
              <AskGlyph name="chevron-down" size={12} />
            </span>
          </button>
        }
      >
        <Trail band={band} foot={foot} />
      </Popover>
      {band.note && <span className="tui-ask-note">{band.note}</span>}
      {ctx.local &&
        band.actions.map(action => (
          <Button
            key={action}
            type="button"
            size="sm"
            variant="subtle"
            intent="muted"
            className="tui-ask-btn"
            data-action={action}
            {...(action === 'remind'
              ? {
                  busy: reminding,
                  disabled: !remind || remind.blocked !== undefined,
                  title:
                    remind?.blocked ??
                    (remind?.slackName
                      ? remindTitle(remind.slackName)
                      : undefined),
                }
              : {})}
            onClick={e => {
              e.stopPropagation();
              run(action);
            }}
          >
            {ACTION[action]}
          </Button>
        ))}
    </div>
  );
}
