import '@xyflow/react/dist/base.css';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react';
import { Box, Text, useComputedColorScheme } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  Panel,
  ReactFlow,
  useReactFlow,
  useStore,
  useViewport,
  type EdgeTypes,
  type NodeTypes,
  type ReactFlowState,
  type Viewport,
} from '@xyflow/react';

import { LAYOUT, type LayoutResult } from './layout/templateLayout';
import type { TemplateView } from './model/templateModel';
import { CanvasContext, MUTED, type CanvasState } from './nodes/canvasContext';
import { InputCardNode } from './nodes/InputCardNode';
import { LinkCardNode } from './nodes/LinkCardNode';
import classes from './nodes/nodes.module.css';
import { OutputNode } from './nodes/OutputNode';
import { parityName } from './nodes/parity';
import { TemplateEdge, type TemplateEdgeData } from './nodes/TemplateEdge';
import { TemplateNode } from './nodes/TemplateNode';
import { useWiringUrl } from './useWiringUrl';

const NODE_TYPES: NodeTypes = {
  template: TemplateNode,
  input: InputCardNode,
  link: LinkCardNode,
  output: OutputNode,
};

const EDGE_TYPES: EdgeTypes = { default: TemplateEdge };

/** The boards' framing: the layout's origin sits 124px down the stage at
    zoom 1, under the focus header and the column headings. */
const BOARD_VIEWPORT: Viewport = { x: 0, y: 124, zoom: 1 };
const COLUMN_TOP = -52;
const EDGE_ROOM = 24;
/** The zoom controls' corner: 96px of buttons on a 32px margin. */
const CONTROLS_ROOM = 136;
const MIN_ZOOM = 0.25;

type Column = { x: number; title: string; sub: string };

function columnsOf(view: TemplateView): Column[] {
  const left: Column = {
    x: LAYOUT.inputX,
    title: 'Substituted in',
    sub: 'Files and values that replace each placeholder',
  };
  if (view.output) {
    return [
      left,
      {
        x: LAYOUT.templateX,
        title: 'Template',
        sub: `The ${view.textNoun} as written, with its placeholders`,
      },
      {
        x: LAYOUT.rightX,
        title: 'Rendered',
        sub: 'What the agent actually reads',
      },
    ];
  }
  return [
    left,
    {
      x: LAYOUT.templateX,
      title: 'Template',
      sub: `${view.skill} as written · click a line range to read it`,
    },
    {
      x: LAYOUT.rightX,
      title: 'Links to',
      sub: 'Rendered steps the orchestrator runs in order',
    },
  ];
}

/** Headings over each column, held to the columns' x as the canvas pans
    and zooms but never scaled with it. */
function ColumnHeaders({ view }: { view: TemplateView }) {
  const { x, y, zoom } = useViewport();
  return (
    <Panel
      position="top-left"
      className={classes.columns}
      data-testid="column-headers"
    >
      {columnsOf(view).map(column => (
        <div
          key={column.title}
          className={classes.column}
          style={
            {
              '--column-x': `${x + column.x * zoom}px`,
              '--column-y': `${y + COLUMN_TOP * zoom}px`,
            } as CSSProperties
          }
        >
          <Text
            fz={10}
            fw={500}
            lh="normal"
            tt="uppercase"
            c={MUTED}
            className={classes.columnTitle}
            data-parity="t"
          >
            {column.title}
          </Text>
          <Text fz={11} lh="normal" c={MUTED} data-parity="s">
            {column.sub}
          </Text>
        </div>
      ))}
    </Panel>
  );
}

/**
 * The boards' framing when the graph fits the stage at zoom 1; otherwise the
 * same corner, zoomed out until it fits. False until the stage has a size.
 */
