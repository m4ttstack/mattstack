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

const STYLE = `
:root{color-scheme:light dark;--line:light-dark(#d4d4d8,#3f3f46);--head:light-dark(#f4f4f5,#27272a);--muted:light-dark(#71717a,#a1a1aa)}
body{font:14px/1.45 system-ui,sans-serif;max-width:1200px;margin:0 auto;padding:1rem 1.25rem 3rem}
h1,h2,h3{font-weight:600}
h2{margin-top:2rem}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:6px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--head);white-space:nowrap}
.none{color:var(--muted)}
`.trim();

const iso = (ms: number) => new Date(ms).toISOString();
const orDash = (value: string | number | null) =>
  value === null ? '-' : String(value);
const list = (items: string[]) => (items.length > 0 ? items.join(', ') : '-');

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '<p class="none">none</p>';
  const head = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows
    .map(
      row => `<tr>${row.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`
    )
    .join('');
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
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
      list(
        m.packs.map(p => (p.version === null ? p.id : `${p.id} (${p.version})`))
      ),
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
    `<style>${STYLE}</style>` +
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
