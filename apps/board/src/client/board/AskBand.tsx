import type { BoardMRWithReview, RowContext } from '../types.ts';
import { askBandModel, type AskAction } from './ask-band.ts';
import { AskGlyph } from './icons.tsx';

const ACTION: Record<AskAction, { label: string; icon: string }> = {
  retry: { label: 'Retry', icon: 'rotate-cw' },
  dismiss: { label: 'Dismiss', icon: 'x' },
};

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
  const sent = mr.sentNudge;
  if (!sent) return null;
  const band = askBandModel(sent, now);
  const run = (action: AskAction) =>
    action === 'retry' ? ctx.onAskRetry(mr) : ctx.onAskDismiss(mr);
  return (
    <div
      className="tui-ask"
      data-tone={band.tone}
      data-ask={sent.display}
      title={band.trail.join('\n')}
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
    </div>
  );
}
