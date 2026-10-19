/** The plain HTML readout for the relay's version telemetry: tables only, no
    script, no external assets. Every string that came from a ping goes
    through `escapeHtml`. */
import { macLabel, type TelemetrySnapshot } from './telemetry.ts';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const iso = (ms: number) => new Date(ms).toISOString();
const orDash = (value: string | number | null) =>
  value === null ? '-' : String(value);
const list = (items: string[]) => (items.length > 0 ? items.join(', ') : '-');

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '<p>none</p>';
  const head = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows
    .map(
      row => `<tr>${row.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`
    )
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function renderTelemetryPage(s: TelemetrySnapshot): string {
  const macs = table(
    [
      'Mac',
      'Flavor',
      'App',
      'rt',
      'Plugin',
      'macOS',
      'Org layouts',
      'Packs',
      'Last seen',
      'Install id',
    ],
    s.macs.map(m => [
      macLabel(m),
      m.flavor,
      orDash(m.appVersion),
      m.rtVersion,
      orDash(m.pluginVersion),
      orDash(m.macosVersion),
      list(m.orgs.map(o => `${o.org}:${orDash(o.layout)}`)),
      list(m.packs.map(p => `${p.id}@${orDash(p.version)}`)),
      m.running ? `running (${iso(m.lastSeen)})` : iso(m.lastSeen),
      m.installId,
    ])
  );
  const versions = table(
    ['Kind', 'Version', 'Macs', 'Last seen'],
    s.versions.map(v => [v.kind, v.version, String(v.macs), iso(v.lastSeen)])
  );
  const migrations = table(
    ['Migration', 'Not run on', 'Too old to know it'],
    s.migrations.map(m => [m.id, list(m.notRun), list(m.tooOld)])
  );
  const legacyDirs = table(
    ['Mac', 'Legacy directories'],
    s.legacyDirs.map(d => [d.label, list(d.dirs)])
  );
  const orgLayouts = table(
    ['Org', 'Layout', 'Macs'],
    s.orgLayouts.map(o => [o.org, orDash(o.layout), list(o.macs)])
  );
  const packs = table(
    ['Pack', 'Oldest version', 'Macs'],
    s.packs.map(p => [p.id, orDash(p.oldestVersion), String(p.macs)])
  );
  const updates = table(
    ['When', 'Mac', 'Kind', 'From', 'To'],
    s.updates.map(u => [iso(u.at), u.label, u.kind, orDash(u.from), u.to])
  );
  return (
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>telemetry</title>` +
    `<style>:root{color-scheme:light dark}body{font:14px system-ui;margin:1rem}td,th{padding:2px 8px;text-align:left}</style>` +
    `<h1>Version telemetry</h1>` +
    `<h2>Macs</h2>${macs}` +
    `<h2>Versions</h2>${versions}` +
    `<h2>Retirement checks</h2>` +
    `<h3>Migrations</h3>${migrations}` +
    `<h3>Legacy directories</h3>${legacyDirs}` +
    `<h3>Org layouts</h3>${orgLayouts}` +
    `<h3>Packs</h3>${packs}` +
    `<h2>Recent updates</h2>${updates}`
  );
}
