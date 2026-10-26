import '@xyflow/react/dist/base.css';

import {
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefCallback,
  type RefObject,
} from 'react';
import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  SegmentedControl,
  Skeleton,
  Text,
  Title,
  UnstyledButton,
  useComputedColorScheme,
} from '@mattstack/app-kit/core';
import { useElementSize, useMergedRef } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
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
  /** The plane's height and the map's offset down from its top. */
  planeHeight: number;
  offsetY: number;
  /** Set on a canvas framed to the page: its zoom steps and fit. */
  fill: {
    zoomIn: () => void;
    zoomOut: () => void;
    fit: () => void;
  } | null;
};

/** The smallest zoom a framed map fits down to; past it, the map pans. */
const MIN_FIT_ZOOM = 0.85;
const ZOOM_STEP = 1.2;
/** Room a framed map leaves round its edges: the zoom buttons and key sit
    over its bottom one. */
const FRAME_PAD = { x: 24, top: 24, bottom: 64 };

/** The scroller's size and the plane a map `mapWidth` wide draws on in it.
    A framed canvas (`fill`) fits the whole map to its frame instead of its
    width alone, and zooms in steps from there. */
export function useCanvasPlane(
  mapWidth: number,
  mapHeight = 0,
  fill = false
): CanvasPlane {
  const { ref: sized, width, height } = useElementSize<HTMLDivElement>();
  const element = useRef<HTMLDivElement | null>(null);
  const ref = useMergedRef(sized, element);
  const [scale, setScale] = useState(1);
  if (!fill) {
    const plane = canvasPlane(width, mapWidth);
    return {
      ref,
      element,
      width,
      ...plane,
      planeHeight: Math.ceil(mapHeight * plane.zoom),
      offsetY: 0,
      fill: null,
    };
  }
  const room = { w: Math.floor(width), h: Math.floor(height) };
  const fit =
    room.w > 0 && room.h > 0 && mapWidth > 0 && mapHeight > 0
      ? Math.max(
          MIN_FIT_ZOOM,
          Math.min(
            1,
            (room.w - FRAME_PAD.x * 2) / mapWidth,
            (room.h - FRAME_PAD.top - FRAME_PAD.bottom) / mapHeight
          )
        )
      : 1;
  const zoom = Math.min(2, Math.max(0.25, fit * scale));
  const drawn = { w: mapWidth * zoom, h: mapHeight * zoom };
  const plane = Math.max(room.w, Math.ceil(drawn.w + FRAME_PAD.x * 2));
  const planeHeight = Math.max(
    room.h,
    Math.ceil(drawn.h + FRAME_PAD.top + FRAME_PAD.bottom)
  );
  const spare = planeHeight - drawn.h - FRAME_PAD.top - FRAME_PAD.bottom;
  return {
    ref,
    element,
    width,
    zoom,
    plane,
    offset: (plane - drawn.w) / 2,
    planeHeight,
    offsetY: FRAME_PAD.top + spare / 2,
    fill: {
      zoomIn: () => setScale(now => now * ZOOM_STEP),
      zoomOut: () => setScale(now => now / ZOOM_STEP),
      fit: () => setScale(1),
    },
  };
}

/** Drags the scroller by its background, so a framed map pans by hand. */
function usePan(element: RefObject<HTMLDivElement | null>, on: boolean) {
  const drag = useRef<{ x: number; y: number; left: number; top: number }>(
    null
  );
  if (!on) return {};
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      const scroller = element.current;
      if (event.button !== 0 || !scroller) return;
      if ((event.target as HTMLElement).closest('button, a, [role="button"]'))
        return;
      drag.current = {
        x: event.clientX,
        y: event.clientY,
        left: scroller.scrollLeft,
        top: scroller.scrollTop,
      };
      scroller.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const scroller = element.current;
      const start = drag.current;
      if (!scroller || !start) return;
      scroller.scrollLeft = start.left - (event.clientX - start.x);
      scroller.scrollTop = start.top - (event.clientY - start.y);
    },
    onPointerUp: () => {
      drag.current = null;
    },
  };
}

