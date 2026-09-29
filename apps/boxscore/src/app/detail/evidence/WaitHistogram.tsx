import { BarChart } from '@mattstack/app-kit/charts';
import type { Bin } from '../../model/evidence-shapes';
import classes from './charts.module.css';

const CHART_H = 144;
const PLOT_H = 110;
const GAP = 6;
/** The bin label's line box at 11px; the axis reserves it below the gap. */
const LABEL_H = 13;
const AXIS_H = GAP + LABEL_H;
const MIN_BAR = 2;
/** Half the 10px gap between bins: Recharts insets both sides of every band. */
const BAND_INSET = 5;
const LABEL_BOX = 20;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whole-pixel heights, and zero-count bins still draw a 2px sliver, as the canvas does. */
function barBox({ x, y, width, height }: Box): Box {
  const h = Math.max(MIN_BAR, Math.round(height));
  return { x, y: y + height - h, width, height: h };
}

/**
 * The canvas draws bins as HTML boxes, so each mark is an HTML element in a
 * foreignObject: that keeps the bar's fill and the labels' text measurable.
 */
export function WaitHistogram({ bins }: { bins: Bin[] }) {
  const max = Math.max(1, ...bins.map(b => b.count));
  const data = bins.map(b => ({ label: b.label, count: b.count }));
  return (
    <div className={classes.histogram}>
      <div className={classes.bleed}>
        <BarChart
          h={CHART_H}
          data={data}
          dataKey="label"
          series={[{ name: 'count', color: 'var(--tk-muted)' }]}
          withYAxis={false}
          withTooltip={false}
          gridAxis="none"
          withBarValueLabel
          yAxisProps={{ domain: [0, max] }}
          xAxisProps={{
            height: AXIS_H,
            interval: 0,
            axisLine: false,
            tickLine: false,
            tick: ({
              x,
              payload,
            }: {
              x: number | string;
              payload: { index: number };
            }) => {
              const bin = bins[payload.index]!;
              return (
                <foreignObject
                  x={Number(x) - 60}
                  y={CHART_H - AXIS_H + GAP}
                  width={120}
                  height={LABEL_H}
                  className={classes.fo}
                >
                  <div className={classes.labelBox}>
                    <span
                      className={classes.binLabel}
                      data-parity="l"
                      style={{
                        color: bin.highlight
                          ? 'var(--tk-text-accent)'
                          : 'var(--tk-text-3)',
                      }}
                    >
                      {bin.label}
                    </span>
                  </div>
                </foreignObject>
              );
            },
          }}
          barChartProps={{
            margin: {
              top: CHART_H - PLOT_H - AXIS_H,
              right: 0,
              bottom: 0,
              left: 0,
            },
            barCategoryGap: BAND_INSET,
          }}
          barProps={{
            shape: (props: Box & { index: number }) => {
              const b = barBox(props);
              return (
                <foreignObject {...b} className={classes.fo}>
                  <div
                    className={classes.bar}
                    data-parity="bar"
                    style={{
                      background: bins[props.index]?.highlight
                        ? 'var(--tk-fill-accent)'
                        : 'var(--tk-muted)',
                    }}
                  />
                </foreignObject>
              );
            },
          }}
          valueLabelProps={{
            content: ({
              viewBox,
              value,
            }: {
              viewBox?: unknown;
              value?: unknown;
            }) => {
              if (!viewBox) return null;
              const b = barBox(viewBox as Box);
              return (
                <foreignObject
                  x={b.x}
                  y={b.y - GAP - LABEL_BOX}
                  width={b.width}
                  height={LABEL_BOX}
                  className={classes.fo}
                >
                  <div className={classes.countBox}>
                    <span className={classes.count} data-parity="cnt">
                      {String(value)}
                    </span>
                  </div>
                </foreignObject>
              );
            },
          }}
        />
      </div>
    </div>
  );
}
