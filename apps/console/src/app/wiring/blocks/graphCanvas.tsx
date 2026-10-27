import '@xyflow/react/dist/base.css';

import {
  useEffect,
  useLayoutEffect,
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
  Box,
  SegmentedControl,
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

import { StepLoader, type StepLoading } from '../../StepLoader';
import type { BlockGraphSelect } from '../graph/useWiringUrl';
import classes from './blocks.module.css';
import { MAP_EDGE_TYPES, type MapFlowEdge } from './graphEdges';
import { Trail, type TrailItem } from '../../nav/Trail';
import { MermaidSource } from './MermaidSource';
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
    /** Zooms by `factor`, keeping the map point under the cursor still. */
    zoomAt: (factor: number, clientX: number, clientY: number) => void;
    fit: () => void;
  } | null;
};

const ZOOM_STEP = 1.2;
const ZOOM_RANGE = { min: 0.25, max: 2 };
/** Wheel delta to zoom: a pinch (ctrlKey) sends small deltas, a mouse wheel
    large ones. */
const WHEEL_RATE = { pinch: 0.01, wheel: 0.0015 };
/** Room a framed map leaves round its edges: the zoom buttons and key sit
    over its bottom one. */
const FRAME_PAD = { x: 24, top: 24, bottom: 64 };

/** The scroller's size and the plane a map `mapWidth` wide draws on in it.
    A framed canvas (`fill`) opens on the whole map, fitted to its frame
    however small that draws it, and zooms in steps from there. */
export function useCanvasPlane(
  mapWidth: number,
  mapHeight = 0,
  fill = false
): CanvasPlane {
  const { ref: sized, width, height } = useElementSize<HTMLDivElement>();
  const element = useRef<HTMLDivElement | null>(null);
  const ref = useMergedRef(sized, element);
  const [scale, setScale] = useState(1);
  /** The map point a zoom holds still, and where it sat in the frame. */
  const anchor = useRef<{ x: number; y: number; px: number; py: number }>(
    null
  );
  const room = { w: Math.floor(width), h: Math.floor(height) };
  const fit =
    room.w > 0 && room.h > 0 && mapWidth > 0 && mapHeight > 0
      ? Math.min(
          1,
          (room.w - FRAME_PAD.x * 2) / mapWidth,
          (room.h - FRAME_PAD.top - FRAME_PAD.bottom) / mapHeight
        )
      : 1;
  const zoom = Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, fit * scale));
  const drawn = { w: mapWidth * zoom, h: mapHeight * zoom };
  // Zoomed past the overview, the map gets half a frame of room on every
  // side, so a drag pans it either way, a narrow map sideways included.
  const zoomedIn = scale > 1;
  const plane = zoomedIn
    ? Math.ceil(drawn.w + room.w)
    : Math.max(room.w, Math.ceil(drawn.w + FRAME_PAD.x * 2));
  const planeHeight = zoomedIn
    ? Math.ceil(drawn.h + room.h)
    : Math.max(room.h, Math.ceil(drawn.h + FRAME_PAD.top + FRAME_PAD.bottom));
  const offset = (plane - drawn.w) / 2;
  const offsetY = zoomedIn
    ? (planeHeight - drawn.h) / 2
    : FRAME_PAD.top +
      (planeHeight - drawn.h - FRAME_PAD.top - FRAME_PAD.bottom) / 2;

  useLayoutEffect(() => {
    const at = anchor.current;
    const scroller = element.current;
    if (!fill || !at || !scroller) return;
    anchor.current = null;
    scroller.scrollLeft = offset + at.x * zoom - at.px;
    scroller.scrollTop = offsetY + at.y * zoom - at.py;
  }, [fill, zoom, offset, offsetY]);

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
  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const scroller = element.current;
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      const px = (clientX ?? box.left + box.width / 2) - box.left;
      const py = (clientY ?? box.top + box.height / 2) - box.top;
      anchor.current = {
        x: (scroller.scrollLeft + px - offset) / zoom,
        y: (scroller.scrollTop + py - offsetY) / zoom,
        px,
        py,
      };
    }
    setScale(now =>
      Math.min(
        ZOOM_RANGE.max / fit,
        Math.max(ZOOM_RANGE.min / fit, now * factor)
      )
    );
  };
  return {
    ref,
    element,
    width,
    zoom,
    plane,
    offset,
    planeHeight,
    offsetY,
    fill: {
      zoomIn: () => zoomAt(ZOOM_STEP),
      zoomOut: () => zoomAt(1 / ZOOM_STEP),
      zoomAt,
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
  /** The map's key, stacked in a framed canvas's bottom right corner. */
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
  const zoomAt = useRef(fill?.zoomAt);
  useEffect(() => {
    zoomAt.current = fill?.zoomAt;
  });
  const framed = fill !== null;
  // A wheel zooms a framed map about the cursor. Bound natively: React's
  // wheel listener is passive, so it cannot stop the page scrolling.
  useEffect(() => {
    const scroller = element.current;
    if (!framed || !scroller) return;
    // A wheel fires several times a frame; one zoom per frame, from the map
    // as last drawn, keeps the point under the cursor from drifting.
    let pending: { factor: number; x: number; y: number } | null = null;
    let frame = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rate = event.ctrlKey ? WHEEL_RATE.pinch : WHEEL_RATE.wheel;
      pending = {
        factor: (pending?.factor ?? 1) * Math.exp(-event.deltaY * rate),
        x: event.clientX,
        y: event.clientY,
      };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const step = pending;
        pending = null;
        if (step) zoomAt.current?.(step.factor, step.x, step.y);
      });
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('wheel', onWheel);
    };
  }, [element, framed]);
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
        </div>
      )}
      {fill && legend && <div className={classes.frameLegend}>{legend}</div>}
    </div>
  );
}

export function GraphLoading({
  bind,
  height,
  testId,
  steps,
}: {
  bind: StepLoading['bind'];
  height: number;
  testId: string;
  steps: readonly string[];
}) {
  return (
    <div style={{ height }}>
      <StepLoader {...bind} placement="centre" testId={testId} steps={steps} />
    </div>
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

const GRAPH_VIEWS: { value: BlockGraphSelect | 'source'; label: string }[] = [
  { value: 'graph', label: 'Blocks' },
  { value: 'graph-steps', label: 'Every step' },
];
const SOURCE_VIEW = { value: 'source', label: 'Source' } as const;

/** A whole graph on its page: its trail, its block's name, its counts and
    the view switch, then the graph or its Mermaid source. */
export function GraphPage({
  ref,
  label,
  testId,
  count,
  view,
  onView,
  trail,
  title,
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
  /** Where the graph sits: the skill, its blocks, then the diagram. */
  trail: TrailItem[];
  /** The block the graph draws, which the page is named for. */
  title: string;
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
      <Trail items={trail} testId="graph-trail" />
      <div className={classes.mapHead}>
        <Title order={3} fz={22} lh="normal" c="var(--tk-text-1)">
          {title}
        </Title>
        <Text fz={13} lh="normal" c="dimmed">
          {`Diagram · ${count}`}
        </Text>
        <div className={classes.mapTools}>
          <SegmentedControl
            size="xs"
            aria-label="Graph view"
            data={source !== null ? [...GRAPH_VIEWS, SOURCE_VIEW] : GRAPH_VIEWS}
            value={showSource && source !== null ? 'source' : view}
            onChange={next => {
              setShowSource(next === 'source');
              if (next !== 'source') onView(next as BlockGraphSelect);
            }}
          />
        </div>
      </div>
      {showSource && source !== null ? (
        <MermaidSource source={source} />
      ) : (
        children
      )}
    </section>
  );
}
