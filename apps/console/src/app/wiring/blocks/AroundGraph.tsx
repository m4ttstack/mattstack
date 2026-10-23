import '@xyflow/react/dist/base.css';

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
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
const CANVAS_PADDING = 16;
/** Rows wrap to fit at full size, so the canvas draws the boards' 13px
    labels; it never zooms out past this, where they read 11px. */
const MIN_ZOOM = 0.85;

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
  const xs = layout.nodes.map(node => node.position.x);
  const wide =
    xs.length > 0 ? Math.max(...xs) - Math.min(...xs) + AROUND.nodeW : 0;
  const fit = width > 0 && wide > 0 ? (width - 2 * CANVAS_PADDING) / wide : 1;
  const zoom = Math.min(1, Math.max(MIN_ZOOM, fit));
  return Math.ceil(tall * zoom) + 2 * CANVAS_PADDING;
}

/** How many nodes fit across a canvas `width` wide at the smallest zoom;
    unbounded until the canvas has been measured. */
function perRowAt(width: number): number {
  if (width <= 0) return Number.POSITIVE_INFINITY;
  const room = width - 2 * CANVAS_PADDING + AROUND.columnGap;
  return Math.max(1, Math.floor(room / (AROUND.nodeW + AROUND.columnGap)));
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
  data: { label, shape, blockId, focus },
}: NodeProps<AroundNode>) {
  const onSelect = useContext(OnSelect);
  return (
    <div className={classes.aroundShell}>
      <UnstyledButton
        className={classes.aroundNode}
        data-kind="block"
        data-focus={focus ? 'true' : undefined}
        data-testid="around-block"
        onClick={() => blockId && onSelect(blockId)}
      >
        <ShapeIcon shape={shape} blockId={blockId} />
        <span className={classes.aroundLabel} title={label}>
          {label}
        </span>
      </UnstyledButton>
      <Handles />
    </div>
  );
}

function GraphOnlyNodeComponent({
  data: { label, shape },
}: NodeProps<AroundNode>) {
  return (
    <div className={classes.aroundShell}>
      <div
        className={classes.aroundNode}
        data-kind="step"
        data-testid="around-step"
      >
        <ShapeIcon shape={shape} />
        <span className={classes.aroundLabel} title={label}>
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
  /** The layout with no row wider than `maxPerRow` nodes. */
  layoutFor: (maxPerRow: number) => {
    nodes: AroundNode[];
    edges: AroundEdge[];
    rows: number;
  };
  onSelect: (blockId: string) => void;
  testId: string;
}) {
  const scheme = useComputedColorScheme('light');
  const { ref, width } = useElementSize();
  // A layout whose side channels run left of its nodes is laid out again
  // with that much less room, so its widest row still fits.
  const { layout, maxPerRow } = useMemo(() => {
    const wide = perRowAt(width);
    const first = layoutFor(wide);
    const reach = channelReach(first);
    if (reach === 0) return { layout: first, maxPerRow: wide };
    const narrow = perRowAt(width - reach);
    return { layout: layoutFor(narrow), maxPerRow: narrow };
  }, [layoutFor, width]);
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
              key={maxPerRow}
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
  glyphOf = noGlyph,
  onSelect,
  onViewWholeGraph,
}: AroundGraphProps) {
  const layoutFor = useCallback(
    (maxPerRow: number) =>
      aroundLayout(aroundBlock(graph, focus), focus, maxPerRow),
    [graph, focus]
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
  glyphOf = noGlyph,
  onSelect,
  onClose,
}: WholeGraphProps) {
  const layoutFor = useCallback(
    (maxPerRow: number) => wholeLayout(graph, highlight, maxPerRow),
    [graph, highlight]
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
