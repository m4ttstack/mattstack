import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@mattstack/tui-kit';
import type { BoardMRWithReview, RowContext } from '../types.ts';
import { askBandModel, type AskAction, type AskBand } from './ask-band.ts';
import { AskGlyph } from './icons.tsx';

const ACTION: Record<AskAction, string> = {
  retry: 'Retry',
  dismiss: 'Dismiss',
};

const FOOTER =
  'Dismiss clears it now; otherwise it clears itself in 24h. Retry drops the old ask and sends a fresh one.';

const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Room the card needs below the band before it flips above it. */
const CARD_ROOM = 240;

/** The trail: what the row knows of the ask's life, oldest first. A portal,
    since the row clips its own overflow. It drops in from the band's edge,
    and closes on an outside click, Escape, or any scroll or resize. */
function Trail({
  band,
  rect,
  trigger,
  onClose,
}: {
  band: AskBand;
  rect: DOMRect;
  trigger: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (card.current?.contains(t) || trigger.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose, trigger]);
  const flip = rect.bottom + CARD_ROOM > window.innerHeight;
  const last = band.steps.length - 1;
  const stop = band.tone === 'bad' || band.tone === 'warn';
  return createPortal(
    <div
      ref={card}
      className="tui-ask-trail"
      data-shown={shown ? '1' : undefined}
      data-flip={flip ? '1' : undefined}
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
  const trigger = useRef<HTMLButtonElement>(null);
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
        ref={trigger}
        type="button"
        className="tui-ask-trigger"
        aria-expanded={open}
        title={open ? 'hide the ask history' : 'show the ask history'}
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
            <span className="tui-ask-ring" aria-hidden />
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
      {rect && (
        <Trail
          band={band}
          rect={rect}
          trigger={trigger}
          onClose={() => setRect(null)}
        />
      )}
    </div>
  );
}
