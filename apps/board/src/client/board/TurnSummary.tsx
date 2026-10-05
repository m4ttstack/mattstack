import type { TurnBucket } from './turn-summary.ts';

const ORDER: { key: TurnBucket; label: string; tone: string }[] = [
  { key: 'needYou', label: 'need you', tone: 'accent' },
  { key: 'needReviewer', label: 'need a reviewer', tone: 'warn' },
  { key: 'waitingOnAuthor', label: 'waiting on author', tone: 'dim' },
  { key: 'readyToMerge', label: 'ready to merge', tone: 'ok' },
];

export function TurnSummary({
  counts,
  synced,
  onNeedsMe,
}: {
  counts: Record<TurnBucket, number>;
  synced: { text: string; stale: boolean };
  onNeedsMe: (() => void) | null;
}) {
  const parts = ORDER.filter(o => counts[o.key] > 0);
  return (
    <p className="tui-sub tui-turn-summary">
      {parts.length === 0 && (
        <span className="tui-turn-part">nothing open</span>
      )}
      {parts.map(o => (
        <span key={o.key} className="tui-turn-part" data-tone={o.tone}>
          <span className="tui-turn-dot" />
          <b>{counts[o.key]}</b>{' '}
          {o.key === 'needYou' && onNeedsMe ? (
            <button
              type="button"
              className="tui-config-link tui-turn-link"
              onClick={onNeedsMe}
            >
              {o.label}
            </button>
          ) : (
            o.label
          )}
        </span>
      ))}
      <span className="tui-turn-synced" data-stale={synced.stale || undefined}>
        · {synced.text.replace(/^data as of /, 'synced ')}
      </span>
    </p>
  );
}
