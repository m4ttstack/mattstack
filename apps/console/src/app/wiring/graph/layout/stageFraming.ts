import type { CoordinateExtent, Viewport } from '@xyflow/react';

import { LAYOUT } from './templateLayout';

/** The boards' framing: the layout's origin sits 124px down the stage at
    zoom 1, under the focus header and the column headings. */
export const BOARD_VIEWPORT: Viewport = { x: 0, y: 124, zoom: 1 };

/** The column headings' top, 52px above the template in layout units. */
export const COLUMN_TOP = -52;

/** The least zoom a framing picks on its own: 12px template code still reads
    at about 8px. Below it the graph keeps this zoom and scrolls. */
export const MIN_FRAME_ZOOM = 0.7;

/** Room right of the graph. */
const RIGHT_ROOM = 24;

/** Space between the focus header and the column headings under it. */
export const HEADER_GAP = 18;

/** Stage px of the graph a drag always leaves in view, on whichever side it
    is dragged off. */
export const KEEP_IN_VIEW = 160;

/** The template's right edge with the handles on it, in layout units: what a
    drawer over the stage's right edge leaves in view. */
const TEMPLATE_RIGHT = LAYOUT.templateX + LAYOUT.templateW + 4;

/** The graph's bounds in layout units; left and top default to the
    layout's origin. */
export type GraphBounds = {
  left?: number;
  top?: number;
  right: number;
  bottom: number;
};

export type FramingOptions = {
  /** Width of the stage's right edge a drawer covers, in stage px. */
  cover?: number;
  /** The focus header's bottom, in stage px. */
  headerBottom?: number;
};

export type Framing = {
  viewport: Viewport;
  /** Where the viewport may travel, in layout units. */
  extent: CoordinateExtent;
};

/** The viewport x that keeps the template clear of a drawer covering `cover`
    px of the stage, never right of the boards' corner. With no drawer the
    graph keeps the corner, so a narrow stage never hides its input column. */
export function panFor(stageWidth: number, zoom: number, cover: number) {
  if (cover <= 0) return 0;
  return Math.min(0, stageWidth - cover - RIGHT_ROOM - TEMPLATE_RIGHT * zoom);
}

/** Where the viewport may travel at `zoom`, in layout units: a drag carries
    the graph off any side of what the reader can see (the stage left of a
    drawer, under the focus header) until only `KEEP_IN_VIEW` of it is left
    on it. */
export function extentFor(
  stage: { width: number; height: number },
  { left = 0, top = 0, right, bottom }: GraphBounds,
  zoom: number,
  { cover = 0, headerBottom = 0 }: FramingOptions = {}
): CoordinateExtent {
  const seen = (px: number) => (px - KEEP_IN_VIEW) / zoom;
  return [
    [left - seen(stage.width - cover), top - seen(stage.height)],
    [right + seen(stage.width), bottom + seen(stage.height - headerBottom)],
  ];
}

/**
 * The boards' framing when the graph fits the stage's width at zoom 1, else
 * the same corner zoomed out to fit that width, never below
 * `MIN_FRAME_ZOOM`. Height never shrinks the graph: a tall one scrolls. A
 * drawer over the stage pans the template clear of it, and a focus header
 * taller than the boards' moves the graph down below it.
 */
export function frameStage(
  stage: { width: number; height: number },
  graph: GraphBounds,
  { cover = 0, headerBottom = 0 }: FramingOptions = {}
): Framing {
  const zoom = Math.min(
    1,
    Math.max(MIN_FRAME_ZOOM, (stage.width - RIGHT_ROOM) / graph.right)
  );
  const y = Math.max(
    BOARD_VIEWPORT.y,
    headerBottom + HEADER_GAP - COLUMN_TOP * zoom
  );
  const viewport = { x: panFor(stage.width, zoom, cover), y, zoom };
  return {
    viewport,
    extent: extentFor(stage, graph, zoom, { cover, headerBottom }),
  };
}

export type HeadingDetail = 'full' | 'titles' | 'none';

/** The narrowest pair of neighbouring columns, in layout units. */
const COLUMN_GAP = Math.min(
  LAYOUT.templateX - LAYOUT.inputX,
  LAYOUT.rightX - LAYOUT.templateX
);
/** The widest subtitle and title the headings print, with room to spare. */
const SUBTITLE_ROOM = 256;
const TITLE_ROOM = 108;

/** How much of the column headings fits between the columns at a zoom:
    they keep their size as the graph scales, so zoomed out they collide. */
export function headingDetail(zoom: number): HeadingDetail {
  if (COLUMN_GAP * zoom >= SUBTITLE_ROOM) return 'full';
  if (COLUMN_GAP * zoom >= TITLE_ROOM) return 'titles';
  return 'none';
}
