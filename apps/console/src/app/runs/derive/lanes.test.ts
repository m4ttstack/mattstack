import type { GateRow, RunFieldRow, RunSummary } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import {
  dayGroups,
  evidenceText,
  filterView,
  laneFacts,
  laneMrLine,
  latestField,
  outcomeTile,
  rowDuration,
  rowEnd,
  rowSub,
  runsStats,
  splitRuns,
  statCards,
  waitingBanner,
} from './lanes';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = new Date(2026, 9, 8, 16, 23).getTime();
const TODAY = (h: number, m = 0) => new Date(2026, 9, 8, h, m).getTime();
const YESTERDAY = (h: number, m = 0) => new Date(2026, 9, 7, h, m).getTime();

const run = (over: Partial<RunSummary>): RunSummary => ({
  id: 'r',
  repo: 'remote:acme%2Fweb',
  work_type: 'feature',
  pipeline: 'work',
  status: 'running',
  current_stage: null,
  spawned_by: null,
  started_at: TODAY(9),
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: TODAY(9),
  ticket: null,
  branch: null,
  ...over,
});

const gate = (over: Partial<GateRow>): GateRow =>
  ({
    id: 'g',
    subject: 'run:r',
    kind: 'plan',
    status: 'open',
    owner: 'human',
    openedAt: TODAY(16, 17),
    questions: [],
    answer: null,
    origin: null,
    ...over,
  }) as GateRow;

const merged = (id: string, start: number, end: number): RunSummary =>
  run({
    id,
    status: 'done',
    started_at: start,
    ended_at: end,
    last_event_at: end,
    outcome: {
      status: 'done',
      mr: { iid: 1, state: 'merged', url: null, mergedAt: end },
    },
  });

describe('waitingBanner', () => {
  it('picks my oldest waiting run gate on a live run', () => {
    const runs = [run({ id: 'a' }), run({ id: 'b' })];
    const gates = [
      gate({ id: 'g2', subject: 'run:b', openedAt: TODAY(16, 20) }),
      gate({ id: 'g1', subject: 'run:a', openedAt: TODAY(16, 10) }),
    ];
    expect(waitingBanner(runs, gates, NOW)).toMatchObject({
      gate: { id: 'g1' },
      run: { id: 'a' },
    });
  });

  it('never shows a herd-owned gate or a review hand-off', () => {
    const runs = [run({ id: 'a' }), run({ id: 'rev', work_type: 'review' })];
    const gates = [
      gate({ id: 'herd', subject: 'run:a', owner: 'herd:acme-web' }),
      gate({
        id: 'post',
        subject: 'mr:acme/web!412',
        kind: 'review-post',
        origin: { runId: 'rev' } as GateRow['origin'],
      }),
    ];
    expect(waitingBanner(runs, gates, NOW)).toBeNull();
  });

  it('shows a gate on a stale run, which the waiting stat counts too', () => {
    const runs = [
      run({
        id: 'a',
        attention: { needs: true, reason: 'stale', evidence: 'quiet' },
      }),
    ];
    const gates = [gate({ subject: 'run:a' })];
    expect(waitingBanner(runs, gates, NOW)?.run.id).toBe('a');
    expect(runsStats({ runs, gates, lanes: [], now: NOW }).waiting.count).toBe(
      1
    );
  });

  it('leaves out a gate whose run is not on the page, from both', () => {
    const gates = [gate({ subject: 'run:gone' })];
    expect(waitingBanner([run({ id: 'a' })], gates, NOW)).toBeNull();
    expect(
      runsStats({ runs: [run({ id: 'a' })], gates, lanes: [], now: NOW })
        .waiting.count
    ).toBe(0);
  });
});

describe('splitRuns', () => {
  it('puts running runs that are not stale in lanes, newest first, and leaves out the banner run', () => {
    const runs = [
      run({ id: 'old', started_at: TODAY(8) }),
      run({ id: 'new', started_at: TODAY(13) }),
      run({ id: 'banner', started_at: TODAY(14) }),
      run({
        id: 'stale',
        attention: { needs: true, reason: 'stale', evidence: 'quiet' },
      }),
      run({ id: 'done', status: 'done', ended_at: TODAY(12) }),
    ];
    const { lanes, earlier } = splitRuns(runs, 'banner');
    expect(lanes.map(r => r.id)).toEqual(['new', 'old']);
    expect(earlier.map(r => r.id).sort()).toEqual(['done', 'stale']);
  });

  it('keeps a stale or ended banner run in Earlier', () => {
    const stale = run({
      id: 'stale',
      attention: { needs: true, reason: 'stale', evidence: 'quiet' },
    });
    const ended = run({ id: 'ended', status: 'done', ended_at: TODAY(12) });
    expect(splitRuns([stale, ended], 'stale').earlier.map(r => r.id)).toEqual([
      'stale',
      'ended',
    ]);
    expect(splitRuns([stale, ended], 'ended').earlier.map(r => r.id)).toEqual([
      'stale',
      'ended',
    ]);
  });
});

