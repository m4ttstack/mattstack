/** The plain HTML readout for the relay's version telemetry: tables, no
    external assets, and one inline script the CSP pins by hash. Only the
    browser knows the viewer's timezone, so times arrive as UTC and the script
    rewrites them; without it they stay readable UTC. Every string that came
    from a ping goes through `escapeHtml`. */
import { createHash } from 'node:crypto';

import {
  compareVersions,
  macLabel,
  type TelemetrySnapshot,
} from './telemetry.ts';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const STYLE = `
:root{color-scheme:light dark;--page:light-dark(#f9f9fb,#111113);--card:light-dark(#fff,#18191b);--hover:light-dark(#f9f9fb,#212225);--line:light-dark(#e0e1e6,#363a3f);--fg:light-dark(#1c2024,#edeef0);--muted:light-dark(#60646c,#b0b4ba);--accent:light-dark(#cc4e00,#ffa057);--ok:light-dark(#008573,#0bd8b6)}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
main{max-width:1320px;margin:0 auto;padding-block:48px 72px;padding-inline:max(16px,2.5vw);display:grid;gap:40px}
main>*{min-width:0}
h1,h2,h3,p{margin:0;font-weight:600;text-wrap:balance}
h1{font-size:28px;line-height:36px;letter-spacing:-.01em}
h2{font-size:18px;line-height:24px}
h3{font-size:14px;line-height:20px}
section{display:grid;gap:12px;min-width:0}
.stack{display:grid;gap:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:24px;align-items:start}
.card{min-width:0;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:10px 12px;text-align:left;vertical-align:top}
th{color:var(--muted);font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;border-bottom:1px solid var(--line)}
td{border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--hover)}
.none{color:var(--muted)}
p.none{padding:12px 16px;font:14px/20px system-ui,sans-serif}
.id{display:block;max-width:10ch;overflow:hidden;text-overflow:ellipsis;color:var(--muted);font:12px/21px ui-monospace,Menlo,monospace;white-space:nowrap}
.nowrap{white-space:nowrap}
.behind{color:var(--accent);font-weight:600}
.dev{font-weight:600}
.seen{display:inline-flex;align-items:center;gap:8px;vertical-align:top;color:var(--muted);white-space:nowrap}
.seen::before{content:"";flex:none;width:7px;height:7px;border-radius:50%}
.seen.live{color:var(--fg)}
.seen.live::before{background:var(--ok)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.arrow{color:var(--muted)}
.note{margin-left:8px;color:var(--muted);font:13px/20px system-ui,sans-serif}
`.trim();

const SCRIPT =
  `const clock=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',hour12:true});` +
  `const calendar=new Intl.DateTimeFormat('en-US',{day:'2-digit',month:'2-digit',year:'numeric'});` +
  `const today=new Date();const yesterday=new Date();yesterday.setDate(today.getDate()-1);` +
  `const dayLabel=date=>{const day=calendar.format(date);` +
  `return day===calendar.format(today)?'Today':day===calendar.format(yesterday)?'Yesterday':day};` +
  `for(const time of document.querySelectorAll('time')){const date=new Date(time.dateTime);` +
  `time.textContent=dayLabel(date)+', '+clock.format(date)}`;

export const TELEMETRY_CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${createHash('sha256').update(SCRIPT).digest('base64')}'`;

type Cell = string | { html: string };

function time(ms: number): { html: string } {
  const utc = new Date(ms).toISOString();
  return { html: `<time datetime="${utc}">${utc}</time>` };
}

const cellHtml = (cell: Cell) => {
  if (cell === '-') return '<span class="none">-</span>';
  return typeof cell === 'string' ? escapeHtml(cell) : cell.html;
};

const panel = (title: string, body: string, heading = 'h2') =>
  `<section><${heading}>${title}</${heading}><div class="card">${body}</div></section>`;

const orDash = (value: string | number | null) =>
  value === null ? '-' : String(value);
const list = (items: string[]) => (items.length > 0 ? items.join(', ') : '-');

const isRelease = (version: string) => /^v?\d+(\.\d+)*$/.test(version);

function newest(versions: (string | null)[]): string | null {
  let best: string | null = null;
  for (const version of versions) {
    if (version === null || !isRelease(version)) continue;
    if (best === null || compareVersions(version, best) > 0) best = version;
  }
  return best;
}

const isBehind = (version: string | null, latest: string | null) =>
  version !== null &&
  latest !== null &&
  isRelease(version) &&
  compareVersions(version, latest) < 0;

function versionCell(version: string | null, latest: string | null): Cell {
  if (version === null || latest === null || !isBehind(version, latest)) {
    return orDash(version);
  }
  return {
    html: `<span class="behind" title="Behind ${escapeHtml(latest)}">${escapeHtml(version)}</span>`,
  };
}

