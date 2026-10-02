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

/** Least space between the focus header and the column headings under it. */
export const HEADER_GAP = 18;

/** Most space a framing leaves there: half of what the graph does not fill,
    up to this. */
export const HEADER_ROOM = 120;

/** The share of the graph a drag can carry past an edge of what the reader
    can see. A graph that fits keeps the rest in view; a bigger one scrolls
    to its far edge and then this share of its size past it. */
export const OFF_STAGE_SHARE = 0.12;

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

/** Where the viewport may travel at `zoom`, in layout units, holding the
    graph to what the reader can see (the stage left of a drawer, under the
    focus header) by `OFF_STAGE_SHARE`. */
export function extentFor(
  stage: { width: number; height: number },
  { left = 0, top = 0, right, bottom }: GraphBounds,
  zoom: number,
  { cover = 0, headerBottom = 0 }: FramingOptions = {}
): CoordinateExtent {
  const width = right - left;
  const height = bottom - top;
  // Stage px the graph is short of the visible width or height: positive
  // room it may cross, negative overflow it may scroll through.
  const spareX = stage.width - cover - width * zoom;
  const spareY = stage.height - headerBottom - height * zoom;
  return [
    [
      left - Math.max(spareX, 0) / zoom - OFF_STAGE_SHARE * width,
      top -
        (headerBottom + Math.max(spareY, 0)) / zoom -
        OFF_STAGE_SHARE * height,
    ],
    [
      left +
        (stage.width - Math.min(spareX, 0)) / zoom +
        OFF_STAGE_SHARE * width,
      top +
        (stage.height - headerBottom - Math.min(spareY, 0)) / zoom +
        OFF_STAGE_SHARE * height,
    ],
  ];
}

/**
 * Zoom 1 when the graph fits the stage's width, else zoomed out to fit it,
 * never below `MIN_FRAME_ZOOM`; height never shrinks the graph, so a tall one
 * scrolls. A graph that fits sits centred across the stage, its headings
 * half the spare height under the focus header (between `HEADER_GAP` and
 * `HEADER_ROOM`). A drawer over the stage pans the template clear of it.
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
  const left = graph.left ?? 0;
  const spareHeight =
    stage.height - headerBottom - (graph.bottom - COLUMN_TOP) * zoom;
  const gap = Math.min(HEADER_ROOM, Math.max(HEADER_GAP, spareHeight / 2));
  const centred = (stage.width - (graph.right - left) * zoom) / 2 - left * zoom;
  const viewport = {
    x: cover > 0 ? panFor(stage.width, zoom, cover) : Math.max(0, centred),
    y: headerBottom + gap - COLUMN_TOP * zoom,
    zoom,
  };
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
