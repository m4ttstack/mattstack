import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { Text } from '@mattstack/app-kit/core';
import { useReducedMotion } from '@mattstack/app-kit/hooks';
import type { Node, NodeProps, NodeTypes } from '@xyflow/react';

import type { BlocksPayload } from '../../../server/blocksPayload';
import type { BlockGraphSelect } from '../graph/useWiringUrl';
import classes from './blocks.module.css';
import {
  edgesOf,
  GraphCanvas,
  GraphError,
  GraphPage,
  GraphLoading,
  handlesAt,
  useCanvasLayout,
  useCanvasPlane,
} from './graphCanvas';
import {
  BlockCard,
  Handles,
  measureText,
  StepCard,
  useFontsLoaded,
} from './graphCards';
import type { MapFlowEdge } from './graphEdges';
import type { AroundGraphData } from './model/around';
import type { LaidOut, LayoutEngine } from './model/elkGraph';
import {
  blockFactsOf,
  flowLayout,
  placeLabels,
  scrollToShow,
  type FlowCard,
  type FlowLayout,
} from './model/flowLayout';
import { countOf } from './model/labels';

type Graph = BlocksPayload['graphs'][number];

const OnSelect = createContext<(blockId: string) => void>(() => {});

type FlowNode = Node<
  { card: FlowCard; focus: boolean },
  'flowBlock' | 'flowStep'
>;

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
  return { nodes, edges: edgesOf(layout.edges, laidOut) };
}

function FlowCanvas({
  layout,
  laidOut,
  focus,
  startInView,
  fill,
}: {
  layout: FlowLayout;
  laidOut: LaidOut;
  focus: string | null;
  startInView: boolean;
  fill: boolean;
}) {
  const canvas = useCanvasPlane(laidOut.width, laidOut.height, fill);
  const { element, width, zoom, plane, offset: x } = canvas;
  const { nodes, edges } = useMemo(
    () => flowOf(layout, laidOut, focus),
    [layout, laidOut, focus]
  );
  const start = focus ?? layout.order[0] ?? null;
  const reduceMotion = useReducedMotion();
  const shown = useRef(false);
  useEffect(() => {
    const scroller = element.current;
    const box = start ? laidOut.nodes[start] : undefined;
    if (!startInView || shown.current || width <= 0 || !scroller || !box) {
      return;
    }
    shown.current = true;
    scroller.scrollLeft = scrollToShow(box, {
      zoom,
      offset: x,
      visible: width,
      plane,
    });
    if (focus) {
      [...scroller.querySelectorAll('.react-flow__node')]
        .find(node => node.getAttribute('data-id') === focus)
        ?.scrollIntoView?.({
          behavior: reduceMotion ? 'instant' : 'smooth',
          block: 'center',
          inline: 'center',
        });
    }
  }, [
    element,
    startInView,
    start,
    focus,
    laidOut,
    width,
    zoom,
    x,
    plane,
    reduceMotion,
  ]);
  return (
    <GraphCanvas
      canvas={canvas}
      nodes={nodes}
      edges={edges}
      nodeTypes={FLOW_NODE_TYPES}
      testId="flow-canvas"
      className={classes.flowCanvas}
      legend={fill ? <FlowKey /> : undefined}
    />
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
  /** Framed to the page's height, with its key inside the frame. */
  fill?: boolean;
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
  fill = false,
}: FlowGraphProps) {
  const fontsLoaded = useFontsLoaded();
  const layout = useMemo(() => {
    if (graph.nodes.length === 0) return null;
    return flowLayout(graph, {
      skill,
      factsOf: blockFactsOf(payload),
      measure: measureText,
      order,
    });
    // fontsLoaded only re-runs the layout; measureText reads the fonts itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, payload, skill, order, fontsLoaded]);
  const { state, laidOut, shown, retry } = useCanvasLayout(layout, engine);
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
  if (state === 'error') return <GraphError onRetry={retry} />;
  if (!placed || !shown) {
    return (
      <GraphLoading
        height={loadingHeight}
        testId="flow-loading"
        label="Laying out the graph"
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
        fill={fill}
      />
      {!fill && <FlowKey />}
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
        A step with no block
      </li>
    </ul>
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
  /** The block Close goes back to. */
  backLabel: string;
  /** The graph's Mermaid source. */
  source?: string | null;
  /** Framed to the page's height. */
  fill?: boolean;
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
  backLabel,
  source = null,
  fill = false,
  engine,
}: EveryStepProps) {
  const blocks = graph.nodes.filter(node => node.blockId !== null).length;
  return (
    <GraphPage
      label="Every step"
      testId="every-step"
      count={`${countOf(graph.nodes.length, 'step')} · ${countOf(blocks, 'block')}`}
      view="graph-steps"
      onView={onView}
      onClose={onClose}
      backLabel={backLabel}
      source={source}
      fill={fill}
    >
      <FlowGraph
        graph={graph}
        payload={payload}
        skill={payload.skill}
        focus={highlight}
        startInView
        onSelect={onSelect}
        engine={engine}
        fill={fill}
      />
    </GraphPage>
  );
}
