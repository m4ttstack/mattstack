import '@xyflow/react/dist/base.css';

import {
  createContext,
  memo,
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
import { Icon } from '@mattstack/app-kit/icons';
import {
  Background,
  BackgroundVariant,
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
import classes from './blocks.module.css';
import { aroundBlock } from './model/around';
import {
  AROUND,
  aroundLayout,
  layerNodes,
  wholeLayout,
  type AroundEdge,
  type AroundNode,
} from './model/aroundLayout';

const OnSelect = createContext<(blockId: string) => void>(() => {});

const ICON_STROKE = 2;
const MARKER = { length: 7, halfWidth: 4 };
const CANVAS_PADDING = 24;

function ShapeIcon({ shape }: { shape: AroundNode['data']['shape'] }) {
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
        <ShapeIcon shape={shape} />
        <span className={classes.aroundLabel}>{label}</span>
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
        <span className={classes.aroundLabel}>{label}</span>
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
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY: targetY - MARKER.length,
    targetPosition,
    borderRadius: 0,
  });
  const marker = `M${targetX - MARKER.halfWidth} ${targetY - MARKER.length}l${MARKER.halfWidth} ${MARKER.length} ${MARKER.halfWidth}-${MARKER.length}z`;
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
  onSelect: (blockId: string) => void;
  onViewWholeGraph: () => void;
}

/** The canvas, its heading row and its key, shared by the small graph and
    the whole one. */
function GraphFrame({
  label,
  action,
  onAction,
  layout,
  rows,
  onSelect,
  testId,
}: {
  label: string;
  action: string;
  onAction: () => void;
  layout: { nodes: AroundNode[]; edges: AroundEdge[] };
  rows: number;
  onSelect: (blockId: string) => void;
  testId: string;
}) {
  const scheme = useComputedColorScheme('light');
  const height =
    rows * AROUND.nodeH + (rows - 1) * AROUND.rowGap + 2 * CANVAS_PADDING;

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
      <OnSelect.Provider value={onSelect}>
        <Box className={classes.aroundCanvas} h={height}>
          <ReactFlow
            nodes={layout.nodes}
            edges={layout.edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            fitView
            fitViewOptions={{ padding: `${CANVAS_PADDING}px`, maxZoom: 1 }}
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
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={2}
              color="var(--tk-line-2)"
              bgColor="var(--tk-bg)"
            />
          </ReactFlow>
        </Box>
      </OnSelect.Provider>
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
  onSelect,
  onViewWholeGraph,
}: AroundGraphProps) {
  const { layout, rows } = useMemo(() => {
    const sub = aroundBlock(graph, focus);
    const layers = layerNodes(sub, focus);
    return {
      layout: aroundLayout(sub, focus),
      rows: Math.max(0, ...layers.values()) + 1,
    };
  }, [graph, focus]);

  return (
    <GraphFrame
      label="Around this block"
      action="View whole graph"
      onAction={onViewWholeGraph}
      layout={layout}
      rows={rows}
      onSelect={onSelect}
      testId="around-graph"
    />
  );
}

export interface WholeGraphProps {
  graph: BlocksPayload['graphs'][number];
  /** The open block's own node, marked as the focus; null on a parent. */
  highlight: string | null;
  onSelect: (blockId: string) => void;
  onClose: () => void;
}

/** A block's whole graph on the same canvas, in place of the small one. */
export function WholeGraph({
  graph,
  highlight,
  onSelect,
  onClose,
}: WholeGraphProps) {
  const layout = useMemo(
    () => wholeLayout(graph, highlight),
    [graph, highlight]
  );
  return (
    <GraphFrame
      label="Whole graph"
      action="Close graph"
      onAction={onClose}
      layout={layout}
      rows={layout.rows}
      onSelect={onSelect}
      testId="whole-graph"
    />
  );
}