export interface GraphCanvasProps {
  canvas: CanvasPlane;
  nodes: Node[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  testId: string;
  /** A modifier class on the scroller. */
  className?: string;
  /** The map's key, drawn over a framed canvas's bottom edge. */
  legend?: ReactNode;
}

export function GraphCanvas({
  canvas: { ref, element, zoom, plane, offset, planeHeight, offsetY, fill },
  nodes,
  edges,
  nodeTypes,
  testId,
  className,
  legend,
}: GraphCanvasProps) {
  const scheme = useComputedColorScheme('light');
  // Controlled, so a resize moves the map without remounting React Flow and
  // dropping an open tooltip or focus inside it.
  const viewport = useMemo(
    () => ({ x: offset, y: offsetY, zoom }),
    [offset, offsetY, zoom]
  );
  const pan = usePan(element, fill !== null);
  return (
    <div className={classes.graphFrame} data-fill={fill ? true : undefined}>
      <div
        ref={ref}
        className={
          className
            ? `${classes.graphCanvas} ${className}`
            : classes.graphCanvas
        }
        data-testid={testId}
        data-zoom={zoom}
        {...pan}
      >
        {/* Plain px, as measured: Mantine's w/h turn px into rem times the
            app's scale, which grows the plane past the frame it fits. */}
        <Box
          className={classes.mapPlane}
          style={{
            width: plane > 0 ? `${plane}px` : '100%',
            height: `${planeHeight}px`,
          }}
          data-plane={plane}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={MAP_EDGE_TYPES}
            viewport={viewport}
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
      {fill && (
        <div className={classes.frameTools}>
          <ActionIcon.Group orientation="vertical">
            <ActionIcon
              variant="default"
              size="md"
              aria-label="Zoom in"
              onClick={fill.zoomIn}
            >
              <Icon name="plus" size={14} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              size="md"
              aria-label="Zoom out"
              onClick={fill.zoomOut}
            >
              <Icon name="minus" size={14} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              size="md"
              aria-label="Fit to the frame"
              onClick={fill.fit}
            >
              <Icon name="fitView" size={14} />
            </ActionIcon>
          </ActionIcon.Group>
          {legend}
        </div>
      )}
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
    <Skeleton
      h={height}
      radius={12}
      role="status"
      data-testid={testId}
      aria-label={label}
    />
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

/** A whole graph on its page: a way back to its block, its counts, the
    view switch and its Mermaid source, then the graph or that source. */
export function GraphPage({
  ref,
  label,
  testId,
  count,
  view,
  onView,
  onClose,
  backLabel,
  source = null,
  fill = false,
  children,
}: {
  ref?: Ref<HTMLElement>;
  label: string;
  testId: string;
  count: string;
  view: BlockGraphSelect;
  onView: (view: BlockGraphSelect) => void;
  onClose: () => void;
  /** The block the page goes back to. */
  backLabel: string;
  /** The graph's Mermaid source, shown in place of the graph on demand. */
  source?: string | null;
  /** Framed to the page's height. */
  fill?: boolean;
  children: ReactNode;
}) {
  const [showSource, setShowSource] = useState(false);
  return (
    <section
      ref={ref}
      className={classes.map}
      data-fill={fill || undefined}
      aria-label={label}
      data-testid={testId}
    >
      <Anchor
        component="button"
        type="button"
        fz={13}
        className={classes.mapBack}
        onClick={onClose}
      >
        <Icon name="chevronLeft" size={13} />
        {backLabel}
      </Anchor>
      <div className={classes.mapHead}>
        <Title order={3} fz={24} lh="normal" c="var(--tk-text-1)">
          Flow
        </Title>
        <Text fz={13} lh="normal" c="dimmed">
          {count}
        </Text>
        <div className={classes.mapTools}>
          <GraphViews value={view} onChange={onView} />
          {source !== null && (
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              leftSection={<Icon name="code" size={13} />}
              aria-pressed={showSource}
              onClick={() => setShowSource(shown => !shown)}
            >
              Source
            </Button>
          )}
        </div>
      </div>
      {showSource && source !== null ? (
        <pre className={classes.frameSource} data-testid="graph-source">
          {source}
        </pre>
      ) : (
        children
      )}
    </section>
  );
}
