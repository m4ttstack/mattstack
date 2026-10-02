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
/** Room under the graph's last row: the zoom controls' corner, 96px of
    buttons on a 32px margin. */
const BOTTOM_ROOM = 136;

/** Space between the focus header and the column headings under it. */
export const HEADER_GAP = 6;

/** The template's right edge with the handles on it, in layout units: what a
    drawer over the stage's right edge leaves in view. */
const TEMPLATE_RIGHT = LAYOUT.templateX + LAYOUT.templateW + 4;

export type FramingOptions = {
  /** Width of the stage's right edge a drawer covers, in stage px. */
  cover?: number;
  /** The focus header's bottom, in stage px. */
  headerBottom?: number;
};

export type Framing = {
  viewport: Viewport;
  /** Where the viewport may travel, in layout units: the board's corner, and
      the graph's width and height plus their room. */
  extent: CoordinateExtent;
  /** The stage y the framed graph starts at, the column headings' top.
      Content that scrolls above it would run under the focus header. */
  contentTop: number;
};

/** The viewport x that keeps the template clear of a drawer covering `cover`
    px of the stage, never right of the boards' corner. */
export function panFor(stageWidth: number, zoom: number, cover: number) {
  return Math.min(0, stageWidth - cover - RIGHT_ROOM - TEMPLATE_RIGHT * zoom);
}

/** Where a viewport framed at `viewport` may travel: up to the framed top,
    and far enough right to bring the graph out from under a drawer. */
export function extentFor(
  stage: { width: number; height: number },
  graph: { right: number; bottom: number },
  viewport: Viewport,
  cover = 0
): CoordinateExtent {
  const { x, y, zoom } = viewport;
  const top = -y / zoom;
  return [
    [0, top],
    [
      Math.max(
        graph.right + (RIGHT_ROOM + cover) / zoom,
        (stage.width - x) / zoom
      ),
      Math.max(graph.bottom + BOTTOM_ROOM / zoom, top + stage.height / zoom),
    ],
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
  graph: { right: number; bottom: number },
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
    extent: extentFor(stage, graph, viewport, cover),
    contentTop: y + COLUMN_TOP * zoom,
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
