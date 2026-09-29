import { useMemo } from 'react';

import { Progress } from '@mattstack/app-kit/core';
import { formatNumber } from '../../../shared/metrics';
import { pipelinesByDay, type DayStatus } from '../../model/evidence-shapes';
import { dayLabel } from '../../model/labels';
import { useGrow, type Grow } from '../../ui/useGrow';
import classes from './evidence.module.css';
import type { EvidenceProps } from './index';
import panels from './panels.module.css';
import { EmptyEvidence, EvHead } from './parts';

const DAYS = 7;

type Status = 'success' | 'failed' | 'canceled' | 'running';

const STATUSES: { key: Status; label: string; color: string }[] = [
  { key: 'success', label: 'Success', color: 'var(--tk-fill-ok)' },
  { key: 'failed', label: 'Failed', color: 'var(--tk-fill-bad)' },
  { key: 'canceled', label: 'Canceled', color: 'var(--tk-muted)' },
  { key: 'running', label: 'Running', color: 'var(--tk-fill-accent)' },
];

const share = (n: number, total: number): number =>
  total > 0 ? Math.round((n / total) * 100) : 0;

/** Segments sit 2px apart, so each takes its share of the width left after the gaps. */
const segWidth = (fraction: number, segments: number): string =>
  `calc((100% - ${2 * (segments - 1)}px) * ${fraction})`;

const totalOf = (d: DayStatus): number =>
  d.success + d.failed + d.canceled + d.running;

function DayRow({
  day,
  max,
  grow,
}: {
  day: DayStatus;
  max: number;
  grow: Grow;
}) {
  const segs = STATUSES.filter(s => day[s.key] > 0);
  const total = totalOf(day);
  const label = dayLabel(day.date);
  return (
    <div
      className={`${classes.band} ${panels.dayRow}`}
      data-parity={`Day ${label}`}
    >
      <span
        className={`${classes.t} ${classes.num} ${panels.dayLabel}`}
        data-parity="d"
      >
        {label}
      </span>
      <div className={`${panels.mini} ${grow.className}`} style={grow.style}>
        {segs.map(s => (
          <span
            key={s.key}
            className={panels.miniSeg}
            data-parity="s"
            style={{
              width: segWidth(day[s.key] / max, segs.length),
              background: s.color,
            }}
          />
        ))}
      </div>
      <span
        className={`${classes.t} ${classes.num} ${panels.dayTotal}`}
        data-parity="t"
        style={{
          color: day.failed > 0 ? 'var(--tk-text-bad)' : 'var(--tk-text-3)',
        }}
      >
        {day.failed > 0
          ? `${formatNumber(total)} · ${formatNumber(day.failed)} failed`
          : formatNumber(total)}
      </span>
    </div>
  );
}

export function PipelinesEvidence({ ev }: EvidenceProps) {
  const days = useMemo(() => pipelinesByDay(ev, DAYS), [ev]);
  const grow = useGrow();
  if (ev.rows.length === 0) return <EmptyEvidence />;
  const counts = Object.fromEntries(
    STATUSES.map(s => [s.key, ev.facts?.[s.key] ?? 0])
  ) as Record<Status, number>;
  const total = STATUSES.reduce((sum, s) => sum + counts[s.key], 0);
  const segs = STATUSES.filter(s => counts[s.key] > 0);
  const max = Math.max(1, ...days.map(totalOf));
  const outcomes = grow('x');
  return (
    <>
      <EvHead
        title="Outcomes"
        right={`${share(counts.success, total)}% succeeded`}
      />
      <div className={`${classes.block} ${panels.status}`}>
        <Progress.Root
          size={12}
          radius={3}
          className={`${panels.stacked} ${outcomes.className}`}
          style={outcomes.style}
        >
          {segs.map(s => (
            <Progress.Section
              key={s.key}
              value={share(counts[s.key], total)}
              color={s.color}
              className={panels.seg}
              data-parity={`Seg ${s.label}`}
              style={{
                width: segWidth(counts[s.key] / total, segs.length),
              }}
            />
          ))}
        </Progress.Root>
        <div className={panels.statusLegend} role="list">
          {STATUSES.map(s => (
            <div key={s.key} className={panels.lg} role="listitem">
              <span
                className={panels.sw}
                data-parity="sw"
                style={{ background: s.color }}
              />
              <span
                className={`${classes.t} ${panels.lgLabel}`}
                data-parity="l"
              >
                {s.label}
              </span>
              <span
                className={`${classes.t} ${classes.num} ${panels.lgCount}`}
                data-parity="n"
              >
                {formatNumber(counts[s.key])}
              </span>
              <span
                className={`${classes.t} ${classes.num} ${panels.lgShare}`}
                data-parity="p"
              >
                {`${share(counts[s.key], total)}%`}
              </span>
            </div>
          ))}
        </div>
      </div>
      <EvHead title="By day" right={`last ${DAYS} days with pipelines`} />
      {days.map((d, i) => (
        <DayRow key={d.date} day={d} max={max} grow={grow('x', i + 1)} />
      ))}
    </>
  );
}
