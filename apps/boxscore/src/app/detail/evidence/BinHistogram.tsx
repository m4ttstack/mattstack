import { BandChart } from './BandChart';
import classes from './charts.module.css';

export interface HistBin {
  /** The bin's own label, which names its layer. */
  name: string;
  label: string;
  count: number;
  bar: string;
  labelColor: string;
  background?: string;
}

const BIN_GAP = 10;
const MIN_BAR = 2;

/** The tallest bin fills `maxBar`; an empty bin keeps a 2px sliver, as the canvas draws it. */
export function BinHistogram({
  bins,
  plotHeight,
  maxBar,
  inset = 0,
}: {
  bins: HistBin[];
  plotHeight: number;
  maxBar: number;
  inset?: number;
}) {
  const max = Math.max(1, ...bins.map(b => b.count));
  return (
    <div className={classes.binBlock}>
      <BandChart
        bands={bins.length}
        height={plotHeight}
        gap={BIN_GAP}
        renderBand={i => {
          const b = bins[i]!;
          const h = Math.max(MIN_BAR, Math.round((b.count / max) * maxBar));
          return (
            <div
              className={classes.bin}
              data-parity={b.background ? `Bin ${b.name}` : undefined}
              style={{
                background: b.background,
                padding: inset ? `0 ${inset}px ${inset}px` : undefined,
              }}
            >
              <span className={classes.count} data-parity="cnt">
                {b.count}
              </span>
              <span
                className={classes.bar}
                data-parity="bar"
                style={{ height: h, background: b.bar }}
              />
              <span
                className={classes.binLabel}
                data-parity="l"
                style={{ color: b.labelColor }}
              >
                {b.label}
              </span>
            </div>
          );
        }}
      />
    </div>
  );
}
