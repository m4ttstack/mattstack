import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Button, UnstyledButton } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import type {
  BlocksPayload,
  PayloadBlock,
  PayloadSegment,
} from '../../../server/blocksPayload';
import classes from './blocks.module.css';
import { MarkdownText } from './MarkdownText';
import { layerLabel } from './model/layers';
import { PropBox } from './PropBox';

export interface BlockTextProps {
  block: PayloadBlock;
  payload: BlocksPayload;
  /** `lg` is the reading size of a single block's own page. */
  size?: 'md' | 'lg';
}

type Prop = PayloadBlock['props'][number];

const FENCE = /```mermaid\n[\s\S]*?\n```/;

const markerKey = (prop: Prop) =>
  prop.marker
    ? prop.marker.line * 100000 + prop.marker.col
    : Number.MAX_SAFE_INTEGER;

const FENCE_BODY = /```mermaid\n([\s\S]*?)\n```/;

/** A block's Mermaid graph source; null when its text draws none. */
export const mermaidOf = (text: string) => FENCE_BODY.exec(text)?.[1] ?? null;

const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** A block's graph as one row: its size and its Mermaid source on demand;
    the rest of the row opens the flow. */
export function FlowRow({
  payload,
  blockId,
  onOpen,
}: {
  payload: BlocksPayload;
  blockId: string;
  onOpen?: (blockId: string) => void;
}) {
  const graph = payload.graphs.find(entry => entry.blockId === blockId);
  if (!graph) return null;
  const blocks = graph.nodes.filter(node => node.blockId).length;
  return (
    <div className={classes.flowRowWrap}>
      <div className={classes.flowRow} data-testid="flow-row">
        <UnstyledButton
          className={classes.flowRowOpen}
          onClick={() => onOpen?.(blockId)}
        >
          <Icon name="workflow" size={14} className={classes.flowRowIcon} />
          <span className={classes.flowRowName}>Diagram</span>
          <span className={classes.flowRowFacts}>
            {`${count(graph.nodes.length, 'step')} · ${count(blocks, 'block')} · how this block runs, step by step`}
          </span>
        </UnstyledButton>
        <span className={classes.flowRowGo} aria-hidden>
          Open the diagram
          <Icon name="chevronRight" size={13} />
        </span>
      </div>
    </div>
  );
}

/** A block's graph as a section head's button: its step count, opening it. */
export function DiagramButton({
  payload,
  blockId,
  onOpen,
}: {
  payload: BlocksPayload;
  blockId: string;
  onOpen: (blockId: string) => void;
}) {
  const graph = payload.graphs.find(entry => entry.blockId === blockId);
  if (!graph) return null;
  return (
    <Button
      variant="default"
      size="compact-sm"
      leftSection={<Icon name="workflow" size={13} />}
      onClick={() => onOpen(blockId)}
      data-testid="diagram-button"
    >
      {`Diagram · ${count(graph.nodes.length, 'step')}`}
    </Button>
  );
}

/** A block's text with each prop's values in bands at its marker. A Mermaid
    graph is left out: the flow row under the document opens it. */
export function BlockText({ block, payload, size = 'md' }: BlockTextProps) {
  const propOf = new Map(block.props.map(prop => [prop.name, prop]));
  const nameOf = (segment: PayloadSegment) =>
    layerLabel(payload, segment.color);
  const packs = payload.layers.map(layer => layer.name);
  const items: ReactNode[] = [];
  const placed = new Set<string>();

  const prose = (text: string, key: string) =>
    text
      .split(FENCE)
      .filter(part => part.trim())
      .map((part, index) => (
        <MarkdownText key={`${key}-${index}`} text={part} />
      ));

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
      items.push(
        <PropBox
          key={i}
          prop={prop}
          segments={group}
          layerName={nameOf}
          packs={packs}
        />
      );
    }
    i = j;
  }

  const unplaced = block.props
    .filter(prop => !placed.has(prop.name))
    .sort((a, b) => markerKey(a) - markerKey(b));
  for (const prop of unplaced) {
    items.push(
      <PropBox
        key={`p-${prop.name}`}
        prop={prop}
        segments={[]}
        layerName={nameOf}
      />
    );
  }

  return (
    <div
      className={classes.blockText}
      data-size={size}
      data-testid="block-text"
    >
      {items}
    </div>
  );
}