const lastSeen = (m: TelemetrySnapshot['macs'][number]): Cell => ({
  html: m.running
    ? `<span class="seen live" title="Running"><span class="sr">Running</span>${time(m.lastSeen).html}</span>`
    : `<span class="seen">${time(m.lastSeen).html}</span>`,
});

const change = (from: string | null, to: string) =>
  `${escapeHtml(orDash(from))} <span class="arrow">\u2192</span> ${escapeHtml(to)}`;

function mergedUpdates(updates: TelemetrySnapshot['updates']) {
  const rows = new Map<
    string,
    { at: number; label: string; app: string | null; rt: string | null }
  >();
  for (const u of updates) {
    const key = `${u.at}\0${u.label}`;
    const row = rows.get(key) ?? {
      at: u.at,
      label: u.label,
      app: null,
      rt: null,
    };
    row[u.kind] = change(u.from, u.to);
    rows.set(key, row);
  }
  return [...rows.values()];
}

const changeCell = (html: string | null): Cell =>
  html === null ? '-' : { html };

function table(headers: string[], rows: Cell[][]): string {
  if (rows.length === 0) return '<p class="none">none</p>';
  const head = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows
    .map(row => `<tr>${row.map(c => `<td>${cellHtml(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderTelemetryPage(s: TelemetrySnapshot): string {
  const prod = s.macs.filter(m => m.flavor === 'prod');
  const latest = {
    app: newest(prod.map(m => m.appVersion)),
    rt: newest(prod.map(m => m.rtVersion)),
    plugin: newest(prod.map(m => m.pluginVersion)),
  };
  const behind = table(
    ['Mac', 'App', 'rt', 'Last seen'],
    s.macs
      .filter(
        m =>
          isBehind(m.appVersion, latest.app) || isBehind(m.rtVersion, latest.rt)
      )
      .map(m => [
        macLabel(m),
        versionCell(m.appVersion, latest.app),
        versionCell(m.rtVersion, latest.rt),
        lastSeen(m),
      ])
  );
  const release = [
    latest.app && `app ${latest.app}`,
    latest.rt && `rt ${latest.rt}`,
  ]
    .filter(Boolean)
    .join(', ');
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
      { html: `<span class="nowrap">${escapeHtml(macLabel(m))}</span>` },
      {
        html:
          m.flavor === 'dev'
            ? '<span class="dev">dev</span>'
            : `<span class="none">${escapeHtml(m.flavor)}</span>`,
      },
      versionCell(m.appVersion, latest.app),
      versionCell(m.rtVersion, latest.rt),
      versionCell(m.pluginVersion, latest.plugin),
      orDash(m.macosVersion),
      list(m.orgs.map(o => `${o.org}:${orDash(o.layout)}`)),
      m.packs.length > 0
        ? {
            html: m.packs
              .map(
                p =>
                  `<div class="nowrap">${escapeHtml(p.version === null ? p.id : `${p.id} (${p.version})`)}</div>`
              )
              .join(''),
          }
        : '-',
      lastSeen(m),
      {
        html: `<span class="id" title="${escapeHtml(m.installId)}">${escapeHtml(m.installId)}</span>`,
      },
    ])
  );
  const versions = (kind: 'app' | 'rt') =>
    table(
      [kind === 'app' ? 'App' : 'rt', 'Macs', 'Last seen'],
      s.versions
        .filter(v => v.kind === kind)
        .map(v => [
          versionCell(v.version, latest[kind]),
          String(v.macs),
          time(v.lastSeen),
        ])
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
    ['When', 'Mac', 'App', 'rt'],
    mergedUpdates(s.updates).map(u => [
      time(u.at),
      u.label,
      changeCell(u.app),
      changeCell(u.rt),
    ])
  );
  return (
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>telemetry</title>` +
    `<style>${STYLE}</style>` +
    `<main>` +
    `<h1>Version telemetry</h1>` +
    panel(
      `Not on the latest release<span class="note">${escapeHtml(release)}</span>`,
      behind
    ) +
    panel('Macs', macs) +
    `<section class="stack"><h2>Versions</h2><div class="grid">` +
    `<div class="card">${versions('app')}</div>` +
    `<div class="card">${versions('rt')}</div>` +
    `</div></section>` +
    `<section class="stack"><h2>Retirement checks</h2>` +
    panel('Migrations', migrations, 'h3') +
    (s.legacyDirs.length === 0
      ? `<h3>Legacy directories <span class="none">none</span></h3>`
      : '') +
    `<div class="grid">` +
    (s.legacyDirs.length > 0
      ? panel('Legacy directories', legacyDirs, 'h3')
      : '') +
    panel('Org layouts', orgLayouts, 'h3') +
    panel('Packs', packs, 'h3') +
    `</div></section>` +
    panel('Recent updates', updates) +
    `</main>` +
    `<script>${SCRIPT}</script>`
  );
}