describe('evidenceText', () => {
  it('counts a work run’s images, else its legacy links, else a dash', () => {
    expect(evidenceText(run({ evidence_count: 3, evidence_links: 2 }))).toBe(
      '3 evidence'
    );
    expect(evidenceText(run({ evidence_count: 0, evidence_links: 3 }))).toBe(
      '3 links'
    );
    expect(evidenceText(run({ evidence_links: 1 }))).toBe('1 link');
    expect(evidenceText(run({}))).toBe('—');
    expect(evidenceText(run({ work_type: 'review', evidence_links: 2 }))).toBe(
      '—'
    );
  });
});

describe('rows', () => {
  it('ends a merged run at the merge and a stale run at its last event', () => {
    const m = run({
      status: 'done',
      started_at: TODAY(11, 42),
      ended_at: TODAY(14, 12),
      outcome: {
        status: 'done',
        mr: { iid: 405, state: 'merged', url: null, mergedAt: TODAY(14, 14) },
      },
    });
    expect(rowEnd(m, NOW)).toBe(TODAY(14, 14));
    expect(rowDuration(m, NOW)).toBe(2.5 * HOUR);
    const stale = run({
      started_at: YESTERDAY(10, 46),
      last_event_at: YESTERDAY(13, 18),
      attention: { needs: true, reason: 'stale', evidence: 'quiet' },
    });
    expect(rowEnd(stale, NOW)).toBe(YESTERDAY(13, 18));
    expect(rowDuration(stale, NOW)).toBe(2 * HOUR + 32 * MIN);
  });

  it('groups earlier runs by the day they ended, newest first', () => {
    const groups = dayGroups(
      [
        merged('y', YESTERDAY(9), YESTERDAY(10)),
        merged('t1', TODAY(8), TODAY(9)),
        merged('t2', TODAY(10), TODAY(11)),
        merged('old', TODAY(10) - 3 * 24 * HOUR, TODAY(11) - 3 * 24 * HOUR),
      ],
      NOW
    );
    expect(groups.map(g => g.label)).toEqual([
      'Today',
      'Yesterday',
      new Date(TODAY(11) - 3 * 24 * HOUR).toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    ]);
    expect(groups[0]!.runs.map(r => r.id)).toEqual(['t2', 't1']);
  });

  it('says how each kind of run ended', () => {
    expect(rowSub(merged('m', TODAY(8), TODAY(9)))).toBe(
      'work pipeline · !1 merged'
    );
    expect(
      rowSub(
        run({
          work_type: 'review',
          pipeline: 'review',
          status: 'done',
          ended_at: TODAY(9),
          outcome: {
            status: 'done',
            reviewed: { iid: 412, url: null, posted: 'request changes' },
          },
        })
      )
    ).toBe('review pipeline · reviewed !412 · request changes');
    expect(
      rowSub(
        run({ attention: { needs: true, reason: 'stale', evidence: 'quiet' } })
      )
    ).toBe('work pipeline · stale · no pane');
    expect(rowSub(run({ status: 'abandoned', ended_at: TODAY(9) }))).toBe(
      'work pipeline · abandoned'
    );
  });

  it('marks a finished run rt still flags, as stale is marked', () => {
    const stranded = run({
      status: 'done',
      ended_at: TODAY(12),
      attention: { needs: true, reason: 'stranded', evidence: 'no MR' },
    });
    expect(rowSub(stranded)).toBe('work pipeline · stranded');
    expect(outcomeTile(stranded)).toEqual({
      tone: 'warn',
      icon: 'warning',
      layer: 'triangle-alert',
    });
    const failed = run({
      status: 'failed',
      ended_at: TODAY(12),
      attention: { needs: true, reason: 'failed', evidence: 'x' },
    });
    expect(rowSub(failed)).toBe('work pipeline · failed');
    expect(outcomeTile(failed).tone).toBe('bad');
  });

  it('picks an outcome glyph per ending', () => {
    expect(outcomeTile(merged('m', TODAY(8), TODAY(9)))).toEqual({
      tone: 'ok',
      icon: 'gitMerge',
      layer: 'git-merge',
    });
    expect(
      outcomeTile(
        run({ attention: { needs: true, reason: 'stale', evidence: 'quiet' } })
      ).icon
    ).toBe('circleSlash');
    expect(
      outcomeTile(run({ work_type: 'review', status: 'done', ended_at: 1 }))
        .icon
    ).toBe('messageSquare');
    expect(outcomeTile(run({ status: 'failed', ended_at: 1 })).tone).toBe(
      'bad'
    );
  });
});

