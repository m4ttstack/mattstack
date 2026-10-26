import { useCallback, useEffect, useRef } from 'react';
import {
  useReactFlow,
  useStore,
  useStoreApi,
  type ReactFlowState,
} from '@xyflow/react';

import { frameStage } from './layout/stageFraming';

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
  /** The focus header's bottom in stage px. */
  headerBottom: number;
};

/**
 * Frames the graph on the stage once its nodes are measured, and again when
 * the stage or the graph's shape changes. Runs inside React Flow.
 */
export function useStageFraming({ geometry, headerBottom }: StageShape): void {
  const { getNodes, getNodesBounds, setViewport } = useReactFlow();
  const store = useStoreApi();
  const width = useStore(state => state.width);
  const height = useStore(state => state.height);
  const measured = useStore(allMeasured);
  const frameKey = `${geometry}|${width}x${height}|${headerBottom}`;
  const framed = useRef<string | null>(null);

  const graph = useCallback(() => {
    const bounds = getNodesBounds(getNodes());
    return {
      left: bounds.x,
      top: bounds.y,
      right: bounds.x + bounds.width,
      bottom: bounds.y + bounds.height,
    };
  }, [getNodes, getNodesBounds]);

  const frame = useCallback(() => {
    if (!width || !height) return;
    const framing = frameStage({ width, height }, graph(), { headerBottom });
    store.getState().setTranslateExtent(framing.extent);
    void setViewport(framing.viewport);
    framed.current = frameKey;
  }, [width, height, graph, headerBottom, store, setViewport, frameKey]);

  // Nodes remeasure after every data refresh; a refit then would throw away
  // the reader's scroll and zoom.
  useEffect(() => {
    if (measured && framed.current !== frameKey) frame();
  }, [measured, frameKey, frame]);
}
