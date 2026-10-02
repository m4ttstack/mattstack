import { useCallback, useEffect, useRef } from 'react';
import {
  useReactFlow,
  useStore,
  useStoreApi,
  type ReactFlowState,
} from '@xyflow/react';

import { extentFor, frameStage, panFor } from './layout/stageFraming';

/** Every node has its measured size. `useNodesInitialized` never turns true
    here: it reads sizes off the caller's nodes, and these are never written
    back, because the canvas takes no node changes. */
const allMeasured = (store: ReactFlowState) => {
  for (const node of store.nodeLookup.values())
    if (!node.measured.width || !node.measured.height) return false;
  return store.nodeLookup.size > 0;
};

export type StageShape = {
  /** Node ids and positions: what a refit follows. */
  geometry: string;
  /** Stage px a drawer covers at the stage's right edge. */
  cover: number;
  /** The focus header's bottom in stage px. */
  headerBottom: number;
};

/**
 * Frames the graph on the stage once its nodes are measured, and again when
 * the stage or the graph's shape changes; slides it clear of a drawer and
 * back. Returns the full framing, for a fit button. Runs inside React Flow.
 */
export function useStageFraming(
  { geometry, cover, headerBottom }: StageShape,
  onFramed: (contentTop: number) => void
): () => void {
  const { getNodes, getNodesBounds, getViewport, setViewport } = useReactFlow();
  const store = useStoreApi();
  const width = useStore(state => state.width);
  const height = useStore(state => state.height);
  const measured = useStore(allMeasured);
  const frameKey = `${geometry}|${width}x${height}|${headerBottom}`;
  const framed = useRef<{ key: string; y: number } | null>(null);
  /** How far left of the boards' corner a drawer has slid the graph. */
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
    shift.current = framing.viewport.x;
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

  return frame;
}
