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

export type Framing = {
  viewport: Viewport;
  /** Where the viewport may travel, in layout units: the board's corner, and
      the graph's width and height plus their room. */
  extent: CoordinateExtent;
  /** The stage y the framed graph starts at, the column headings' top.
      Content that scrolls above it would run under the focus header. */
  contentTop: number;
};

/**
 * The boards' framing when the graph fits the stage's width at zoom 1, else
 * the same corner zoomed out to fit that width, never below
 * `MIN_FRAME_ZOOM`. Height never shrinks the graph: a tall one scrolls.
 */
export function frameStage(
  stage: { width: number; height: number },
  graph: { right: number; bottom: number }
): Framing {
  const zoom = Math.min(
    1,
    Math.max(MIN_FRAME_ZOOM, (stage.width - RIGHT_ROOM) / graph.right)
  );
  const top = -BOARD_VIEWPORT.y / zoom;
  return {
    viewport: { ...BOARD_VIEWPORT, zoom },
    extent: [
      [0, top],
      [
        Math.max(graph.right + RIGHT_ROOM / zoom, stage.width / zoom),
        Math.max(graph.bottom + BOTTOM_ROOM / zoom, top + stage.height / zoom),
      ],
    ],
    contentTop: BOARD_VIEWPORT.y + COLUMN_TOP * zoom,
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
