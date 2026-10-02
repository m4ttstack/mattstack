import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button, ContextMenu, Spinner } from '@mattstack/tui-kit';
import type { BoardMRWithReview, RowContext } from '../types.ts';
import {
  askBandModel,
  clock,
  type AskAction,
  type AskBand,
} from './ask-band.ts';
import { AskGlyph } from './ask-glyph.tsx';

const ACTION: Record<AskAction, string> = {
  retry: 'Retry',
  dismiss: 'Dismiss',
};

const FOOTER =
  'Dismiss clears it now; otherwise it clears itself in 24h. Retry drops the old ask and sends a fresh one.';

/** The trail: what the row knows of the ask's life, oldest first, in the
    kit's anchored menu surface (it clamps to the viewport and closes on
    Escape, an outside click, scroll and resize). A portal, since the row
    clips its own overflow. */
function Trail({
  band,
  rect,
  onClose,
}: {
  band: AskBand;
  rect: DOMRect;
  onClose: () => void;
}) {
  const last = band.steps.length - 1;
  const stop = band.tone === 'bad' || band.tone === 'warn';
  return createPortal(
    <ContextMenu
      x={rect.left}
      y={rect.bottom + 6}
      ariaLabel={band.title}
      onClose={onClose}
      className="tui-ask-trail"
    >
      <ContextMenu.Label>{band.title}</ContextMenu.Label>
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
    </ContextMenu>,
    document.body
  );
}

/** This board's own ask of a teammate's agent, on its own line at the foot of
    the row. Retry and dismiss write through the local board, so a remote
    viewer sees the band without them. The left side is the click target that
    opens the trail. */
export function AskBand({
  mr,
  ctx,
}: {
  mr: BoardMRWithReview;
  ctx: RowContext;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const sent = mr.sentNudge;
  if (!sent) return null;
  const band = askBandModel(sent);
  const run = (action: AskAction) =>
    action === 'retry' ? ctx.onAskRetry(mr) : ctx.onAskDismiss(mr);
  const open = rect !== null;
  return (
    <div
      ref={bar}
      className="tui-ask"
      data-ask-tone={band.tone}
      data-ask={sent.display}
    >
      <button
        type="button"
        className="tui-ask-trigger"
        aria-expanded={open}
        title={open ? 'hide the ask history' : 'show the ask history'}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          setRect(open ? null : bar.current!.getBoundingClientRect());
        }}
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
      {rect && <Trail band={band} rect={rect} onClose={() => setRect(null)} />}
    </div>
  );
}
