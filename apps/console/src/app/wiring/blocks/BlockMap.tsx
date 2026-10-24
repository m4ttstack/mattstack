import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, UnstyledButton } from '@mattstack/app-kit/core';
import { useReducedMotion } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import type { NodeTypes } from '@xyflow/react';

import type { BlocksPayload } from '../../../server/blocksPayload';
import type { BlockGraphSelect } from '../graph/useWiringUrl';
import classes from './blocks.module.css';
import {
  BAND_NODE_TYPES,
  RING_MS,
  type BandFlowNode,
  type BandStepFlowNode,
} from './FoldBand';
import {
  edgesOf,
  GraphCanvas,
  GraphError,
  GraphHead,
  GraphLoading,
  handlesAt,
  useCanvasLayout,
  useCanvasPlane,
} from './graphCanvas';
import {
  MAP_NODE_TYPES,
  MapActionsContext,
  measureText,
  useFontsLoaded,
  type JunctionFlowNode,
  type MapActions,
  type MapFlowNode,
} from './graphCards';
import type { MapFlowEdge } from './graphEdges';
import { openBand, type BandedLayout } from './model/bandLayout';
import { dotsOf, labelOf } from './model/blockFacts';
import { blockMap, type MapKind } from './model/blockMap';
import type { LaidOut, LayoutEngine } from './model/elkGraph';
import { foldBand } from './model/foldBand';
import { shortLabel } from './model/labels';
import { mapFocus, type MapHover } from './model/mapFocus';
import { mapLayout, skillOf } from './model/mapLayout';

type Graph = BlocksPayload['graphs'][number];

type FlowNode =
  MapFlowNode | JunctionFlowNode | BandFlowNode | BandStepFlowNode;

const NODE_TYPES: NodeTypes = { ...MAP_NODE_TYPES, ...BAND_NODE_TYPES };

function flowOf(
  layout: BandedLayout,
  laidOut: LaidOut
): { nodes: FlowNode[]; edges: MapFlowEdge[] } {
  const nodes: FlowNode[] = [];
  const band = layout.band;
  const frame = band ? laidOut.nodes[band.id] : undefined;
  if (band && frame) {
    // Behind the edges, so the lines into and inside the band stay drawn.
    nodes.push({
      id: band.id,
      type: 'band',
      position: { x: frame.x, y: frame.y },
      width: frame.width,
      height: frame.height,
      zIndex: -1,
      data: { band },
    });
    for (const box of band.boxes) {
      const placed = laidOut.nodes[box.node.id];
      if (!placed) continue;
      nodes.push({
        id: box.node.id,
        type: 'bandStep',
        position: { x: placed.x, y: placed.y },
        width: placed.width,
        height: placed.height,
        handles: handlesAt(box.width / 2, placed.height),
        data: { box },
      });
    }
  }
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
  return { nodes, edges: edgesOf(layout.edges, laidOut) };
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
        <span className={classes.mapDot} data-layer="org" />
        org base adds
      </li>
      <li>
        <span className={classes.mapDot} data-layer="team" />
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
  layout: BandedLayout;
  laidOut: LaidOut;
  actions: MapActions;
}) {
  const canvas = useCanvasPlane(laidOut.width);
  const { nodes, edges } = useMemo(
    () => flowOf(layout, laidOut),
    [layout, laidOut]
  );
  return (
    <MapActionsContext.Provider value={actions}>
      <GraphCanvas
        canvas={canvas}
        laidOut={laidOut}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        testId="map-canvas"
      />
    </MapActionsContext.Provider>
  );
}

