import {
  Alert,
  Badge,
  Button,
  ICONS,
  Spinner,
  Tooltip,
} from '@mattstack/tui-kit';
import { OFF_TIP, SiteMark } from '../AppsTable.tsx';
import { isMattstack, statusPill, type Row } from '../logic.ts';
import type { BlockProps } from './block.ts';

function ownerBadge(row: Row): string | null {
  if (row.isTunnel || row.managedBy == null) return null;
  return isMattstack(row) ? 'mattstack' : 'your app';
}

function SiteUrl({ row }: { row: Row }) {
  if (!row.url || !row.displayTld) return null;
  const host = `${row.name}.${row.displayTld}`;
  if (!row.health?.ok)
    return <span className="settings-url muted">{host}</span>;
  return (
    <a className="settings-url" href={row.url} target="_blank" rel="noopener">
      {host}
      {ICONS['external-link']}
    </a>
  );
}

/** The modal's head row, passed as the kit Modal's title: identity on the
    left, the status pill and Restart on the right. */
export function SettingsHeader({ row, board, blocks }: BlockProps) {
  const restarting = board.isRestarting(row);
  const pill = statusPill(row, restarting);
  const owner = ownerBadge(row);
  const badge = (
    <Badge intent={pill.tone}>
      {restarting ? (
        <Spinner size="xs" />
      ) : (
        <span className="settings-pill-dot" aria-hidden="true" />
      )}
      <span>{pill.label}</span>
      {pill.detail && (
        <span className="settings-pill-detail">{pill.detail}</span>
      )}
    </Badge>
  );
  return (
    <section data-block="status" aria-label="Status" className="settings-head">
      <SiteMark row={row} />
      <span className="settings-identity">
        <span className="settings-name-line">
          <span className="settings-name">{row.name}</span>
          {owner && <Badge intent="muted">{owner}</Badge>}
        </span>
        <SiteUrl row={row} />
      </span>
      <span className="settings-head-actions">
        <span
          className="settings-pill"
          data-part="status-pill"
          data-tone={pill.tone}
        >
          {row.enabled === false ? (
            <Tooltip tip={OFF_TIP}>{badge}</Tooltip>
          ) : (
            badge
          )}
        </span>
        {blocks.restart && row.service && (
          <Tooltip tip="Restarts the service. The app is unavailable for a moment.">
            <Button
              aria-label={`restart ${row.service.short}`}
              busy={restarting}
              onClick={() => board.onRestart(row)}
            >
              {!restarting && ICONS['refresh-cw']}
              {restarting ? 'Restarting…' : 'Restart'}
            </Button>
          </Tooltip>
        )}
      </span>
    </section>
  );
}

export function IssuesBlock({ row }: BlockProps) {
  const issues = row.issues ?? [];
  if (issues.length === 0) return null;
  return (
    <section
      data-block="issues"
      aria-label="Sync issues"
      className="settings-issues"
    >
      {issues.map(issue => (
        <Alert key={issue.source} intent="bad">
          <span className="settings-issue">
            {ICONS['triangle-alert']}
            {issue.source} sync failed · {issue.message}
          </span>
        </Alert>
      ))}
    </section>
  );
}
