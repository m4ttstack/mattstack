import '@xyflow/react/dist/base.css';

import { useRef, type RefCallback, type RefObject } from 'react';
import {
  Box,
  SegmentedControl,
  Skeleton,
  Text,
  UnstyledButton,
  useComputedColorScheme,
} from '@mattstack/app-kit/core';
import { useElementSize, useMergedRef } from '@mattstack/app-kit/hooks';
import {
  Background,
  BackgroundVariant,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';

import type { BlockGraphSelect } from '../graph/useWiringUrl';
import classes from './blocks.module.css';
import { MAP_EDGE_TYPES, type MapFlowEdge } from './graphEdges';
import type { LaidOut, LayoutEngine, LayoutInput } from './model/elkGraph';
import { canvasPlane, MIN_MAP_ZOOM } from './model/mapLayout';
import { useGraphLayout } from './useGraphLayout';

export const handlesAt = (anchorX: number, height: number) => [
  {
    type: 'target' as const,
    position: Position.Top,
    x: anchorX,
    y: 0,
    width: 1,
    height: 1,
  },
  {
    type: 'source' as const,
    position: Position.Bottom,
    x: anchorX,
    y: height,
    width: 1,
    height: 1,
  },
];

type CanvasEdge = {
  id: string;
  from: string;
  to: string;
  label: string | null;
  folded?: boolean;
  arrow?: boolean;
};

/** A layout's edges as React Flow draws them along ELK's routes. */
export function edgesOf(
  edges: readonly CanvasEdge[],
  laidOut: LaidOut
): MapFlowEdge[] {
  return edges.flatMap((edge): MapFlowEdge[] => {
    const routed = laidOut.edges[edge.id];
    if (!routed) return [];
    return [
      {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'map',
        data: {
          points: routed.points,
          folded: edge.folded ?? false,
          arrow: edge.arrow ?? true,
          label: edge.label,
          labelBox: routed.label,
        },
      },
    ];
  });
}

/** Each layout by the ELK input built from it, so the canvas keeps drawing
    the last finished layout while a newer one runs. */
const layoutOf = new WeakMap<LayoutInput, unknown>();

/** Lays `layout` out, and gives back the newest layout that has finished. */
export function useCanvasLayout<T extends { input: LayoutInput }>(
  layout: T | null,
  engine?: () => Promise<LayoutEngine>
) {
  if (layout) layoutOf.set(layout.input, layout);
  const { state, laidOut, laidFor, retry } = useGraphLayout(
    layout?.input ?? null,
    engine
  );
  const shown = laidFor ? (layoutOf.get(laidFor) as T | undefined) : undefined;
  return { state, laidOut, shown, retry };
}

export type CanvasPlane = {
  ref: RefCallback<HTMLDivElement>;
  element: RefObject<HTMLDivElement | null>;
  /** The scroller's measured width. */
  width: number;
  zoom: number;
  plane: number;
  offset: number;
};

/** The scroller's size and the plane a map `mapWidth` wide draws on in it. */
export function useCanvasPlane(mapWidth: number): CanvasPlane {
  const { ref: sized, width } = useElementSize<HTMLDivElement>();
  const element = useRef<HTMLDivElement | null>(null);
  const ref = useMergedRef(sized, element);
  return { ref, element, width, ...canvasPlane(width, mapWidth) };
}

export interface GraphCanvasProps {
  canvas: CanvasPlane;
  laidOut: LaidOut;
  nodes: Node[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  testId: string;
  /** A modifier class on the scroller. */
  className?: string;
}

// The frame draws the border, so the scroller inside it measures exactly the
// room the plane has.
export function GraphCanvas({
  canvas: { ref, zoom, plane, offset },
  laidOut,
  nodes,
  edges,
  nodeTypes,
  testId,
  className,
}: GraphCanvasProps) {
  const scheme = useComputedColorScheme('light');
  return (
    <div className={classes.graphFrame}>
      <div
        ref={ref}
        className={
          className
            ? `${classes.graphCanvas} ${className}`
            : classes.graphCanvas
        }
        data-testid={testId}
        data-zoom={zoom}
      >
        <Box
          className={classes.mapPlane}
          w={plane > 0 ? plane : '100%'}
          data-plane={plane}
          h={Math.ceil(laidOut.height * zoom)}
        >
          <ReactFlow
            key={`${plane}:${zoom}`}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={MAP_EDGE_TYPES}
            defaultViewport={{ x: offset, y: 0, zoom }}
            minZoom={MIN_MAP_ZOOM}
            maxZoom={1}
            panOnDrag={false}
            panOnScroll={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
            colorMode={scheme}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1}
              color="var(--tk-line-2)"
              bgColor="var(--tk-panel)"
            />
          </ReactFlow>
        </Box>
      </div>
    </div>
  );
}

export function GraphLoading({
  height,
  testId,
  label,
}: {
  height: number;
  testId: string;
  label: string;
}) {
  return (
    <Skeleton h={height} radius={12} data-testid={testId} aria-label={label} />
  );
}

export function GraphError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={classes.mapNote} role="alert">
      <Text fz={13} c="dimmed">
        The graph didn&apos;t lay out
      </Text>
      <UnstyledButton className={classes.graphLink} onClick={onRetry}>
        Retry
      </UnstyledButton>
    </div>
  );
}

const GRAPH_VIEWS: { value: BlockGraphSelect; label: string }[] = [
  { value: 'graph', label: 'Blocks' },
  { value: 'graph-steps', label: 'Every step' },
];

/** Blocks | Every step: the block map or the whole graph. */
export function GraphViews({
  value,
  onChange,
}: {
  value: BlockGraphSelect;
  onChange: (value: BlockGraphSelect) => void;
}) {
  return (
    <SegmentedControl
      size="xs"
      aria-label="Graph view"
      data={GRAPH_VIEWS}
      value={value}
      onChange={next => onChange(next as BlockGraphSelect)}
    />
  );
}

/** A whole-graph view's title row: its name, its counts, the view switch
    and Close. */
export function GraphHead({
  title,
  count,
  view,
  onView,
  onClose,
}: {
  title: string;
  count: string;
  view: BlockGraphSelect;
  onView: (view: BlockGraphSelect) => void;
  onClose: () => void;
}) {
  return (
    <div className={classes.mapHead}>
      <Text fz={15} fw={600} lh="normal" c="var(--tk-text-1)">
        {title}
      </Text>
      <Text fz={13} lh="normal" c="dimmed">
        {count}
      </Text>
      <div className={classes.mapTools}>
        <GraphViews value={view} onChange={onView} />
        <UnstyledButton className={classes.mapClose} onClick={onClose}>
          Close
        </UnstyledButton>
      </div>
    </div>
  );
}
