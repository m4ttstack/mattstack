import classes from './refresh.module.css';

const HEAD = [24, 180, 80, 80, 80, 120, 80, 80, 80, 80];

/** Per row: the name bar, the stat bars' width, and the wide fourth (lines) bar. */
const ROWS: [name: number, cell: number, wide: number][] = [
  [120, 60, 120],
  [112, 77, 107],
  [104, 64, 94],
  [96, 51, 111],
  [88, 68, 98],
  [80, 55, 115],
];

const CELLS = 9;
const FADE_STEP = 0.13;

function Bar({ w, h, name }: { w: number; h: number; name: string }) {
  return (
    <span
      className={classes.skBar}
      data-parity={name}
      style={{ width: w, height: h }}
    />
  );
}

export function SkeletonStandings() {
  return (
    <section
      className={classes.skeleton}
      data-parity="Skeleton"
      aria-label="Loading standings"
      aria-busy="true"
    >
      <div className={classes.skHead} data-parity="Sk Head">
        {HEAD.map((w, i) => (
          <Bar key={i} w={w} h={8} name="sh" />
        ))}
      </div>
      {ROWS.map(([name, cell, wide], r) => (
        <div
          key={r}
          className={classes.skRow}
          data-parity={r < ROWS.length - 1 ? `Sk Row ${r}` : undefined}
          data-row={r}
          style={{ opacity: Math.round((1 - r * FADE_STEP) * 100) / 100 }}
        >
          <Bar w={24} h={8} name="n" />
          <span className={classes.skAvatar} data-parity="av" />
          <div className={classes.skName}>
            <Bar w={name} h={9} name="a" />
            <Bar w={80} h={7} name="b" />
          </div>
          {Array.from({ length: CELLS }, (_, c) => (
            <Bar key={c} w={c === 3 ? wide : cell} h={9} name="c" />
          ))}
        </div>
      ))}
    </section>
  );
}
