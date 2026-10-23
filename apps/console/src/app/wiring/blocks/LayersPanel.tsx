import { useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../server/blocksPayload';
import classes from './blocks.module.css';
import { blockMap, blockStrip, layerLabel, lineTotals } from './model/layers';
import type { Fill, Square } from './model/layers';
import type { Zoom } from './model/zoom';

export interface LayersPanelProps {
  payload: BlocksPayload;
  zoom: Zoom;
}

const plural = (count: number) => `${count} ${count === 1 ? 'line' : 'lines'}`;

function fillLabel(payload: BlocksPayload, fill: Fill): string {
  if (fill === 'mattstack') return `${layerLabel(payload, 'mattstack')} only`;
  if (fill === 'both') {
    return `${layerLabel(payload, 'org')} + ${layerLabel(payload, 'team')}`;
  }
  return layerLabel(payload, fill);
}

function Chart({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <div className={classes.chart} role="group" aria-labelledby={headingId}>
      <h4 id={headingId} className={classes.chartTitle}>
        {title}
      </h4>
      {children}
    </div>
  );
}

function BlockMap({
  payload,
  scope,
}: {
  payload: BlocksPayload;
  scope: PayloadBlock | null;
}) {
  const { squares, legend } = blockMap(payload, scope);
  const sections = new Map<string, Square[]>();
  for (const square of squares) {
    sections.set(square.section, [
      ...(sections.get(square.section) ?? []),
      square,
    ]);
  }
  return (
    <Chart title="Where they add">
      {[...sections].map(([section, members]) => (
        <div key={section} className={classes.section}>
          <span className={classes.sectionTitle}>{section}</span>
          <div className={classes.squares}>
            {members.map(square => {
              const name = `${square.label}: ${fillLabel(payload, square.fill)}`;
              return (
                <span
                  key={square.id}
                  role="img"
                  aria-label={name}
                  title={name}
                  className={classes.square}
                  data-fill={square.fill}
                />
              );
            })}
          </div>
        </div>
      ))}
      <ul className={classes.legend}>
        {legend.map(entry => (
          <li
            key={entry.fill}
            className={classes.legendRow}
            data-testid="layers-map-legend-row"
          >
            <span
              className={classes.swatch}
              data-fill={entry.fill}
              aria-hidden
            />
            <span>{fillLabel(payload, entry.fill)}</span>
            <span className={classes.count}>{entry.count}</span>
          </li>
        ))}
      </ul>
    </Chart>
  );
}

function TextBar({
  payload,
  scope,
}: {
  payload: BlocksPayload;
  scope: PayloadBlock | null;
}) {
  const totals = lineTotals(payload, scope);
  const total = totals.reduce((sum, entry) => sum + entry.count, 0);
  const summary = totals
    .map(entry => `${entry.label} ${plural(entry.count)}`)
    .join(', ');
  return (
    <Chart title="How much text">
      <div className={classes.barRow}>
        <div
          className={classes.bar}
          role="img"
          aria-label={`How much text: ${summary}, ${plural(total)} in all`}
          data-testid="layers-bar"
        >
          {totals.map(entry => (
            <span
              key={entry.layer}
              className={classes.segment}
              style={{ flexGrow: entry.count }}
              title={`${entry.label}: ${plural(entry.count)}`}
              data-layer={entry.layer}
              data-testid="layers-bar-segment"
            />
          ))}
        </div>
        <span className={classes.total}>{plural(total)}</span>
      </div>
      <ul className={classes.legend}>
        {totals.map(entry => (
          <li key={entry.layer} className={classes.legendRow}>
            <span
              className={classes.swatch}
              data-fill={entry.layer}
              aria-hidden
            />
            <span>{entry.label}</span>
            <span className={classes.count}>{entry.count}</span>
          </li>
        ))}
      </ul>
    </Chart>
  );
}

function Strip({
  block,
  payload,
}: {
  block: PayloadBlock;
  payload: BlocksPayload;
}) {
  return (
    <Chart title="This block, top to bottom">
      <ol className={classes.strip}>
        {blockStrip(block, payload).map((entry, index) => (
          <li
            key={index}
            className={classes.stripRow}
            data-testid="layers-strip-row"
          >
            <span
              className={classes.stripBar}
              data-layer={entry.layer}
              style={{ '--strip-lines': entry.lines } as CSSProperties}
              aria-hidden
            />
            <span>{entry.label}</span>
            <span className={classes.count}>{entry.lines}</span>
          </li>
        ))}
      </ol>
    </Chart>
  );
}

/** At a single block the strip replaces the map and the bar. */
export function LayersPanel({ payload, zoom }: LayersPanelProps) {
  if (zoom.level === 'block') {
    return (
      <section className={classes.layers} aria-label="Layers">
        <Strip block={zoom.block} payload={payload} />
      </section>
    );
  }
  const scope = zoom.level === 'parent' ? zoom.block : null;
  return (
    <section className={classes.layers} aria-label="Layers">
      <BlockMap payload={payload} scope={scope} />
      <TextBar payload={payload} scope={scope} />
    </section>
  );
}
