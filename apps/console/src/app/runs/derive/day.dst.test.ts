import type { RunSummary } from '@mattstack/rt-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dayAt, dayAxis, dayTimeline, runDetailKey, type DayRow } from './day';
import { dayGroups } from './lanes';

const ZONE = 'America/New_York';
let previous: string | undefined;

beforeAll(() => {
  previous = process.env.TZ;
  process.env.TZ = ZONE;
});

afterAll(() => {
  if (previous === undefined) delete process.env.TZ;
  else process.env.TZ = previous;
});

const at = (month: number, day: number, h: number, m = 0) =>
  new Date(2026, month - 1, day, h, m).getTime();

const row = (from: number, to: number): DayRow => ({
  run: { id: 'r' } as RunSummary,
  bars: [{ kind: 'done', from, to, stages: ['plan'], gates: [] }],
  sub: { text: '', waiting: false },
});

describe('dayAxis across a clock change', () => {
  it('reads the zone the test pins', () => {
    expect((dayAt('2026-11-02') - dayAt('2026-11-01')) / 3_600_000).toBe(25);
    expect((dayAt('2026-03-09') - dayAt('2026-03-08')) / 3_600_000).toBe(23);
  });

  it('keeps the working day at 8 AM to 6 PM wall clock on a 25-hour day', () => {
    const now = at(11, 3, 12);
    const axis = dayAxis([row(at(11, 1, 9), at(11, 1, 10))], '2026-11-01', now);
    expect(axis.from).toBe(at(11, 1, 8));
    expect(axis.to).toBe(at(11, 1, 18));
    expect(axis.ticks.map(t => t.layer)).toEqual([
      't8',
      't10',
      't12',
      't14',
      't16',
      't18',
    ]);
  });

  it('runs the night 6 PM to 8 AM wall clock across the spring change', () => {
    const now = at(3, 10, 12);
    const axis = dayAxis([], '2026-03-07', now, true);
    expect(axis.from).toBe(at(3, 7, 18));
    expect(axis.to).toBe(at(3, 8, 8));
  });

  it('counts the whole of a bar in the totals on both days', () => {
    for (const [key, month, day] of [
      ['2026-11-01', 11, 1],
      ['2026-03-08', 3, 8],
    ] as const) {
      const r = {
        id: 'r',
        repo: 'remote:acme%2Fweb',
        work_type: 'feature',
        pipeline: 'work',
        status: 'done',
        current_stage: null,
        spawned_by: null,
        started_at: at(month, day, 15),
        ended_at: at(month, day, 16, 30),
        pack_commits: null,
        pack_dirty: 0,
        attention: { needs: false, reason: null, evidence: '' },
        last_event_at: at(month, day, 16, 30),
        ticket: null,
        branch: null,
      } as RunSummary;
      const day1 = dayTimeline({
        runs: [r],
        details: new Map([
          [
            runDetailKey(r),
            {
              stages: [
                {
                  name: 'plan',
                  status: 'done',
                  attempt: 1,
                  started_at: r.started_at,
                  ended_at: r.ended_at,
                  reason: null,
                  detail_path: null,
                },
              ],
              decisions: [],
            },
          ],
        ]),
        gatesByRun: new Map(),
        key,
        now: at(month, day + 2, 12),
      });
      expect(day1.totals.work).toBe(90 * 60_000);
    }
  });
});

describe('dayGroups across a clock change', () => {
  it('labels the spring-forward day Yesterday in the hour after it', () => {
    const run = {
      id: 'y',
      started_at: at(3, 8, 11),
      ended_at: at(3, 8, 12),
    } as RunSummary;
    expect(dayGroups([run], at(3, 9, 0, 30))[0]!.label).toBe('Yesterday');
  });
});
