import type { RefreshPhase, RefreshProgress } from '../../shared/types';
import { stallNotice } from '../lib/progress';
import { Glyph } from '../ui/Glyph';
import classes from './refresh.module.css';

const PHASES: { phase: RefreshPhase; label: string }[] = [
  { phase: 'users', label: 'Roster' },
  { phase: 'mrs-list', label: 'Merge requests' },
  { phase: 'mrs-detail', label: 'MR details' },
  { phase: 'pipelines', label: 'Pipelines' },
  { phase: 'pushes', label: 'Pushes' },
  { phase: 'linear', label: 'Linear issues' },
  { phase: 'compute', label: 'Compute' },
];

type CellState = 'done' | 'active' | 'waiting';

const count = (p: RefreshProgress) => `${p.done} / ${p.total}`;

/** What a finished phase covered, from the last total it reported. */
function doneDetail(phase: RefreshPhase, p: RefreshProgress): string {
  const totals = p.totals ?? {};
  const units: Record<RefreshPhase, [number | undefined, string]> = {
    users: [totals.users, 'users'],
    'mrs-list': [
      p.phase === 'mrs-detail' ? p.total : totals['mrs-detail'],
      'MRs',
    ],
    'mrs-detail': [totals['mrs-detail'], 'MRs'],
    pipelines: [totals.pipelines, 'checked'],
    pushes: [totals.pushes, 'users'],
    linear: [totals.linear, 'tickets'],
    compute: [undefined, ''],
  };
  const [n, unit] = units[phase];
  if (n === undefined) return 'done';
  return n === 0 ? 'up to date' : `${n} ${unit}`;
}

function PhaseCell({
  label,
  state,
  detail,
  warn,
}: {
  label: string;
  state: CellState;
  detail: string;
  warn: boolean;
}) {
  const tone = warn ? 'var(--tk-text-warn)' : 'var(--tk-text-accent)';
  return (
    <div
      className={classes.phase}
      data-parity={state === 'active' ? `Phase ${label}` : undefined}
      data-phase={label}
      data-state={state}
      style={
        state === 'active'
          ? {
              background: warn
                ? 'var(--tk-card)'
                : 'var(--mantine-color-accent-light)',
            }
          : undefined
      }
    >
      <div className={classes.phTop}>
        {state === 'done' && (
          <Glyph
            name="circleCheck"
            size={14}
            color="var(--tk-text-ok)"
            parity="ok"
          />
        )}
        {state === 'active' && (
          <Glyph
            name="loaderCircle"
            size={14}
            color={tone}
            parity="run"
            className={classes.spin}
          />
        )}
        {state === 'waiting' && (
          <span className={classes.todo} data-parity="todo" />
        )}
        <span
          className={classes.phLabel}
          data-parity="l"
          style={
            state === 'active' ? { color: tone, fontWeight: 500 } : undefined
          }
        >
          {label}
        </span>
      </div>
      <span
        className={state === 'waiting' ? classes.phWaiting : classes.phDetail}
        data-parity="d"
        style={state === 'active' ? { color: 'var(--tk-text-1)' } : undefined}
      >
        {detail}
      </span>
    </div>
  );
}

export function RefreshStatus({
  progress,
  stalledMs,
  window,
  cold,
  onCancel,
}: {
  progress: RefreshProgress | null;
  /** How long the reading has held still, once that counts as a stall; null while it moves. */
  stalledMs: number | null;
  window: string;
  cold: boolean;
  onCancel: () => void;
}) {
  const warn = stalledMs !== null;
  const index = progress
    ? PHASES.findIndex(p => p.phase === progress.phase)
    : -1;
  const known = progress !== null && index >= 0;
  const determinate = progress !== null && progress.total > 0;
  const fraction = determinate ? progress.done / progress.total : 0;
  const overall = known ? (index + fraction) / PHASES.length : fraction;

  const stall = stalledMs === null ? null : stallNotice(stalledMs);
  const sub =
    stall ??
    (cold
      ? 'Nothing is stored for this window yet'
      : 'Showing the last good numbers until this finishes');

  const cells = PHASES.map(({ phase, label }, i) => {
    const state: CellState =
      !known || i > index ? 'waiting' : i < index ? 'done' : 'active';
    const detail =
      state === 'waiting'
        ? 'waiting'
        : state === 'done'
          ? doneDetail(phase, progress!)
          : determinate
            ? count(progress!)
            : 'working';
    return { label, state, detail };
  });
  if (progress && !known) {
    cells.push({
      label: progress.label || progress.phase,
      state: 'active',
      detail: determinate ? count(progress) : 'working',
    });
  }

  return (
    <section
      className={classes.status}
      data-parity="Refresh Status"
      data-tone={warn ? 'warn' : 'accent'}
      aria-label="Refresh progress"
    >
      <div className={classes.head}>
        <div className={classes.left}>
          {warn ? (
            <Glyph
              name="hourglass"
              size={16}
              color="var(--tk-text-warn)"
              parity="Spinner"
            />
          ) : (
            <Glyph
              name="loaderCircle"
              size={16}
              color="var(--tk-text-accent)"
              parity="Spinner"
              className={classes.spin}
            />
          )}
          <span className={classes.title} data-parity="RS Title">
            {cold ? 'Building' : 'Refreshing'} {window}
          </span>
          <span
            className={classes.sub}
            data-parity="RS Sub"
            style={warn ? { color: 'var(--tk-text-warn)' } : undefined}
            aria-live="polite"
          >
            {stall && stall.includes('cancel') ? (
              <StallCopy text={stall} onCancel={onCancel} />
            ) : (
              sub
            )}
          </span>
        </div>
        <div className={classes.right}>
          {known && (
            <span className={classes.step} data-parity="Step">
              Step {index + 1} of {PHASES.length}
            </span>
          )}
          {determinate && (
            <span className={classes.count} data-parity="Count">
              {count(progress)}
            </span>
          )}
        </div>
      </div>
      <div className={classes.track} data-parity="Overall Track">
        <div
          className={classes.bar}
          data-parity="Overall Bar"
          style={{ width: `${overall * 100}%` }}
        />
      </div>
      <div className={classes.phases}>
        {cells.map(c => (
          <PhaseCell key={c.label} {...c} warn={warn} />
        ))}
      </div>
    </section>
  );
}

/** The stall copy with its "cancel" as the button that does it. */
function StallCopy({ text, onCancel }: { text: string; onCancel: () => void }) {
  const at = text.indexOf('cancel');
  return (
    <>
      {text.slice(0, at)}
      <button type="button" className={classes.inlineCancel} onClick={onCancel}>
        cancel
      </button>
      {text.slice(at + 'cancel'.length)}
    </>
  );
}
