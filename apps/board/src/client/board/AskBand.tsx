import { useState } from 'react';
import { createPortal } from 'react-dom';

import type { BoardMRWithReview, RowContext } from '../types.ts';
import { askBandModel, type AskAction, type AskBand } from './ask-band.ts';
import { AskGlyph } from './icons.tsx';

const ACTION: Record<AskAction, { label: string; icon: string }> = {
  retry: { label: 'Retry', icon: 'rotate-cw' },
  dismiss: { label: 'Dismiss', icon: 'x' },
};

const FOOTER =
  'Dismiss clears it now; otherwise it clears itself in 24h. Retry drops the old ask and sends a fresh one.';

const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Room the card needs below the band before it flips above it. */
const CARD_ROOM = 240;

/** The hover trail: what the row knows of the ask's life, oldest first. A
    portal, since the row clips its own overflow. */
function Trail({ band, rect }: { band: AskBand; rect: DOMRect }) {
  const flip = rect.bottom + CARD_ROOM > window.innerHeight;
  const last = band.steps.length - 1;
  const stop = band.tone === 'bad' || band.tone === 'warn';
  return createPortal(
    <div
      className="tui-ask-trail"
      role="presentation"
      style={{
        left: rect.left,
        ...(flip
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
      }}
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
        <div className="tui-ask-trail-foot">{FOOTER}</div>
      )}
    </div>,
    document.body
  );
}

/** This board's own ask of a teammate's agent, on its own line at the foot of
    the row. Retry and dismiss write through the local board, so a remote
    viewer sees the band without them. */
export function AskBand({
  mr,
  now,
  ctx,
}: {
  mr: BoardMRWithReview;
  now: number;
  ctx: RowContext;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const sent = mr.sentNudge;
  if (!sent) return null;
  const band = askBandModel(sent, now);
  const run = (action: AskAction) =>
    action === 'retry' ? ctx.onAskRetry(mr) : ctx.onAskDismiss(mr);
  return (
    <div
      className="tui-ask"
      data-ask-tone={band.tone}
      data-ask={sent.display}
      onMouseEnter={e => setRect(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setRect(null)}
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
          <span className="tui-ask-ring" aria-hidden />
        ) : (
          <AskGlyph name={band.icon} />
        )}
        <span className="tui-ask-label" title={band.label}>
          {band.label}
        </span>
      </span>
      {band.age && <span className="tui-ask-age">{band.age}</span>}
      {ctx.local &&
        band.actions.map(action => (
          <button
            key={action}
            type="button"
            className="tui-ask-btn"
            data-action={action}
            onClick={e => {
              e.stopPropagation();
              run(action);
            }}
          >
            <AskGlyph name={ACTION[action].icon} size={12} />
            {ACTION[action].label}
          </button>
        ))}
      {rect && <Trail band={band} rect={rect} />}
    </div>
  );
}
