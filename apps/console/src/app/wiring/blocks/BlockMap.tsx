import '@xyflow/react/dist/base.css';

import { useMemo } from 'react';
import {
  Box,
  Skeleton,
  Text,
  UnstyledButton,
  useComputedColorScheme,
} from '@mattstack/app-kit/core';
import { useElementSize } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import {
  Background,
  BackgroundVariant,
  Position,
  ReactFlow,
} from '@xyflow/react';

import type { BlocksPayload } from '../../../server/blocksPayload';
import classes from './blocks.module.css';
import {
  MAP_NODE_TYPES,
  MapActionsContext,
  measureText,
  useFontsLoaded,
  type JunctionFlowNode,
  type MapActions,
  type MapFlowNode,
} from './graphCards';
import { MAP_EDGE_TYPES, type MapFlowEdge } from './graphEdges';
import { shortLabel } from './model/aroundLayout';
import { dotsOf, labelOf } from './model/blockFacts';
import { blockMap, type MapKind } from './model/blockMap';
import type { LaidOut, LayoutEngine } from './model/elkGraph';
import { mapLayout, skillOf, type MapLayout } from './model/mapLayout';
import { useGraphLayout } from './useGraphLayout';

type Graph = BlocksPayload['graphs'][number];

/** The map never shrinks past this to fit a narrow column. */
const MIN_ZOOM = 0.5;

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
  layout: MapLayout,
  laidOut: LaidOut
): { nodes: (MapFlowNode | JunctionFlowNode)[]; edges: MapFlowEdge[] } {
  const nodes: (MapFlowNode | JunctionFlowNode)[] = [];
  for (const box of layout.boxes.values()) {
    const placed = laidOut.nodes[box.node.id];
    if (!placed) continue;
    nodes.push({
      id: box.node.id,
      type: box.node.kind === 'split' ? 'split' : 'card',
      position: { x: placed.x, y: placed.y },
      width: placed.width,
      height: placed.height,
      handles: handlesAt(box.width / 2, placed.height),
      data: { box },
    });
  }
  for (const id of layout.junctions) {
    const placed = laidOut.nodes[id];
    if (!placed) continue;
    nodes.push({
      id,
      type: 'junction',
      position: { x: placed.x, y: placed.y },
      width: placed.width,
      height: placed.height,
      handles: handlesAt(placed.width / 2, placed.height),
      data: {},
    });
  }
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
          folded: edge.folded,
          arrow: edge.arrow,
          label: edge.label,
          labelBox: routed.label,
        },
      },
    ];
  });
  return { nodes, edges };
}

function MapKey() {
  const badge = (kind: MapKind, icon: 'circle' | 'diamond' | 'flag') => (
    <span className={classes.mapKeyBadge} data-badge={kind}>
      <Icon name={icon} size={10} strokeWidth={2} />
    </span>
  );
  return (
    <ul className={classes.mapKey} data-testid="map-key">
      <li>
        {badge('step', 'circle')}
        step
      </li>
      <li>
        {badge('question', 'diamond')}
        question
      </li>
      <li>
        {badge('gate', 'flag')}
        gate
      </li>
      <li>
        <span className={classes.dot} data-layer="org" />
        org base adds
      </li>
      <li>
        <span className={classes.dot} data-layer="team" />
        team adds
      </li>
      <li>
        <svg className={classes.mapKeyFolded} viewBox="0 0 24 4" aria-hidden>
          <path
            d="M2 2H22"
            className={classes.mapEdge}
            strokeWidth={2.4}
            strokeDasharray="0 5"
            strokeLinecap="round"
          />
        </svg>
        steps folded
      </li>
      <li>
        <span className={classes.mapKeyLoop}>
          <Icon name="cornerUpLeft" size={10} strokeWidth={2} />
        </span>
        loops back
      </li>
    </ul>
  );
}

