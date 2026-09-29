import type { ReactNode } from 'react';

import { BarChart } from '@mattstack/app-kit/charts';
import classes from './charts.module.css';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}

/**
 * A full-height bar per band, so Recharts owns the band layout and each band
 * is drawn as one HTML box: the canvas nests a bin's count, bar and label in
 * that box, and only HTML boxes carry a measurable fill.
 */
export function BandChart({
  bands,
  height,
  gap,
  renderBand,
}: {
  bands: number;
  height: number;
  gap: number;
  renderBand: (index: number) => ReactNode;
}) {
  const data = Array.from({ length: bands }, (_, i) => ({ band: i, fill: 1 }));
  return (
    <div
      className={classes.bandBleed}
      style={{ height, margin: `0 ${-gap / 2}px` }}
    >
      <BarChart
        h={height}
        data={data}
        dataKey="band"
        series={[{ name: 'fill', color: 'var(--tk-muted)' }]}
        withXAxis={false}
        withYAxis={false}
        withTooltip={false}
        gridAxis="none"
        yAxisProps={{ domain: [0, 1] }}
        barChartProps={{
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
          barCategoryGap: gap / 2,
        }}
        barProps={{
          isAnimationActive: false,
          shape: ({ x, y, width, height: h, index }: Box) => (
            <foreignObject
              x={x}
              y={y}
              width={width}
              height={h}
              className={classes.fo}
            >
              {renderBand(index)}
            </foreignObject>
          ),
        }}
      />
    </div>
  );
}
