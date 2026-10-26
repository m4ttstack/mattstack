import { useMemo } from 'react';
import { Text, UnstyledButton } from '@mattstack/app-kit/core';

import type { BlocksPayload } from '../../../server/blocksPayload';
import classes from './blocks.module.css';
import { FlowGraph } from './FlowGraph';
import { aroundBlock, aroundOrder } from './model/around';
import { flowOrder } from './model/blockMap';
import type { LayoutEngine } from './model/elkGraph';

export interface AroundGraphProps {
  graph: BlocksPayload['graphs'][number];
  /** The block's own node id in `graph`. */
  focus: string;
  /** The blocks the graph's nodes open, for their badges and dots. */
  payload?: BlocksPayload;
  /** The skill in view, which graph-only labels need not repeat. */
  skill?: string;
  onSelect: (blockId: string) => void;
  onViewWholeGraph: () => void;
  engine?: () => Promise<LayoutEngine>;
}

/** The block's neighbourhood: one hop in and out, and short cycles back. */
export function AroundGraph({
  graph,
  focus,
  payload,
  skill,
  onSelect,
  onViewWholeGraph,
  engine,
}: AroundGraphProps) {
  const { sub, order } = useMemo(() => {
    const around = aroundBlock(graph, focus);
    return {
      sub: around,
      order: aroundOrder(around, focus, flowOrder(graph)),
    };
  }, [graph, focus]);
  return (
    <section
      className={classes.around}
      aria-label="Around this block"
      data-testid="around-graph"
    >
      <div className={classes.aroundHead}>
        <Text fz={11} fw={500} lh="normal" tt="uppercase" c="dimmed">
          Around this block
        </Text>
        <UnstyledButton
          className={classes.graphLink}
          onClick={onViewWholeGraph}
        >
          View whole graph
        </UnstyledButton>
      </div>
      <FlowGraph
        graph={sub}
        payload={payload}
        skill={skill}
        focus={focus}
        order={order}
        onSelect={onSelect}
        engine={engine}
        loadingHeight={240}
      />
    </section>
  );
}
