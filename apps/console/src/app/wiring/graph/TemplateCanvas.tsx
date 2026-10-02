import '@xyflow/react/dist/base.css';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  PanOnScrollMode,
  ReactFlow,
  useReactFlow,
  useStore,
  useStoreApi,
  useViewport,
  type EdgeTypes,
  type NodeTypes,
  type ReactFlowState,
} from '@xyflow/react';

import {
  BOARD_VIEWPORT,
  COLUMN_TOP,
  extentFor,
  frameStage,
  headingDetail,
  panFor,
} from './layout/stageFraming';
import { LAYOUT, type LayoutResult } from './layout/templateLayout';
import type { TemplateView } from './model/templateModel';
import {
  CanvasContext,
  ICON_STROKE,
  MUTED,
  type CanvasState,
} from './nodes/canvasContext';
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
  const detail = headingDetail(zoom);
  return (
    <Panel
      position="top-left"
      className={classes.columns}
      data-testid="column-headers"
    >
      {detail !== 'none' &&
        columnsOf(view).map(column => (
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
            {detail === 'full' && (
              <Text fz={11} lh="normal" c={MUTED} data-parity="s">
                {column.sub}
              </Text>
            )}
          </div>
        ))}
    </Panel>
  );
}

/** Every node has its measured size. `useNodesInitialized` never turns true
    here: it reads sizes off the caller's nodes, and these are never written
    back, because the canvas takes no node changes. */
const allMeasured = (store: ReactFlowState) => {
  for (const node of store.nodeLookup.values())
    if (!node.measured.width || !node.measured.height) return false;
  return store.nodeLookup.size > 0;
};

type StageShape = {
  /** Node ids and positions: what a refit follows. */
  geometry: string;
  /** Stage px a drawer covers at the stage's right edge. */
  cover: number;
  /** The focus header's bottom in stage px. */
  headerBottom: number;
};

/** The zoom controls, framing the graph once its nodes are measured and
    again whenever the stage or the graph's shape changes. */
function ZoomControls({
  shape: { geometry, cover, headerBottom },
  onFramed,
}: {
  shape: StageShape;
  onFramed: (contentTop: number) => void;
}) {
  const {
    zoomIn,
    zoomOut,
    getNodes,
    getNodesBounds,
    getViewport,
    setViewport,
  } = useReactFlow();
  const store = useStoreApi();
  const width = useStore(state => state.width);
  const height = useStore(state => state.height);
  const measured = useStore(allMeasured);
  const frameKey = `${geometry}|${width}x${height}|${headerBottom}`;
  const framed = useRef<{ key: string; y: number } | null>(null);
  /** How far left of its drawerless place a drawer has slid the graph. */
  const shift = useRef(0);

  const graph = useCallback(() => {
    const bounds = getNodesBounds(getNodes());
    return { right: bounds.x + bounds.width, bottom: bounds.y + bounds.height };
  }, [getNodes, getNodesBounds]);

  const frame = useCallback(() => {
    if (!width || !height) return;
    const framing = frameStage({ width, height }, graph(), {
      cover,
      headerBottom,
    });
    store.getState().setTranslateExtent(framing.extent);
    void setViewport(framing.viewport);
    onFramed(framing.contentTop);
    framed.current = { key: frameKey, y: framing.viewport.y };
    shift.current =
      framing.viewport.x - panFor(width, framing.viewport.zoom, 0);
  }, [
    width,
    height,
    graph,
    cover,
    headerBottom,
    store,
    setViewport,
    onFramed,
    frameKey,
  ]);

  // Nodes remeasure after every data refresh; a refit then would throw away
  // the reader's scroll and zoom.
  useEffect(() => {
    if (measured && framed.current?.key !== frameKey) frame();
  }, [measured, frameKey, frame]);

  // A drawer opening slides the graph left just far enough to clear it, and
  // closing slides it back by the same amount, keeping the reader's zoom and
  // scroll.
  const panned = useRef(cover);
  useEffect(() => {
    if (panned.current === cover) return;
    panned.current = cover;
    if (!framed.current || !width || !height) return;
    const viewport = getViewport();
    const x =
      cover > 0
        ? Math.min(viewport.x, panFor(width, viewport.zoom, cover))
        : viewport.x - shift.current;
    shift.current = cover > 0 ? x - viewport.x : 0;
    store
      .getState()
      .setTranslateExtent(
        extentFor(
          { width, height },
          graph(),
          { x, y: framed.current.y, zoom: viewport.zoom },
          cover
        )
      );
    void setViewport({ ...viewport, x });
  }, [cover, width, height, graph, store, getViewport, setViewport]);

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
          <Icon
            strokeWidth={ICON_STROKE}
            name="plus"
            size={14}
            color={MUTED}
            data-parity="i"
          />
        </ControlButton>
        <ControlButton
          className={classes.zoomButton}
          onClick={() => void zoomOut()}
          title="Zoom out"
          aria-label="Zoom out"
          data-parity="ctl · minus"
        >
          <Icon
            strokeWidth={ICON_STROKE}
            name="minus"
            size={14}
            color={MUTED}
            data-parity="i"
          />
        </ControlButton>
        <ControlButton
          className={classes.zoomButton}
          onClick={frame}
          title="Fit to the stage"
          aria-label="Fit to the stage"
        >
          <Icon
            strokeWidth={ICON_STROKE}
            name="fitView"
            size={14}
            color={MUTED}
            data-parity="i"
          />
        </ControlButton>
      </div>
    </Controls>
  );
}

export default function TemplateCanvas({
  layout,
  view,
  height,
  cover = 0,
  headerBottom = 0,
  onSelect,
}: {
  layout: LayoutResult;
  view: TemplateView;
  height: string;
  /** Stage px a drawer covers at the stage's right edge. */
  cover?: number;
  /** The focus header's bottom in stage px. */
  headerBottom?: number;
  onSelect: (select: string) => void;
}) {
  const [url, patch] = useWiringUrl();
  const scheme = useComputedColorScheme('light');
  const [contentTop, setContentTop] = useState(
    BOARD_VIEWPORT.y + COLUMN_TOP * BOARD_VIEWPORT.zoom
  );
  const edges = useMemo(
    () =>
      layout.edges.map(edge => ({
        ...edge,
        data: { name: parityName.edge(view, edge) } satisfies TemplateEdgeData,
      })),
    [layout, view]
  );
  const geometry = useMemo(
    () =>
      layout.nodes
        .map(node => `${node.id}@${node.position.x},${node.position.y}`)
        .join(' '),
    [layout]
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
      <Box
        className={classes.canvas}
        h={height}
        style={{ '--content-top': `${contentTop}px` } as CSSProperties}
        data-testid="template-canvas"
      >
        <ReactFlow
          nodes={layout.nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          defaultViewport={BOARD_VIEWPORT}
          minZoom={MIN_ZOOM}
          panOnScroll
          panOnScrollMode={PanOnScrollMode.Vertical}
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
          <ZoomControls
            shape={{ geometry, cover, headerBottom }}
            onFramed={setContentTop}
          />
        </ReactFlow>
      </Box>
    </CanvasContext.Provider>
  );
}
