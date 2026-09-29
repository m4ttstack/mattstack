import { useState } from 'react';

import { Progress } from '@mattstack/app-kit/core';
import { formatNumber } from '../../../shared/metrics';
import { useGrow } from '../../ui/useGrow';
import classes from './evidence.module.css';
import type { EvidenceProps } from './index';
import panels from './panels.module.css';
import { EmptyEvidence, EvFooter, EvHead } from './parts';

const FIRST_ROWS = 7;

function Meter({
  value,
  max,
  size,
  radius,
  color,
  index,
}: {
  value: number;
  max: number;
  size: number;
  radius: number;
  color: string;
  index: number;
}) {
  const percent = max > 0 ? Math.min(1, value / max) * 100 : 0;
  const g = useGrow()('x', index);
  return (
    <Progress.Root
      size={size}
      radius={radius}
      className={panels.track}
      data-parity="Track"
    >
      {percent > 0 && (
        <Progress.Section
          value={percent}
          color={color}
          className={g.className}
          style={{ ...g.style, borderRadius: radius }}
          data-parity="Bar"
        />
      )}
    </Progress.Root>
  );
}

function Balance({
  label,
  value,
  max,
  color,
  index,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  index: number;
}) {
  return (
    <div className={panels.bal} role="group" aria-label={label}>
      <span className={`${classes.t} ${panels.balLabel}`} data-parity="l">
        {label}
      </span>
      <Meter
        value={value}
        max={max}
        size={10}
        radius={3}
        color={color}
        index={index}
      />
      <span
        className={`${classes.t} ${classes.num} ${panels.balValue}`}
        data-parity="n"
      >
        {formatNumber(value)}
      </span>
    </div>
  );
}

export function ReciprocityEvidence({ ev }: EvidenceProps) {
  const [all, setAll] = useState(false);
  const given = ev.facts?.given ?? 0;
  const reviewers = ev.rows.map(r => ({
    name: r.cells[0] ?? '',
    count: Number(r.cells[1]) || 0,
  }));
  const received = ev.facts?.reviewers ?? reviewers.length;
  const top = Math.max(0, ...reviewers.map(r => r.count));
  const shown = all ? reviewers : reviewers.slice(0, FIRST_ROWS);
  const total = reviewers.length;
  return (
    <>
      <EvHead
        title="Give and take"
        right="reviews you gave against reviews on your MRs"
      />
      <div className={`${classes.block} ${panels.balance}`}>
        <Balance
          label="Given"
          value={given}
          max={Math.max(given, received)}
          color="var(--tk-text-purple)"
          index={0}
        />
        <Balance
          label="Received"
          value={received}
          max={Math.max(given, received)}
          color="var(--tk-muted)"
          index={1}
        />
      </div>
      <EvHead
        title="Who reviews your MRs"
        right={`${formatNumber(total)} ${total === 1 ? 'reviewer' : 'reviewers'}`}
      />
      {total === 0 && <EmptyEvidence />}
      {shown.map((r, i) => (
        <div
          key={r.name}
          className={`${classes.band} ${panels.revRow}`}
          data-parity={`Rev ${r.name}`}
        >
          <span className={panels.avatar} data-parity="Av">
            <span className={`${classes.t} ${panels.initials}`} data-parity="i">
              {r.name.slice(0, 2).toUpperCase()}
            </span>
          </span>
          <span className={`${classes.t} ${panels.handle}`} data-parity="u">
            {`@${r.name}`}
          </span>
          <Meter
            value={r.count}
            max={top}
            size={4}
            radius={2}
            color="var(--tk-muted)"
            index={i}
          />
          <span
            className={`${classes.t} ${classes.num} ${panels.revValue}`}
            data-parity="n"
          >
            {`${formatNumber(r.count)} ${r.count === 1 ? 'MR' : 'MRs'}`}
          </span>
        </div>
      ))}
      {total > 0 && (
        <EvFooter
          count={`Showing ${shown.length} of ${total}`}
          total={total}
          all={all}
          onToggle={total > FIRST_ROWS ? () => setAll(!all) : undefined}
        />
      )}
    </>
  );
}
