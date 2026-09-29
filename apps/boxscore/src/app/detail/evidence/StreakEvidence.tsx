import { useMemo, useState } from 'react';

import { formatNumber } from '../../../shared/metrics';
import { mergeDays, type MergeDay } from '../../model/evidence-shapes';
import { dayLabel } from '../../model/labels';
import { BandChart } from './BandChart';
import classes from './evidence.module.css';
import type { EvidenceProps } from './index';
import panels from './panels.module.css';
import { EmptyEvidence, EvHead } from './parts';

const STRIP_H = 64;
const DAY_GAP = 3;
const PX_PER_MERGE = 8;
const EMPTY_BAR = 3;
const AXIS_STEP_DAYS = 7;

const RUN_COLOR: Record<MergeDay['run'], string> = {
  longest: 'var(--tk-fill-gold)',
  current: 'var(--tk-fill-accent)',
  other: 'var(--tk-muted)',
  none: 'var(--tk-raised)',
};

const dayKey = (date: string): string =>
  `D ${Number(date.slice(5, 7))}-${Number(date.slice(8, 10))}`;

/** A run's days as the legend prints them: the month repeats only when it changes. */
function span(days: MergeDay[]): string {
  const first = days[0]!.date;
  const last = days.at(-1)!.date;
  if (first === last) return dayLabel(first);
  const end =
    first.slice(5, 7) === last.slice(5, 7)
      ? String(Number(last.slice(8, 10)))
      : dayLabel(last);
  return `${dayLabel(first)} – ${end}`;
}

/** Every week from the first day, then the last day, dropping a week mark that crowds it. */
function axisDays(days: MergeDay[]): MergeDay[] {
  const step =
    AXIS_STEP_DAYS * Math.max(1, Math.ceil(days.length / (AXIS_STEP_DAYS * 5)));
  const last = days.length - 1;
  const marks: number[] = [];
  for (let i = 0; i < last; i += step) if (last - i >= step / 2) marks.push(i);
  marks.push(last);
  return marks.map(i => days[i]!);
}

export function StreakEvidence({ ev, window }: EvidenceProps) {
  const [all, setAll] = useState(false);
  const days = useMemo(
    () => mergeDays(ev, window.start, window.end),
    [ev, window.start, window.end]
  );
  if (ev.rows.length === 0 || days.length === 0) return <EmptyEvidence />;
  const max = Math.max(1, ...days.map(d => d.count));
  const px = Math.min(PX_PER_MERGE, STRIP_H / max);
  const merged = days.filter(d => d.count > 0);
  const legend = (['longest', 'current', 'other'] as const).flatMap(run => {
    const inRun = days.filter(d => d.run === run);
    if (inRun.length === 0) return [];
    const label =
      run === 'longest'
        ? `Longest run, ${span(inRun)}`
        : run === 'current'
          ? `Current streak, ${span(inRun)}`
          : 'Other merge days';
    return [{ run, label }];
  });
  return (
    <>
      <EvHead
        title="Merge days"
        right={`${dayLabel(days[0]!.date)} – ${dayLabel(days.at(-1)!.date)}, MRs merged per day`}
      />
      <div className={`${classes.block} ${panels.timeline}`}>
        <BandChart
          bands={days.length}
          height={STRIP_H}
          gap={DAY_GAP}
          renderBand={i => {
            const d = days[i]!;
            return (
              <div className={panels.day} data-day={dayKey(d.date)}>
                <span
                  className={panels.dayBar}
                  data-parity="bar"
                  title={`${dayLabel(d.date)} · ${d.count} merged`}
                  style={{
                    height:
                      d.count > 0
                        ? Math.max(EMPTY_BAR, Math.round(d.count * px))
                        : EMPTY_BAR,
                    background: RUN_COLOR[d.run],
                  }}
                />
              </div>
            );
          }}
        />
        <div className={panels.axisLabels}>
          {axisDays(days).map(d => (
            <span
              key={d.date}
              className={`${classes.t} ${panels.axisLabel}`}
              data-parity="a"
            >
              {dayLabel(d.date)}
            </span>
          ))}
        </div>
        <div className={panels.streakLegend}>
          {legend.map(l => (
            <span key={l.run} className={panels.streakLg}>
              <span
                className={panels.streakSwatch}
                data-parity="sw"
                style={{ background: RUN_COLOR[l.run] }}
              />
              <span
                className={`${classes.t} ${panels.legendText}`}
                data-parity="l"
              >
                {l.label}
              </span>
            </span>
          ))}
        </div>
      </div>
      {all &&
        [...merged].reverse().map(d => (
          <div
            key={d.date}
            className={`${classes.band} ${panels.row}`}
            data-parity={`Day ${d.date}`}
          >
            <span
              className={`${classes.t} ${classes.num} ${panels.dayLabel}`}
              data-parity="dt"
            >
              {dayLabel(d.date)}
            </span>
            <span className={`${classes.t} ${panels.rowTitle}`} data-parity="n">
              {`${formatNumber(d.count)} ${d.count === 1 ? 'MR' : 'MRs'} merged`}
            </span>
          </div>
        ))}
      <div className={classes.evFooter} data-parity="Ev Footer">
        <span className={`${classes.t} ${classes.count}`} data-parity="c">
          {`${formatNumber(merged.length)} merge ${merged.length === 1 ? 'day' : 'days'} in the window`}
        </span>
        <button
          type="button"
          className={classes.showAll}
          onClick={() => setAll(!all)}
        >
          <span
            className={`${classes.t} ${classes.showAllLabel}`}
            data-parity="sa"
          >
            {all ? 'Show fewer' : 'Show all days'}
          </span>
        </button>
      </div>
    </>
  );
}