function MapCanvas({
  layout,
  laidOut,
  actions,
}: {
  layout: MapLayout;
  laidOut: LaidOut;
  actions: MapActions;
}) {
  const scheme = useComputedColorScheme('light');
  const { ref, width } = useElementSize();
  const { nodes, edges } = useMemo(
    () => flowOf(layout, laidOut),
    [layout, laidOut]
  );
  const zoom =
    width > 0 && laidOut.width > 0
      ? Math.min(1, Math.max(MIN_ZOOM, width / laidOut.width))
      : 1;
  const x = width > 0 ? Math.max(0, (width - laidOut.width * zoom) / 2) : 0;
  return (
    <MapActionsContext.Provider value={actions}>
      <Box
        ref={ref}
        className={classes.mapCanvas}
        h={Math.ceil(laidOut.height * zoom)}
        data-testid="map-canvas"
      >
        <ReactFlow
          key={`${width}:${zoom}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={MAP_NODE_TYPES}
          edgeTypes={MAP_EDGE_TYPES}
          defaultViewport={{ x, y: 0, zoom }}
          minZoom={MIN_ZOOM}
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
    </MapActionsContext.Provider>
  );
}

export interface BlockMapProps {
  payload: BlocksPayload;
  graph: Graph;
  /** The open block's own node, drawn lit; null on a parent. */
  highlight: string | null;
  onSelect: (blockId: string) => void;
  onClose: () => void;
  engine?: () => Promise<LayoutEngine>;
}

/** A graph's blocks as a map: graph-only steps fold into dotted links,
    loops and long skips become jump pills. */
export function BlockMap({
  payload,
  graph,
  highlight,
  onSelect,
  onClose,
  engine,
}: BlockMapProps) {
  const fontsLoaded = useFontsLoaded();
  const map = useMemo(() => {
    const byId = new Map(payload.blocks.map(block => [block.id, block]));
    return blockMap(graph, blockId => {
      const block = byId.get(blockId);
      const kind = block?.kind;
      return {
        label: block ? labelOf(block) : blockId,
        kind: kind === 'question' || kind === 'gate' ? kind : ('step' as const),
      };
    });
  }, [payload, graph]);
  const blocks = map.nodes.filter(node => node.blockId !== null).length;

  const layout = useMemo(() => {
    if (blocks === 0) return null;
    const byId = new Map(payload.blocks.map(block => [block.id, block]));
    return mapLayout(map, graph, {
      dotsOf: blockId => {
        const block = byId.get(blockId);
        return block ? dotsOf(block) : [];
      },
      measure: measureText,
    });
    // fontsLoaded only re-runs the layout; measureText reads the fonts itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, graph, payload, blocks, fontsLoaded]);
  const { state, laidOut, retry } = useGraphLayout(
    layout?.input ?? null,
    engine
  );

  const actions = useMemo<MapActions>(() => {
    const skill = skillOf(graph);
    const labels = new Map(graph.nodes.map(node => [node.id, node.label]));
    return {
      select: onSelect,
      jump: () => {},
      highlight,
      questionOf: id => shortLabel(labels.get(id) ?? id, skill),
    };
  }, [graph, highlight, onSelect]);

  return (
    <section
      className={classes.map}
      aria-label="Block map"
      data-testid="block-map"
    >
      <div className={classes.mapHead}>
        <Text fz={15} fw={600} lh="normal" c="var(--tk-text-1)">
          Block map
        </Text>
        <Text fz={13} lh="normal" c="dimmed">
          {`${blocks} blocks · ${map.foldedSteps} steps folded`}
        </Text>
        <UnstyledButton className={classes.mapClose} onClick={onClose}>
          Close
        </UnstyledButton>
      </div>
      {layout === null ? (
        <Text fz={13} c="dimmed" className={classes.mapNote}>
          No blocks here
        </Text>
      ) : state === 'error' ? (
        <div className={classes.mapNote} role="alert">
          <Text fz={13} c="dimmed">
            The graph didn&apos;t lay out
          </Text>
          <UnstyledButton className={classes.graphLink} onClick={retry}>
            Retry
          </UnstyledButton>
        </div>
      ) : state === 'loading' || !laidOut ? (
        <Skeleton
          h={320}
          radius={12}
          data-testid="map-loading"
          aria-label="Laying out the map"
        />
      ) : (
        <MapCanvas layout={layout} laidOut={laidOut} actions={actions} />
      )}
      {layout !== null && <MapKey />}
    </section>
  );
}