function useStageFraming(): () => boolean {
  const width = useStore(store => store.width);
  const height = useStore(store => store.height);
  const { getNodes, getNodesBounds, setViewport } = useReactFlow();
  return useCallback(() => {
    if (!width || !height) return false;
    const bounds = getNodesBounds(getNodes());
    const zoom = Math.min(
      1,
      (width - EDGE_ROOM) / (bounds.x + bounds.width),
      (height - BOARD_VIEWPORT.y - CONTROLS_ROOM) / (bounds.y + bounds.height)
    );
    void setViewport({ ...BOARD_VIEWPORT, zoom: Math.max(zoom, MIN_ZOOM) });
    return true;
  }, [width, height, getNodes, getNodesBounds, setViewport]);
}

/** Every node has its measured size. `useNodesInitialized` never turns true
    here: it reads sizes off the caller's nodes, and these are never written
    back, because the canvas takes no node changes. */
const allMeasured = (store: ReactFlowState) => {
  for (const node of store.nodeLookup.values())
    if (!node.measured.width || !node.measured.height) return false;
  return store.nodeLookup.size > 0;
};

/** Frames the graph once its nodes have their measured sizes. */
function FrameOnLoad() {
  const measured = useStore(allMeasured);
  const frame = useStageFraming();
  const framed = useRef(false);
  useEffect(() => {
    if (!framed.current && measured) framed.current = frame();
  }, [measured, frame]);
  return null;
}

function ZoomControls() {
  const { zoomIn, zoomOut } = useReactFlow();
  const frame = useStageFraming();
  return (
    <Controls
      position="bottom-left"
      showZoom={false}
      showFitView={false}
      showInteractive={false}
      className={classes.zoomPanel}
      aria-label="Zoom"
    >
      <div className={classes.zoom} data-parity="Zoom controls">
        <ControlButton
          className={classes.zoomButton}
          onClick={() => void zoomIn()}
          title="Zoom in"
          aria-label="Zoom in"
          data-parity="ctl · plus"
        >
          <Icon name="plus" size={14} color={MUTED} data-parity="i" />
        </ControlButton>
        <ControlButton
          className={classes.zoomButton}
          onClick={() => void zoomOut()}
          title="Zoom out"
          aria-label="Zoom out"
          data-parity="ctl · minus"
        >
          <Icon name="minus" size={14} color={MUTED} data-parity="i" />
        </ControlButton>
        <ControlButton
          className={classes.zoomButton}
          onClick={frame}
          title="Fit to the stage"
          aria-label="Fit to the stage"
        >
          <Icon name="fitView" size={14} color={MUTED} data-parity="i" />
        </ControlButton>
      </div>
    </Controls>
  );
}

export default function TemplateCanvas({
  layout,
  view,
  height,
  onSelect,
}: {
  layout: LayoutResult;
  view: TemplateView;
  height: string;
  onSelect: (select: string) => void;
}) {
  const [url, patch] = useWiringUrl();
  const scheme = useComputedColorScheme('light');
  const edges = useMemo(
    () =>
      layout.edges.map(edge => ({
        ...edge,
        data: { name: parityName.edge(view, edge) } satisfies TemplateEdgeData,
      })),
    [layout, view]
  );
  const state = useMemo<CanvasState>(
    () => ({
      view,
      select: url.select,
      onSelect,
      onOpenSkill: skill => patch({ focus: skill }),
    }),
    [view, url.select, onSelect, patch]
  );

  return (
    <CanvasContext.Provider value={state}>
      <Box className={classes.canvas} h={height} data-testid="template-canvas">
        <ReactFlow
          nodes={layout.nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          defaultViewport={BOARD_VIEWPORT}
          minZoom={MIN_ZOOM}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          colorMode={scheme}
        >
          <div className={classes.dots} data-parity="background · dots">
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={2}
              color="var(--tk-line-2)"
              bgColor="var(--tk-bg)"
            />
          </div>
          <ColumnHeaders view={view} />
          <ZoomControls />
          <FrameOnLoad />
        </ReactFlow>
      </Box>
    </CanvasContext.Provider>
  );
}
