import classes from './ui.module.css';

const AXIS = 360;
const DOT = 10;
const YOU_DOT = 16;
const LINE_CENTRE = 11;

export interface StripPoint {
  username: string;
  value: number;
  you: boolean;
  leader: boolean;
  initials?: string;
}

// Every dot's centre runs over the axis less one small dot, so a max-value dot ends flush with the line.
function dotBox(value: number, max: number, size: number) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const centre = DOT / 2 + fraction * (AXIS - DOT);
  return { left: centre - size / 2, top: LINE_CENTRE - size / 2 };
}

export function TeamStrip({
  points,
  max,
  maxLabel,
  parity,
}: {
  points: StripPoint[];
  max: number;
  maxLabel: string;
  parity?: string;
}) {
  return (
    <div className={classes.strip} data-parity={parity}>
      <div className={classes.axis}>
        <div className={classes.axisLine} data-parity="Axis Line" />
        {points.map(p => {
          const size = p.you ? YOU_DOT : DOT;
          const { left, top } = dotBox(p.value, max, size);
          const background = p.you
            ? 'var(--tk-fill-accent)'
            : p.leader
              ? 'var(--tk-fill-gold)'
              : 'var(--tk-muted)';
          const initials = p.initials ?? p.username.slice(0, 2).toUpperCase();
          return (
            <div
              key={p.username}
              className={classes.dot}
              data-parity={`Dot ${initials}`}
              style={{ width: size, height: size, left, top, background }}
            />
          );
        })}
      </div>
      <div className={`${classes.num} ${classes.scale}`}>
        <span className={classes.text} data-parity="s0">
          0
        </span>
        <span className={classes.text} data-parity="s1">
          {maxLabel}
        </span>
      </div>
    </div>
  );
}
