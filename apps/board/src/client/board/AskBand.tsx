import { useRef, useState } from 'react';

import { Button, Popover, Spinner } from '@mattstack/tui-kit';
import type { BoardMRWithReview, RowContext } from '../types.ts';
import {
  askBandModel,
  bandSource,
  clock,
  peerFailureBandModel,
  type AskAction,
  type AskBand,
} from './ask-band.ts';
import { AskGlyph } from './ask-glyph.tsx';
import { usePeople } from './people.ts';

const ACTION: Record<AskAction, string> = {
  retry: 'Retry',
  dismiss: 'Dismiss',
};

const SENT_FOOTER =
  'Dismiss clears it now. Retry drops the old ask and sends a fresh one.';
const peerFooter = (who: string) =>
  `Dismiss clears it now. Retry asks ${who} to review again.`;

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
              {[step.detail, step.at ? clock(step.at) : null]
                .filter(Boolean)
                .join(' · ')}
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
    this board's own ask, or a review their board lost. Retry and dismiss
    write through the local board, so a remote viewer sees the band without
    them. The left side is the click target that opens the trail. */
export function AskBand({
  mr,
  ctx,
}: {
  mr: BoardMRWithReview;
  ctx: RowContext;
}) {
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const people = usePeople(mr);
  const source = bandSource(mr);
  if (!source) return null;
  const band =
    source.kind === 'sent'
      ? askBandModel(
          source.sent,
          Date.now(),
          people.short(source.sent.reviewer)
        )
      : peerFailureBandModel(source.peer, people.short(source.peer.reviewer));
  const foot = source.kind === 'sent' ? SENT_FOOTER : peerFooter(band.who);
  const run = (action: AskAction) =>
    action === 'retry' ? ctx.onAskRetry(mr) : ctx.onAskDismiss(mr);
  return (
    <div
      ref={bar}
      className="tui-ask"
      data-ask-tone={band.tone}
      data-ask={source.kind === 'sent' ? source.sent.display : 'peer-failed'}
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
            <span className="tui-ask-sep" aria-hidden>
              ·
            </span>
            <span className="tui-ask-state">
              {band.icon === 'loader' ? (
                <Spinner size="xs" />
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
