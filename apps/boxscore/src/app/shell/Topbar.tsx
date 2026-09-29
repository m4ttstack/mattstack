import { Fragment } from 'react';

import { Glyph } from '../ui/Glyph';
import classes from './shell.module.css';

export type FreshnessTone = 'ok' | 'accent' | 'warn';

export interface Freshness {
  label: string;
  tone: FreshnessTone;
}

const DOT: Record<FreshnessTone, string> = {
  ok: 'var(--tk-dot-ok)',
  accent: 'var(--tk-fill-accent)',
  warn: 'var(--tk-dot-warn)',
};

const LABEL: Record<FreshnessTone, string> = {
  ok: 'var(--tk-text-3)',
  accent: 'var(--tk-text-accent)',
  warn: 'var(--tk-text-warn)',
};

export function syncedLabel(generatedAt: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(generatedAt)) / 60_000);
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} h ago`;
  return `Synced ${Math.floor(hours / 24)} d ago`;
}

export function Topbar({
  crumbs,
  scope,
  freshness,
  action,
  onAction,
}: {
  crumbs: string[];
  scope: string | null;
  freshness: Freshness | null;
  action: 'refresh' | 'cancel';
  onAction: () => void;
}) {
  const [app, ...trail] = crumbs;
  return (
    <header className={classes.topbar} data-parity="Topbar">
      <div className={classes.crumbs}>
        <span className={classes.appName} data-parity="App Name">
          {app}
        </span>
        {trail.map((c, i) => (
          <Fragment key={i}>
            <span className={classes.sep} data-parity="Sep">
              /
            </span>
            <span className={classes.crumb} data-parity="Crumb">
              {c}
            </span>
          </Fragment>
        ))}
      </div>
      <div className={classes.topRight}>
        {scope !== null && (
          <span className={classes.scopeChip} data-parity="Scope Chip">
            <Glyph
              name="gitBranch"
              size={13}
              color="var(--tk-text-3)"
              parity="Repo Icon"
            />
            <span className={classes.scope} data-parity="Scope">
              {scope}
            </span>
          </span>
        )}
        {freshness !== null && (
          <span className={classes.freshness}>
            <span
              className={classes.freshDot}
              data-parity="Fresh Dot"
              style={{ background: DOT[freshness.tone] }}
            />
            <span
              className={classes.freshLabel}
              data-parity="Fresh Label"
              style={{ color: LABEL[freshness.tone] }}
            >
              {freshness.label}
            </span>
          </span>
        )}
        <button
          type="button"
          className={classes.refreshButton}
          data-parity="Refresh Button"
          onClick={onAction}
        >
          {action === 'refresh' && (
            <Glyph
              name="refresh"
              size={14}
              color="var(--tk-text-2)"
              parity="Refresh Icon"
            />
          )}
          <span className={classes.refreshLabel} data-parity="Refresh Label">
            {action === 'refresh' ? 'Refresh' : 'Cancel'}
          </span>
        </button>
      </div>
    </header>
  );
}