export interface BlockMapProps {
  payload: BlocksPayload;
  graph: Graph;
  /** The open block's own node, drawn lit; null on a parent. */
  highlight: string | null;
  onSelect: (blockId: string) => void;
  onView: (view: BlockGraphSelect) => void;
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
  onView,
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

  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<MapHover>(null);
  const [jumped, setJumped] = useState<{
    targets: string[];
    from: string;
    /** Back's target once `from`, a band step, has folded away. */
    fallback: string | null;
    fromLabel: string;
    ring: boolean;
  } | null>(null);
  const reduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  /** Where focus goes once the layout that holds it has drawn. */
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const selector = pendingFocus.current;
    if (!selector) return;
    const target = sectionRef.current?.querySelector<HTMLElement>(selector);
    if (!target) return;
    pendingFocus.current = null;
    target.focus({ preventScroll: true });
  });

  const banded = useMemo(() => {
    if (!layout) return null;
    const link = open ? map.links.find(each => each.id === open) : undefined;
    return link
      ? openBand(layout, map, graph, link, measureText)
      : { ...layout, band: null };
  }, [layout, open, map, graph]);
  const { state, laidOut, shown, retry } = useCanvasLayout<BandedLayout>(
    banded,
    engine
  );
  const stepsOf = useMemo(
    () =>
      new Map(
        map.links.map(link => [link.id, foldBand(graph, link, map).nodes])
      ),
    [graph, map]
  );

  useEffect(() => {
    if (!jumped?.ring) return;
    const timer = setTimeout(
      () => setJumped(now => now && { ...now, ring: false }),
      RING_MS
    );
    return () => clearTimeout(timer);
  }, [jumped]);

  const actions = useMemo<MapActions>(() => {
    const skill = skillOf(graph);
    const labels = new Map(graph.nodes.map(node => [node.id, node.label]));
    const questionOf = (id: string) => shortLabel(labels.get(id) ?? id, skill);
    const kinds = new Map(map.nodes.map(node => [node.id, node]));
    const nameOf = (id: string) => {
      const node = kinds.get(id);
      return node && node.kind !== 'split' ? node.label : questionOf(id);
    };
    const focus = shown
      ? mapFocus(shown, map, hover)
      : {
          hotEdges: new Set<string>(),
          litNodes: null,
          opens: new Map(),
          buttons: new Map(),
        };
    const nodeAt = (id: string) =>
      sectionRef.current?.querySelector<HTMLElement>(`[data-node="${id}"]`);
    const scrollTo = (element: HTMLElement | null | undefined) => {
      element?.scrollIntoView({
        behavior: reduceMotion ? 'instant' : 'smooth',
        block: 'center',
        inline: 'center',
      });
    };
    const inBand = (id: string) =>
      shown?.band?.boxes.some(box => box.node.id === id) ?? false;
    return {
      select: onSelect,
      jump: (targets, from, fromLabel) => {
        scrollTo(nodeAt(targets[0]!));
        setJumped({
          targets,
          from,
          fallback: inBand(from) ? shown!.band!.link.from : null,
          fromLabel,
          ring: true,
        });
      },
      highlight,
      questionOf,
      hover: setHover,
      open: id => {
        setHover(null);
        pendingFocus.current = `[data-testid="fold-band"][data-link="${id}"] [data-fold]`;
        setOpen(id);
      },
      fold: () => {
        if (open) {
          pendingFocus.current = `[data-testid="map-link"][data-link="${open}"]`;
        }
        setOpen(null);
      },
      nodeView: id => ({
        hot: id === highlight || (hover?.kind === 'node' && hover.id === id),
        dim: focus.litNodes !== null && !focus.litNodes.has(id),
        ring: !!jumped?.ring && jumped.targets.includes(id),
        from:
          jumped && jumped.targets[0] === id
            ? {
                label: jumped.fromLabel,
                onBack: () => {
                  const source =
                    nodeAt(jumped.from) ??
                    (jumped.fallback ? nodeAt(jumped.fallback) : null);
                  scrollTo(source);
                  source
                    ?.querySelector<HTMLElement>('button')
                    ?.focus({ preventScroll: true });
                  setJumped(null);
                },
              }
            : null,
        jumped: jumped && jumped.from === id ? jumped.targets : null,
      }),
      edgeView: id => {
        const hot = focus.hotEdges.has(id);
        const link = focus.opens.get(id) ?? null;
        const button = link !== null && focus.buttons.get(link) === id;
        return {
          hot,
          dim: focus.litNodes !== null && !hot,
          link,
          button,
          tip: button && hover?.kind === 'link' && hover.id === link,
        };
      },
      linkInfo: id => {
        const link = map.links.find(each => each.id === id);
        if (!link) return null;
        const folded = stepsOf.get(id);
        if (!folded || folded.length === 0) return null;
        return {
          name: `Unfold ${folded.length} steps: ${nameOf(link.from)} to ${link.to.map(nameOf).join(', ')}`,
          steps: folded,
        };
      },
    };
  }, [
    graph,
    map,
    stepsOf,
    shown,
    open,
    hover,
    jumped,
    highlight,
    onSelect,
    reduceMotion,
  ]);

  return (
    <section
      ref={sectionRef}
      className={classes.map}
      aria-label="Block map"
      data-testid="block-map"
    >
      <GraphHead
        title="Block map"
        count={`${blocks} blocks · ${map.foldedSteps} steps folded`}
        view="graph"
        onView={onView}
        onClose={onClose}
      />
      {layout === null ? (
        <div className={classes.mapNote}>
          <Text fz={13} c="dimmed">
            No blocks here
          </Text>
          <UnstyledButton
            className={classes.graphLink}
            onClick={() => onView('graph-steps')}
          >
            See every step
          </UnstyledButton>
        </div>
      ) : state === 'error' ? (
        <GraphError onRetry={retry} />
      ) : laidOut && shown ? (
        <MapCanvas layout={shown} laidOut={laidOut} actions={actions} />
      ) : (
        <GraphLoading
          height={320}
          testId="map-loading"
          label="Laying out the map"
        />
      )}
      {layout !== null && <MapKey />}
    </section>
  );
}
