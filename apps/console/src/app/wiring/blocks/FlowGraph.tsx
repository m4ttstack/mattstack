import '@xyflow/react/dist/base.css';

import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react';
import {
  Box,
  SegmentedControl,
  Skeleton,
  Text,
  UnstyledButton,
  useComputedColorScheme,
} from '@mattstack/app-kit/core';
import { useElementSize, useMergedRef } from '@mattstack/app-kit/hooks';
import { Icon, type IconName } from '@mattstack/app-kit/icons';
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';

import type { BlocksPayload } from '../../../server/blocksPayload';
import type { BlockGraphSelect } from '../graph/useWiringUrl';
import classes from './blocks.module.css';
import { BlockCard, measureText, useFontsLoaded } from './graphCards';
import { MAP_EDGE_TYPES, type MapFlowEdge } from './graphEdges';
import type { AroundGraphData } from './model/around';
import type { MapKind } from './model/blockMap';
import type { LaidOut, LayoutEngine, LayoutInput } from './model/elkGraph';
import {
  blockFactsOf,
  flowLayout,
  placeLabels,
  scrollToShow,
  type FlowCard,
  type FlowLayout,
} from './model/flowLayout';
import { canvasPlane, MIN_MAP_ZOOM } from './model/mapLayout';
import { useGraphLayout } from './useGraphLayout';

type Graph = BlocksPayload['graphs'][number];

const ICON_STROKE = 2;

const STEP_ICON: Record<MapKind, IconName> = {
  step: 'circle',
  question: 'diamond',
  gate: 'flag',
  end: 'check',
  split: 'circle',
};

/** Each layout by the ELK input built from it, so the canvas keeps drawing
    the last finished layout while a newer one runs. */
const layoutOf = new WeakMap<LayoutInput, FlowLayout>();

const OnSelect = createContext<(blockId: string) => void>(() => {});

type FlowNode = Node<
  { card: FlowCard; focus: boolean },
  'flowBlock' | 'flowStep'
>;

/** A graph-only step: muted, no shadow, never a button. */
export function StepCard({
  label,
  title,
  badge,
  width,
}: {
  label: string;
  title?: string | null;
  badge: MapKind;
  width: number;
}) {
  return (
    <div
      className={classes.flowStep}
      data-testid="flow-step"
      title={title ?? undefined}
      style={{ '--card-w': `${width}px` } as CSSProperties}
    >
      <span className={classes.flowStepBadge} data-badge={badge}>
        <Icon name={STEP_ICON[badge]} size={10} strokeWidth={ICON_STROKE} />
      </span>
      <span className={classes.flowStepLabel}>{label}</span>
    </div>
  );
}

function Handles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={classes.mapHandle}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={classes.mapHandle}
      />
    </>
  );
}

function BlockNode({ data: { card, focus } }: NodeProps<FlowNode>) {
  const onSelect = useContext(OnSelect);
  const { blockId } = card;
  return (
    <>
      <BlockCard
        label={card.label}
        kind={card.badge}
        dots={card.dots}
        width={card.width}
        pills={[]}
        hot={focus}
        onClick={blockId ? () => onSelect(blockId) : undefined}
      />
      <Handles />
    </>
  );
}

function StepNode({ data: { card } }: NodeProps<FlowNode>) {
  return (
    <>
      <StepCard
        label={card.label}
        title={card.title}
        badge={card.badge}
        width={card.width}
      />
      <Handles />
    </>
  );
}

const FLOW_NODE_TYPES: NodeTypes = {
  flowBlock: memo(BlockNode),
  flowStep: memo(StepNode),
};

const handlesAt = (anchorX: number, height: number) => [
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

function flowOf(
  layout: FlowLayout,
  laidOut: LaidOut,
  focus: string | null
): { nodes: FlowNode[]; edges: MapFlowEdge[] } {
  const nodes = [...layout.cards.values()].flatMap((card): FlowNode[] => {
    const placed = laidOut.nodes[card.id];
    if (!placed) return [];
    return [
      {
        id: card.id,
        type: card.kind === 'block' ? 'flowBlock' : 'flowStep',
        position: { x: placed.x, y: placed.y },
        width: placed.width,
        height: placed.height,
        handles: handlesAt(card.width / 2, placed.height),
        data: { card, focus: card.id === focus },
      },
    ];
  });
  const edges = layout.edges.flatMap((edge): MapFlowEdge[] => {
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
          folded: false,
          arrow: true,
          label: edge.label,
          labelBox: routed.label,
        },
      },
    ];
  });
  return { nodes, edges };
}