describe('lanes', () => {
  it('reads the latest story field, the first of a tie', () => {
    const f = (key: string, at: number): RunFieldRow => ({
      key,
      value: `${key} value`,
      produced_by: 'implement',
      at,
    });
    expect(
      latestField([f('strategy', 2), f('plan', 2), f('commits', 3)])?.key
    ).toBe('strategy');
    expect(latestField([f('extra.task', 4)])).toBeNull();
  });

  it('names the MR a lane is working toward', () => {
    expect(laneMrLine(run({}), 'work')).toBe('no MR yet');
    expect(
      laneMrLine(
        run({
          outcome: {
            status: 'running',
            mr: { iid: 409, state: 'opened', url: null },
            ci: 'running',
          },
        }),
        'work'
      )
    ).toBe('!409 open · CI running');
    expect(laneMrLine(run({ work_type: 'watch-ci' }), 'utility')).toBeNull();
  });
});

describe('runsStats', () => {
  const runs = [
    run({ id: 'live-a', current_stage: 'implement', started_at: TODAY(13) }),
    run({ id: 'live-b', current_stage: 'watch-ci', started_at: TODAY(8) }),
    merged('m1', TODAY(11, 42), TODAY(14, 12)),
    merged('m2', TODAY(9, 19), TODAY(11, 2)),
    run({
      id: 'ab',
      status: 'abandoned',
      started_at: TODAY(7),
      ended_at: TODAY(7, 30),
    }),
    run({
      id: 'rev',
      work_type: 'review',
      pipeline: 'review',
      status: 'done',
      started_at: TODAY(9, 17),
      ended_at: TODAY(9, 40),
      outcome: {
        status: 'done',
        reviewed: { iid: 412, url: null, posted: 'approve' },
      },
    }),
    merged('y', YESTERDAY(13, 46), YESTERDAY(16, 51)),
  ];
  const gates = [
    gate({ id: 'mine', subject: 'run:live-a', openedAt: TODAY(16, 17) }),
    gate({ id: 'herd', subject: 'run:live-a', owner: 'herd:x' }),
    gate({
      id: 'board',
      subject: 'mr:acme/web!412',
      kind: 'review-post',
      origin: { runId: 'rev' } as GateRow['origin'],
    }),
    gate({ id: 'done', subject: 'run:live-a', status: 'answered' }),
  ];
  const { lanes } = splitRuns(runs, null);
  const stats = runsStats({ runs, gates, lanes, now: NOW });

  it('counts only my waiting run gates, with the oldest age', () => {
    expect(stats.waiting).toEqual({ count: 1, oldestMs: 6 * MIN });
  });

  it('counts the live lanes and their current stages', () => {
    expect(stats.live).toEqual({ count: 2, stages: ['implement', 'watch-ci'] });
  });

  it("splits today's finished runs into merged, abandoned and reviews posted", () => {
    expect(stats.finished).toEqual({
      count: 4,
      merged: 2,
      abandoned: 1,
      reviewsPosted: 1,
    });
  });

  it('takes the median over done work runs only', () => {
    expect(stats.median).toEqual({ ms: 2.5 * HOUR, runs: 3 });
  });

  it('takes the median over the last 30 done work runs', () => {
    const many = Array.from({ length: 31 }, (_, i) =>
      merged(
        `w${i}`,
        TODAY(0) - i * 2 * HOUR,
        TODAY(0) - i * 2 * HOUR + (i === 30 ? 10 * HOUR : HOUR)
      )
    );
    const m = runsStats({ runs: many, gates: [], lanes: [], now: NOW }).median;
    expect(m).toEqual({ ms: HOUR, runs: 30 });
  });

  it('counts a run merged today as finished today by its merge', () => {
    const lateMerge = run({
      id: 'late',
      status: 'done',
      started_at: YESTERDAY(20),
      ended_at: YESTERDAY(23, 50),
      outcome: {
        status: 'done',
        mr: { iid: 7, state: 'merged', url: null, mergedAt: TODAY(0, 20) },
      },
    });
    const s = runsStats({ runs: [lateMerge], gates: [], lanes: [], now: NOW });
    expect(s.finished).toMatchObject({ count: 1, merged: 1 });
    expect(dayGroups([lateMerge], NOW)[0]!.label).toBe('Today');
  });

  it('writes the cards', () => {
    expect(statCards(stats).map(c => [c.value, c.sub])).toEqual([
      ['1', '1 gate · 6m'],
      ['2', 'implement · watch-ci'],
      ['4', '2 merged · 1 abandoned · 1 review posted'],
      ['2h 30m', 'last 3 work runs'],
    ]);
    const empty = statCards(
      runsStats({ runs: [], gates: [], lanes: [], now: NOW })
    );
    expect(empty.map(c => [c.value, c.sub])).toEqual([
      ['0', 'nothing waiting'],
      ['0', 'nothing running'],
      ['0', 'none yet'],
      ['—', 'no finished work runs'],
    ]);
  });
});

