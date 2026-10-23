import '@xyflow/react/dist/base.css';

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import {
  Box,
  Text,
  UnstyledButton,
  useComputedColorScheme,
} from '@mattstack/app-kit/core';
import { useElementSize } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import {
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  PanOnScrollMode,
  Position,
  ReactFlow,
  type EdgeProps,
  type EdgeTypes,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';

import type { BlocksPayload } from '../../../server/blocksPayload';
import { BlockGlyph } from './BlockRow';
import classes from './blocks.module.css';
import { aroundBlock } from './model/around';
import {
  AROUND,
  aroundLayout,
  LANES,
  wholeLayout,
  type AroundEdge,
  type AroundNode,
} from './model/aroundLayout';
import type { Glyph } from './model/blockFacts';

const OnSelect = createContext<(blockId: string) => void>(() => {});

type GlyphLookup = (blockId: string) => Glyph | null;
const noGlyph: GlyphLookup = () => null;
const GlyphOf = createContext<GlyphLookup>(noGlyph);

const ICON_STROKE = 2;
const MARKER = { length: 7, halfWidth: 4 };
const CANVAS_PADDING = 12;
/** Rows wrap to fit at this zoom, so the board's row of four still fits
    beside a scrollbar; a canvas with room to spare draws at full size. */
const FIT_ZOOM = 0.95;
/** The canvas never zooms out past this, where 13px labels read 11px. */
const MIN_ZOOM = 0.85;

let labelContext: CanvasRenderingContext2D | null | undefined;

/** A node label's width as the canvas draws it, at its 13px; null where
    the browser gives no 2D canvas (tests), so the layout estimates. */
function measureLabel(label: string): number | null {
  if (labelContext === undefined) {
    labelContext = document.createElement('canvas').getContext('2d');
    if (labelContext) {
      const family = getComputedStyle(document.body).fontFamily;
      labelContext.font = `400 13px ${family}`;
    }
  }
  return labelContext ? labelContext.measureText(label).width : null;
}

const measure = (label: string) => measureLabel(label) ?? label.length * 7;

/** True once the page's web fonts have loaded, so labels measure in the font
    they draw in rather than its fallback. */
function useFontsLoaded(): boolean {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  const [loaded, setLoaded] = useState(
    !fonts?.ready || fonts.status === 'loaded'
  );
  useEffect(() => {
    if (loaded || !fonts?.ready) return;
    let live = true;
    void fonts.ready.then(() => {
      if (live) setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [fonts, loaded]);
  return loaded;
}

/** Down to the row gap under the source, across to the channel, down past
    the rows between, and across to land on the target from above. */
function sideChannelPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  channel: number,
  lane: number
): string {
  // Each lane bends at its own height, below the drop labels that sit
  // just under the row.
  const step = (lane % LANES) * 6;
  const busY = sy + 22 + step;
  const landY = ty - 12 - step;
  return `M${sx} ${sy}V${busY}H${channel}V${landY}H${tx}V${ty - MARKER.length}`;
}

/** How far left of the nodes the outermost side channel runs. */
function channelReach(layout: { nodes: AroundNode[]; edges: AroundEdge[] }) {
  const channels = layout.edges
    .map(edge => edge.data?.channel)
    .filter((x): x is number => typeof x === 'number');
  if (channels.length === 0 || layout.nodes.length === 0) return 0;
  const left = Math.min(...layout.nodes.map(node => node.position.x));
  return Math.max(0, left - Math.min(...channels));
}

/** The canvas is as tall as the layout at the zoom fitView will pick, so a
    zoomed-out graph leaves no empty band above and below it. */
function canvasHeight(
  layout: { nodes: AroundNode[]; rows: number },
  width: number
): number {
  const { rows } = layout;
  const tall = rows * AROUND.nodeH + (rows - 1) * AROUND.rowGap;
  const lefts = layout.nodes.map(node => node.position.x);
  const rights = layout.nodes.map(
    node => node.position.x + (node.width ?? AROUND.nodeW)
  );
  const wide = lefts.length > 0 ? Math.max(...rights) - Math.min(...lefts) : 0;
  const fit = width > 0 && wide > 0 ? (width - 2 * CANVAS_PADDING) / wide : 1;
  const zoom = Math.min(1, Math.max(MIN_ZOOM, fit));
  return Math.ceil(tall * zoom) + 2 * CANVAS_PADDING;
}

/** The room a row of nodes has across a canvas `width` wide, at the zoom
    rows wrap to fit; unbounded until the canvas has been measured. */
export function roomAt(width: number): number {
  if (width <= 0) return Number.POSITIVE_INFINITY;
  return (width - 2 * CANVAS_PADDING) / FIT_ZOOM;
}

function ShapeIcon({
  shape,
  blockId,
}: {
  shape: AroundNode['data']['shape'];
  blockId?: string | null;
}) {
  const glyph = useContext(GlyphOf)(blockId ?? '');
  if (glyph && glyph !== 'note' && glyph !== 'shared') {
    return <BlockGlyph glyph={glyph} size={12} />;
  }
  return (
    <Icon
      name={shape === 'diamond' ? 'diamond' : 'circle'}
      size={12}
      strokeWidth={ICON_STROKE}
    />
  );
}

function Handles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={classes.aroundHandle}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={classes.aroundHandle}
      />
    </>
  );
}

function BlockNodeComponent({
  width,
  data: { label, title, shape, blockId, focus },
}: NodeProps<AroundNode>) {
  const onSelect = useContext(OnSelect);
  return (
    <div className={classes.aroundShell}>
      <UnstyledButton
        className={classes.aroundNode}
        style={{ width }}
        data-kind="block"
        data-focus={focus ? 'true' : undefined}
        data-testid="around-block"
        onClick={() => blockId && onSelect(blockId)}
      >
        <ShapeIcon shape={shape} blockId={blockId} />
        <span className={classes.aroundLabel} title={title}>
          {label}
        </span>
      </UnstyledButton>
      <Handles />
    </div>
  );
}

function GraphOnlyNodeComponent({
  width,
  data: { label, title, shape },
}: NodeProps<AroundNode>) {
  return (
    <div className={classes.aroundShell}>
      <div
        className={classes.aroundNode}
        style={{ width }}
        data-kind="step"
        data-testid="around-step"
      >
        <ShapeIcon shape={shape} />
        <span className={classes.aroundLabel} title={title}>
          {label}
        </span>
      </div>
      <Handles />
    </div>
  );
}

function AroundEdgeComponent({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
}: EdgeProps<AroundEdge>) {
  const channel = data?.channel ?? null;
  const landX = targetX + (data?.land ?? 0);
  const [path, midX, midY] =
    channel === null
      ? getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX: landX,
          targetY: targetY - MARKER.length,
          targetPosition,
          borderRadius: 0,
          // The bend sits just above the target, below any wrapped row between.
          ...(targetY > sourceY
            ? { centerY: targetY - AROUND.rowGap / 2 }
            : {}),
        })
      : [
          sideChannelPath(
            sourceX,
            sourceY,
            landX,
            targetY,
            channel,
            data?.lane ?? 0
          ),
          sourceX,
          sourceY,
        ];
  // Edges converging on one target share its bend line, so a downward
  // edge's label sits on its own drop, just under its source.
  const down = targetY > sourceY;
  const labelX = down ? sourceX : midX;
  const labelY = down ? sourceY + 10 : midY;
  const marker = `M${landX - MARKER.halfWidth} ${targetY - MARKER.length}l${MARKER.halfWidth} ${MARKER.length} ${MARKER.halfWidth}-${MARKER.length}z`;
  return (
    <>
      <path
        d={path}
        className={classes.aroundEdge}
        data-dashed={data?.dashed || undefined}
      />
      <path d={marker} className={classes.aroundMarker} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={classes.aroundEdgeLabel}
            style={
              {
                '--label-x': `${labelX}px`,
                '--label-y': `${labelY}px`,
              } as CSSProperties
            }
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const NODE_TYPES: NodeTypes = {
  block: memo(BlockNodeComponent),
  graphOnly: memo(GraphOnlyNodeComponent),
};

const EDGE_TYPES: EdgeTypes = { around: memo(AroundEdgeComponent) };

export interface AroundGraphProps {
  graph: BlocksPayload['graphs'][number];
  /** The block's own node id in `graph`. */
  focus: string;
  /** The skill in view, which graph-only labels need not repeat. */
  skill?: string;
  /** A block's kind, for the glyph on its node. */
  glyphOf?: GlyphLookup;
  onSelect: (blockId: string) => void;
  onViewWholeGraph: () => void;
}

/** The canvas, its heading row and its key, shared by the small graph and
    the whole one. */
function GraphFrame({
  label,
  action,
  onAction,
  layoutFor,
  onSelect,
  glyphOf,
  testId,
}: {
  glyphOf: GlyphLookup;
  label: string;
  action: string;
  onAction: () => void;
  /** The layout with no row wider than `room` px. */
  layoutFor: (room: number) => {
    nodes: AroundNode[];
    edges: AroundEdge[];
    rows: number;
  };
  onSelect: (blockId: string) => void;
  testId: string;
}) {
  const scheme = useComputedColorScheme('light');
  const { ref, width } = useElementSize();
  const fontsLoaded = useFontsLoaded();
  // A layout whose side channels run left of its nodes is laid out again
  // with that much less room, so its widest row still fits. It lays out
  // again once the fonts load, since the labels then measure differently.
  const { layout, room } = useMemo(() => {
    const wide = roomAt(width);
    const first = layoutFor(wide);
    const reach = channelReach(first);
    if (reach === 0) return { layout: first, room: wide };
    const narrow = roomAt(width - reach);
    return { layout: layoutFor(narrow), room: narrow };
    // fontsLoaded only re-runs the layout; measure reads the fonts itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutFor, width, fontsLoaded]);
  const height = canvasHeight(layout, width);

  return (
    <section className={classes.around} aria-label={label} data-testid={testId}>
      <div className={classes.aroundHead}>
        <Text fz={11} fw={500} lh="normal" tt="uppercase" c="dimmed">
          {label}
        </Text>
        <UnstyledButton className={classes.graphLink} onClick={onAction}>
          {action}
        </UnstyledButton>
      </div>
      <GlyphOf.Provider value={glyphOf}>
        <OnSelect.Provider value={onSelect}>
          <Box ref={ref} className={classes.aroundCanvas} h={height}>
            <ReactFlow
              key={room}
              nodes={layout.nodes}
              edges={layout.edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              fitView
              fitViewOptions={{
                padding: {
                  y: `${CANVAS_PADDING}px`,
                  right: `${CANVAS_PADDING}px`,
                  left: `${CANVAS_PADDING + channelReach(layout)}px`,
                },
                minZoom: MIN_ZOOM,
                maxZoom: 1,
              }}
              minZoom={MIN_ZOOM}
              panOnScroll
              panOnScrollMode={PanOnScrollMode.Vertical}
              zoomOnScroll={false}
              nodesDraggable={false}
              nodesConnectable={false}
              nodesFocusable={false}
              edgesFocusable={false}
              elementsSelectable={false}
              proOptions={{ hideAttribution: true }}
              colorMode={scheme}
            />
          </Box>
        </OnSelect.Provider>
      </GlyphOf.Provider>
      <ul className={classes.aroundKey}>
        <li className={classes.legendRow}>
          <span className={classes.aroundSample} data-kind="block" />
          Opens a block
        </li>
        <li className={classes.legendRow}>
          <span className={classes.aroundSample} data-kind="step" />
          Graph step only
        </li>
      </ul>
    </section>
  );
}

export function AroundGraph({
  graph,
  focus,
  skill,
  glyphOf = noGlyph,
  onSelect,
  onViewWholeGraph,
}: AroundGraphProps) {
  const layoutFor = useCallback(
    (room: number) =>
      aroundLayout(aroundBlock(graph, focus), focus, Infinity, {
        room,
        measure,
        skill,
      }),
    [graph, focus, skill]
  );

  return (
    <GraphFrame
      label="Around this block"
      action="View whole graph"
      onAction={onViewWholeGraph}
      layoutFor={layoutFor}
      onSelect={onSelect}
      glyphOf={glyphOf}
      testId="around-graph"
    />
  );
}

export interface WholeGraphProps {
  graph: BlocksPayload['graphs'][number];
  /** The skill in view, which graph-only labels need not repeat. */
  skill?: string;
  /** The open block's own node, marked as the focus; null on a parent. */
  highlight: string | null;
  glyphOf?: GlyphLookup;
  onSelect: (blockId: string) => void;
  onClose: () => void;
}

/** A block's whole graph on the same canvas, in place of the small one. */
export function WholeGraph({
  graph,
  highlight,
  skill,
  glyphOf = noGlyph,
  onSelect,
  onClose,
}: WholeGraphProps) {
  const layoutFor = useCallback(
    (room: number) =>
      wholeLayout(graph, highlight, Infinity, { room, measure, skill }),
    [graph, highlight, skill]
  );
  return (
    <GraphFrame
      label="Whole graph"
      action="Close graph"
      onAction={onClose}
      layoutFor={layoutFor}
      onSelect={onSelect}
      glyphOf={glyphOf}
      testId="whole-graph"
    />
  );
}