function FlowCanvas({
  layout,
  laidOut,
  focus,
  startInView,
}: {
  layout: FlowLayout;
  laidOut: LaidOut;
  focus: string | null;
  startInView: boolean;
}) {
  const scheme = useComputedColorScheme('light');
  const { ref: sized, width } = useElementSize();
  const ref = useRef<HTMLDivElement | null>(null);
  const canvasRef = useMergedRef(sized, ref);
  const { nodes, edges } = useMemo(
    () => flowOf(layout, laidOut, focus),
    [layout, laidOut, focus]
  );
  const { zoom, plane, offset: x } = canvasPlane(width, laidOut.width);
  const start = focus ?? layout.order[0] ?? null;
  const shown = useRef(false);
  useEffect(() => {
    const canvas = ref.current;
    const box = start ? laidOut.nodes[start] : undefined;
    if (!startInView || shown.current || width <= 0 || !canvas || !box) {
      return;
    }
    shown.current = true;
    canvas.scrollLeft = scrollToShow(box, {
      zoom,
      offset: x,
      visible: width,
      plane,
    });
    if (focus) {
      [...canvas.querySelectorAll('.react-flow__node')]
        .find(node => node.getAttribute('data-id') === focus)
        ?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [startInView, start, focus, laidOut, width, zoom, x, plane]);
  return (
    <div className={classes.flowFrame}>
      <div
        ref={canvasRef}
        className={classes.flowCanvas}
        data-testid="flow-canvas"
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
            nodeTypes={FLOW_NODE_TYPES}
            edgeTypes={MAP_EDGE_TYPES}
            defaultViewport={{ x, y: 0, zoom }}
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

export interface FlowGraphProps {
  graph: Graph | AroundGraphData;
  /** The blocks the graph's nodes open, for their badges and dots. */
  payload?: BlocksPayload;
  /** The skill in view, which graph-only labels need not repeat. */
  skill?: string;
  /** The node drawn lit. */
  focus: string | null;
  /** The whole graph's flow order, when `graph` is a part of it. */
  order?: string[];
  /** On open, the canvas scrolls the focus, or else the first step, into
      view. */
  startInView?: boolean;
  onSelect: (blockId: string) => void;
  engine?: () => Promise<LayoutEngine>;
  /** The placeholder's height while the first layout runs. */
  loadingHeight?: number;
}

/** Every node and edge of a graph laid out by ELK: blocks as cards, steps
    as muted cards, exit labels as chips by the start of their lines. */
export function FlowGraph({
  graph,
  payload,
  skill,
  focus,
  order,
  startInView = false,
  onSelect,
  engine,
  loadingHeight = 320,
}: FlowGraphProps) {
  const fontsLoaded = useFontsLoaded();
  const layout = useMemo(() => {
    if (graph.nodes.length === 0) return null;
    const laid = flowLayout(graph, {
      skill,
      factsOf: blockFactsOf(payload),
      measure: measureText,
      order,
    });
    layoutOf.set(laid.input, laid);
    return laid;
    // fontsLoaded only re-runs the layout; measureText reads the fonts itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, payload, skill, order, fontsLoaded]);
  const { state, laidOut, laidFor, retry } = useGraphLayout(
    layout?.input ?? null,
    engine
  );
  const shown = laidFor ? layoutOf.get(laidFor) : undefined;
  const placed = useMemo(
    () => (laidOut ? placeLabels(laidOut) : null),
    [laidOut]
  );

  if (layout === null) {
    return (
      <Text fz={13} c="dimmed" className={classes.mapNote}>
        No steps here
      </Text>
    );
  }
  if (state === 'error') {
    return (
      <div className={classes.mapNote} role="alert">
        <Text fz={13} c="dimmed">
          The graph didn&apos;t lay out
        </Text>
        <UnstyledButton className={classes.graphLink} onClick={retry}>
          Retry
        </UnstyledButton>
      </div>
    );
  }
  if (!placed || !shown) {
    return (
      <Skeleton
        h={loadingHeight}
        radius={12}
        data-testid="flow-loading"
        aria-label="Laying out the graph"
      />
    );
  }
  return (
    <OnSelect.Provider value={onSelect}>
      <FlowCanvas
        layout={shown}
        laidOut={placed}
        focus={focus}
        startInView={startInView}
      />
    </OnSelect.Provider>
  );
}

/** What the two kinds of card mean. */
export function FlowKey() {
  return (
    <ul className={classes.flowKey} data-testid="flow-key">
      <li>
        <span className={classes.flowSample} data-kind="block" />
        Opens a block
      </li>
      <li>
        <span className={classes.flowSample} data-kind="step" />
        Graph step only
      </li>
    </ul>
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

export interface EveryStepProps {
  payload: BlocksPayload;
  graph: Graph;
  /** The open block's own node, drawn lit; null on a parent. */
  highlight: string | null;
  onSelect: (blockId: string) => void;
  onView: (view: BlockGraphSelect) => void;
  onClose: () => void;
  engine?: () => Promise<LayoutEngine>;
}

/** The whole graph: every step, every link, every exit label. */
export function EveryStep({
  payload,
  graph,
  highlight,
  onSelect,
  onView,
  onClose,
  engine,
}: EveryStepProps) {
  const blocks = graph.nodes.filter(node => node.blockId !== null).length;
  return (
    <section
      className={classes.map}
      aria-label="Every step"
      data-testid="every-step"
    >
      <div className={classes.mapHead}>
        <Text fz={15} fw={600} lh="normal" c="var(--tk-text-1)">
          Every step
        </Text>
        <Text fz={13} lh="normal" c="dimmed">
          {`${graph.nodes.length} steps · ${blocks} blocks`}
        </Text>
        <div className={classes.mapTools}>
          <GraphViews value="graph-steps" onChange={onView} />
          <UnstyledButton className={classes.mapClose} onClick={onClose}>
            Close
          </UnstyledButton>
        </div>
      </div>
      <FlowGraph
        graph={graph}
        payload={payload}
        skill={payload.skill}
        focus={highlight}
        startInView
        onSelect={onSelect}
        engine={engine}
      />
      <FlowKey />
    </section>
  );
}
