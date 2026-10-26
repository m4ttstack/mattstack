import { Text } from '@mattstack/app-kit/core';

import type {
  PayloadBlock,
  PayloadSegment,
} from '../../../server/blocksPayload';
import { GateContext } from '../../runs/GateContext';
import classes from './blocks.module.css';

export interface PropBoxProps {
  prop: PayloadBlock['props'][number];
  /** This prop's segments, in order: one per value for `add`, the winner for `replace`. */
  segments: PayloadSegment[];
  /** A segment's layer as the card names it. */
  layerName?: (label: string) => string;
}

const UNDER = /\/(?:attachments|skills)\/(.+)$/;

/** A prop at its marker: its name, merge and default, then each layer's
    value under the file it comes from. */
export function PropBox({
  prop,
  segments,
  layerName = label => label,
}: PropBoxProps) {
  const sourceOf = (segment: PayloadSegment, index: number) => {
    const value =
      prop.values.find(candidate => candidate.layer === segment.layer) ??
      prop.values[index];
    if (!value) return undefined;
    return UNDER.exec(value.path)?.[1] ?? value.binding;
  };
  const fallback = prop.default ? `default ${prop.default}` : '';

  return (
    <section
      className={classes.propBox}
      data-testid="prop-box"
      data-prop={prop.name}
    >
      <header className={classes.propHead}>
        <span className={classes.propName}>{prop.name}</span>
        <span className={classes.propMeta}>
          {[prop.merge, ...(fallback ? [fallback] : [])].join(' · ')}
        </span>
      </header>
      {segments.length === 0 ? (
        <Text c="dimmed" fz="sm">
          nothing passed
        </Text>
      ) : (
        segments.map((segment, index) => (
          <div
            key={`${segment.layer}-${index}`}
            className={classes.propCard}
            data-testid="prop-card"
            data-layer={segment.color}
          >
            <div className={classes.propCardHead}>
              <span className={classes.propLayer}>
                {layerName(segment.layer)}
              </span>
              <span className={classes.propBinding}>
                {sourceOf(segment, index)}
              </span>
            </div>
            <GateContext
              text={segment.text}
              fill
              className={classes.propValue}
            />
          </div>
        ))
      )}
    </section>
  );
}
