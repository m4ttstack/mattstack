import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { UnstyledButton } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import type {
  BlocksPayload,
  PayloadBlock,
  PayloadSegment,
} from '../../../server/blocksPayload';
import { GateContext } from '../../runs/GateContext';
import classes from './blocks.module.css';
import { PropBox } from './PropBox';

export interface BlockTextProps {
  block: PayloadBlock;
  payload: BlocksPayload;
  level: 'parent' | 'block';
  onViewGraph?: (blockId: string) => void;
}

type Prop = PayloadBlock['props'][number];

const FENCE = /```mermaid\n[\s\S]*?\n```/;

const markerKey = (prop: Prop) =>
  prop.marker
    ? prop.marker.line * 100000 + prop.marker.col
    : Number.MAX_SAFE_INTEGER;

function GraphCard({
  payload,
  blockId,
  onViewGraph,
}: {
  payload: BlocksPayload;
  blockId: string;
  onViewGraph?: (blockId: string) => void;
}) {
  const graph = payload.graphs.find(entry => entry.blockId === blockId);
  if (!graph) return null;
  return (
    <div className={classes.graphCard} data-testid="graph-card">
      <span className={classes.graphTitle}>
        <Icon name="workflow" size={14} />
        <span className={classes.graphName}>Graph</span>
        <span>{`${graph.nodes.length} steps · ${graph.edges.length} links`}</span>
      </span>
      <UnstyledButton
        className={classes.graphLink}
        onClick={() => onViewGraph?.(blockId)}
      >
        View graph
      </UnstyledButton>
    </div>
  );
}

export function BlockText({
  block,
  payload,
  level,
  onViewGraph,
}: BlockTextProps) {
  const propOf = new Map(block.props.map(prop => [prop.name, prop]));
  const items: ReactNode[] = [];
  const placed = new Set<string>();

  const prose = (text: string, key: string) => {
    const [before, ...rest] = text.split(FENCE);
    const parts: ReactNode[] = [];
    if (before.trim())
      parts.push(
        <GateContext key={`${key}-a`} text={before} fill breaks={false} />
      );
    if (rest.length > 0) {
      if (level === 'parent') {
        parts.push(
          <GraphCard
            key={`${key}-g`}
            payload={payload}
            blockId={block.id}
            onViewGraph={onViewGraph}
          />
        );
      }
      const after = rest.join('');
      if (after.trim())
        parts.push(
          <GateContext key={`${key}-b`} text={after} fill breaks={false} />
        );
    }
    return parts;
  };

  for (let i = 0; i < block.segments.length;) {
    const segment = block.segments[i];
    if (segment.prop === null) {
      items.push(<Fragment key={i}>{prose(segment.text, String(i))}</Fragment>);
      i += 1;
      continue;
    }
    const group: PayloadSegment[] = [];
    let j = i;
    while (
      j < block.segments.length &&
      block.segments[j].prop === segment.prop
    ) {
      group.push(block.segments[j]);
      j += 1;
    }
    const prop = propOf.get(segment.prop);
    if (prop) {
      placed.add(prop.name);
      items.push(<PropBox key={i} prop={prop} segments={group} />);
    }
    i = j;
  }

  const unplaced = block.props
    .filter(prop => !placed.has(prop.name))
    .sort((a, b) => markerKey(a) - markerKey(b));
  for (const prop of unplaced) {
    items.push(<PropBox key={`p-${prop.name}`} prop={prop} segments={[]} />);
  }

  return (
    <div className={classes.blockText} data-testid="block-text">
      {items}
    </div>
  );
}
