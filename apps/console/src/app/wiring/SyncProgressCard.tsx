import { useEffect, useState } from 'react';
import { Icon } from '@mattstack/app-kit/icons';

import classes from './SyncProgressCard.module.css';

/** `rt skills sync` reports nothing until it ends, so time is the only stall signal. */
export const STALL_AFTER_MS = 90_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function SyncSpinner({ size }: { size: number }) {
  return <Icon name="loaderCircle" size={size} className={classes.spin} />;
}

export interface SyncProgressCardProps {
  pack: string;
  /** Epoch ms of the click that started the sync. */
  startedAt: number;
}

/** The running state of a pack sync, after boxscore's refresh card. */
export function SyncProgressCard({ pack, startedAt }: SyncProgressCardProps) {
  const elapsedMs = Math.max(0, useNow() - startedAt);
  const stalled = elapsedMs >= STALL_AFTER_MS;
  const seconds = Math.floor(elapsedMs / 1000);

  return (
    <section
      className={classes.card}
      data-tone={stalled ? 'warn' : 'accent'}
      aria-label="Sync progress"
      data-testid="sync-progress-card"
    >
      <div className={classes.left}>
        <span className={classes.glyph} aria-hidden>
          {stalled ? (
            <Icon name="hourglass" size={16} />
          ) : (
            <SyncSpinner size={16} />
          )}
        </span>
        <span className={classes.title}>Syncing {pack}</span>
        <span className={classes.sub}>
          Pulling, compiling and publishing the pack; this can take a minute
        </span>
      </div>
      <span className={classes.elapsed} data-testid="sync-progress-elapsed">
        {stalled ? 'Still running' : 'Syncing'} · {seconds}s
      </span>
    </section>
  );
}
