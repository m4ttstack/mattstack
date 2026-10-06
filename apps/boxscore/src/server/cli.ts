/**
 * Headless, JSON-driven entry point ... the same pipeline the HTTP server uses, with no
 * UI. Lets the data + classification be run and evaluated from the terminal.
 *
 *   bun server/cli.ts --range 30d                 # ranked standings table
 *   bun server/cli.ts --range 7d --trend          # include trend deltas
 *   bun server/cli.ts --range 30d --format json   # raw response JSON
 *   bun server/cli.ts --range 30d --format validate --refresh   # run the evaluator (exit 1 on error)
 *   bun server/cli.ts --detail owen-at-acme --range 30d          # per-stat evidence for one person
 *   bun server/cli.ts --format bots                              # scan the whole store for suspected bots
 */
import {
  formatValue as fmt,
  GROUPS,
  metricByKey,
  metricRank,
  METRICS,
  metricValue,
} from '../shared/metrics.js';
import type { MetricKey, UserDetailResponse } from '../shared/types.js';
import { scanSuspectedBots } from './bots.js';
import { readSettings } from './config/index.js';
import { getLeaderboard, getUserDetail } from './leaderboard.js';
import { standingsOutcome } from './standings-text.js';
import { resolveWindowArgs } from './util/window.js';

interface Args {
  range: string;
  start?: string;
  end?: string;
  trend: boolean;
  refresh: boolean;
  format: 'table' | 'json' | 'validate' | 'bots';
  detail?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    range: readSettings().defaultRange,
    trend: false,
    refresh: false,
    format: 'table',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--range') a.range = argv[++i] ?? a.range;
    else if (arg === '--start') a.start = argv[++i];
    else if (arg === '--end') a.end = argv[++i];
    else if (arg === '--trend') a.trend = true;
    else if (arg === '--refresh') a.refresh = true;
    else if (arg === '--format')
      a.format = (argv[++i] as Args['format']) ?? 'table';
    else if (arg === '--json') a.format = 'json';
    else if (arg === '--detail') a.detail = argv[++i];
  }
  return a;
}

function printDetail(res: UserDetailResponse): void {
  const w = res.window;
  console.log(
    `\nDetail · ${res.user.name ?? res.user.username} (@${res.user.username})  ${w.start.slice(0, 10)} → ${w.end.slice(0, 10)}`
  );
  console.log(
    `${res.fromCache ? 'cached' : 'fresh'}${res.hasTrend ? ' · trend on' : ''}\n`
  );

  for (const d of METRICS) {
    const ev = res.evidence[d.key as MetricKey];
    const desc = metricByKey(d.key);
    const headline = fmt(metricValue(res.user.metrics, d), d);
    const rank = metricRank(res.user.metrics, d);
    console.log(
      `── ${d.label}  =${headline}${rank ? ` (#${rank})` : ''} ${desc ? `· ${GROUPS[desc.group].label}` : ''}`
    );
    if (!ev || ev.rows.length === 0) {
      console.log(`   ${ev?.summary ?? '(no records)'}\n`);
      continue;
    }
    if (ev.summary) console.log(`   ${ev.summary}`);
    console.log(`   ${ev.columns.join(' | ')}`);
    for (const row of ev.rows.slice(0, 15)) {
      console.log(`   ${row.muted ? '· ' : '  '}${row.cells.join(' | ')}`);
    }
    if (ev.rows.length > 15) console.log(`   … ${ev.rows.length - 15} more`);
    console.log('');
  }
}

async function printBots(): Promise<void> {
  const bots = await scanSuspectedBots(readSettings().botPatterns);
  if (bots.length === 0) {
    console.log('no suspected bots anywhere in the store');
    return;
  }
  for (const b of bots)
    console.log(`${b.username}  matched: ${b.matchedPattern}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.format === 'bots') {
    await printBots();
    return;
  }

  const window = resolveWindowArgs(
    args.range,
    args.start,
    args.end,
    readSettings().defaultRange
  );

  if (args.detail) {
    const detail = await getUserDetail({
      window,
      refresh: args.refresh,
      trend: args.trend,
      user: args.detail,
    });
    if (args.format === 'json') console.log(JSON.stringify(detail, null, 2));
    else printDetail(detail);
    return;
  }

  // A plain read never fetches, so a cold store would otherwise print an empty board that
  // looks like a real result. Probe first and say what to run instead.
  if (!args.refresh) {
    try {
      await getLeaderboard({
        window,
        refresh: false,
        trend: args.trend,
        cacheOnly: true,
      });
    } catch (err) {
      if ((err as Error).name === 'ColdCacheError') {
        console.error(
          'No data stored for this window yet. Run again with --refresh to fetch it.'
        );
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  }

  const res = await getLeaderboard({
    window,
    refresh: args.refresh,
    trend: args.trend,
  });

  if (args.format === 'json') {
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  const outcome = standingsOutcome(res, args.format === 'validate');
  for (const line of outcome.stdout) console.log(line);
  for (const line of outcome.stderr) console.error(line);
  if (outcome.exitCode !== 0) process.exit(outcome.exitCode);
}

main().catch(err => {
  console.error('cli failed:', (err as Error).message);
  process.exit(1);
});