describe('filterView', () => {
  const runs = [
    run({ id: 'banner' }),
    run({ id: 'lane' }),
    run({ id: 'board', work_type: 'review' }),
    merged('done', TODAY(8), TODAY(9)),
  ];
  const gates = [
    gate({ id: 'g', subject: 'run:banner' }),
    gate({
      id: 'post',
      subject: 'mr:acme/web!1',
      kind: 'review-post',
      origin: { runId: 'board' } as GateRow['origin'],
    }),
  ];
  const view = (filter: Parameters<typeof filterView>[0]['filter']) =>
    filterView({ filter, runs, gates, now: NOW });

  it('shows everything under All', () => {
    const v = view('all');
    expect(v.banner?.run.id).toBe('banner');
    expect(v.lanes?.map(r => r.id).sort()).toEqual(['board', 'lane']);
    expect(v.earlier?.map(r => r.id)).toEqual(['done']);
    expect(v.inBoard.has('board')).toBe(true);
  });

  it('shows the banner and the lanes under Live', () => {
    const v = view('live');
    expect(v.banner?.run.id).toBe('banner');
    expect(v.lanes).toHaveLength(2);
    expect(v.earlier).toBeNull();
  });

  it('shows only what waits on you under Waiting', () => {
    const v = view('waiting');
    expect(v.banner?.run.id).toBe('banner');
    expect(v.lanes?.map(r => r.id)).toEqual(['board']);
    expect(v.earlier).toEqual([]);
  });

  it('shows only earlier runs under Done', () => {
    const v = view('done');
    expect(v.banner).toBeNull();
    expect(v.lanes).toBeNull();
    expect(v.earlier?.map(r => r.id)).toEqual(['done']);
  });
});

describe('laneFacts', () => {
  const lane = run({
    id: 'l',
    current_stage: 'implement',
    started_at: TODAY(13, 38),
    agent: { status: 'working', pane: 'p1' },
    stages: [
      { name: 'provision', status: 'done', started_at: TODAY(13, 38) },
      { name: 'implement', status: 'running', started_at: TODAY(15, 48) },
    ],
  });
  const field = (key: string, at: number): RunFieldRow => ({
    key,
    value: key === 'pipeline-stages' ? 'provision implement ship' : 'v',
    produced_by: 'x',
    at,
  });
  const detail = {
    stages: lane.stages!.map(s => ({
      name: s.name,
      status: s.status,
      started_at: s.started_at,
      attempt: 1,
      ended_at: null,
      reason: null,
      detail_path: null,
    })),
    fields: [
      field('pipeline-stages', TODAY(13, 38)),
      field('approach', TODAY(13, 40)),
      field('strategy', TODAY(15, 49)),
    ],
    decisions: [],
  };

  it('reads the current stage, its latest field and the rail', () => {
    const f = laneFacts({ run: lane, detail, gates: [], now: NOW });
    expect(f.stage).toBe('implement');
    expect(f.elapsed).toBe('35m');
    expect(f.field).toBe('Strategy: v');
    expect(f.rail?.map(s => [s.name, s.status])).toEqual([
      ['provision', 'done'],
      ['implement', 'running'],
      ['ship', 'not-started'],
    ]);
    expect(f.liveness.label).toBe('agent working');
    expect(f.age).toBe('running 2h 45m');
    expect(f.focusPane).toBe('p1');
  });

  it('counts answered gates, never decision_count', () => {
    const answered = gate({
      status: 'answered',
      answer: { answers: {}, by: 'console', answeredAt: 1 },
    });
    const f = laneFacts({
      run: { ...lane, decision_count: 9 },
      detail,
      gates: [answered, gate({ id: 'open', owner: 'herd:x' })],
      now: NOW,
    });
    expect(f.decisions).toBe('1 decision');
  });

  it('falls back to the CI state, and draws no rail before the detail lands', () => {
    const f = laneFacts({
      run: { ...lane, outcome: { status: 'running', ci: 'running' } },
      detail: undefined,
      gates: [],
      now: NOW,
    });
    expect(f.field).toBe('CI running');
    expect(f.rail).toBeNull();
  });
});
