// @vitest-environment node
import type { Viewport } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import {
  BOARD_VIEWPORT,
  COLUMN_TOP,
  frameStage,
  HEADER_GAP,
  headingDetail,
  KEEP_IN_VIEW,
  MIN_FRAME_ZOOM,
  panFor,
} from '../layout/stageFraming';
import { LAYOUT, layoutTemplate } from '../layout/templateLayout';
import {
  buildTemplateView,
  type InputCard,
  type TemplateRow,
  type TemplateView,
} from '../model/templateModel';
import { designFixture } from './designFixtures';

/** The stage y the column headings start at. */
const headingsTop = ({ viewport }: { viewport: Viewport }) =>
  viewport.y + COLUMN_TOP * viewport.zoom;

/** The design boards' stage, 1408 wide, at the app's page-row height. */
const BOARD_STAGE = { width: 1408, height: 952 };
/** The right edge of a step view's output card and of a pipeline's links. */
const STEP_RIGHT = LAYOUT.rightX + LAYOUT.outputW;
const LINKS_RIGHT = LAYOUT.rightX + LAYOUT.rightW;

const planView = () =>
  buildTemplateView({
    anatomy: designFixture('anatomy.stage-plan'),
    composition: designFixture('composition'),
    check: designFixture('check'),
    changes: designFixture('changes.clean'),
    step: 2,
  });

/** A step template with `count` placeholders, each between two text rows. */
function placeholderView(count: number): TemplateView {
  const base = planView();
  const placeholder = base.rows.find(row => row.kind === 'placeholder')!;
  const text = base.rows.find(row => row.kind === 'text')!;
  const card = base.inputs[0]!;
  const rows: TemplateRow[] = [];
  const inputs: InputCard[] = [];
  for (let i = 0; i < count; i++) {
    const line = i * 4 + 1;
    rows.push({ ...text, id: String(line), line });
    rows.push({ ...placeholder, id: String(line + 3), line: line + 3 });
    inputs.push({ ...card, id: `slot:s${i}`, rowId: String(line + 3) });
  }
  return { ...base, rows, inputs };
}

describe('frameStage', () => {
  it('keeps the boards framing for both board views', () => {
    for (const [right, bottom] of [
      [STEP_RIGHT, 324],
      [LINKS_RIGHT, 653],
    ] as const) {
      const framing = frameStage(BOARD_STAGE, { right, bottom });
      expect(framing.viewport).toEqual(BOARD_VIEWPORT);
      expect(headingsTop(framing)).toBe(72);
      // A drag carries the graph until only KEEP_IN_VIEW of it is left on
      // the stage, the same distance each way.
      expect(framing.extent).toEqual([
        [
          -(BOARD_STAGE.width - KEEP_IN_VIEW),
          -(BOARD_STAGE.height - KEEP_IN_VIEW),
        ],
        [
          right + BOARD_STAGE.width - KEEP_IN_VIEW,
          bottom + BOARD_STAGE.height - KEEP_IN_VIEW,
        ],
      ]);
    }
  });

  it('lets a tall template scroll at the boards zoom rather than shrink', () => {
    const layout = layoutTemplate(placeholderView(30));
    expect(layout.height).toBeGreaterThan(1400);

    const framing = frameStage(BOARD_STAGE, {
      right: STEP_RIGHT,
      bottom: layout.height,
    });

    expect(framing.viewport).toEqual(BOARD_VIEWPORT);
    // Scrolled to its end, KEEP_IN_VIEW of the graph is still on the stage.
    expect(framing.extent[1][1]).toBe(
      layout.height + BOARD_STAGE.height - KEEP_IN_VIEW
    );
  });

  it('zooms a wide graph out to the stage width on a narrow stage', () => {
    const framing = frameStage(
      { width: 1008, height: 712 },
      { right: STEP_RIGHT, bottom: 324 }
    );

    expect(framing.viewport.x).toBe(0);
    expect(framing.viewport.y).toBe(124);
    expect(framing.viewport.zoom).toBeCloseTo((1008 - 24) / STEP_RIGHT, 5);
    expect(headingsTop(framing)).toBeCloseTo(124 - 52 * framing.viewport.zoom);
  });

  it('measures the drag room in stage px at any zoom', () => {
    const framing = frameStage(
      { width: 600, height: 712 },
      { right: STEP_RIGHT, bottom: 324 }
    );

    const zoom = framing.viewport.zoom;
    expect(framing.extent[0][0]).toBeCloseTo(-(600 - KEEP_IN_VIEW) / zoom);
    expect(framing.extent[1][0]).toBeCloseTo(
      STEP_RIGHT + (600 - KEEP_IN_VIEW) / zoom
    );
  });

  it('never frames below a readable zoom, and leaves the rest to scroll', () => {
    const framing = frameStage(
      { width: 600, height: 712 },
      { right: STEP_RIGHT, bottom: 324 }
    );

    expect(framing.viewport.zoom).toBe(MIN_FRAME_ZOOM);
    // No drawer, so the input column stays on the stage.
    expect(framing.viewport.x).toBe(0);
    const [[minX], [maxX]] = framing.extent;
    expect(maxX - minX).toBeGreaterThan(600 / MIN_FRAME_ZOOM);
  });
});

describe('frameStage under a drawer', () => {
  it('pans the template clear of a drawer over the stage, as the drawer boards do', () => {
    for (const right of [STEP_RIGHT, LINKS_RIGHT]) {
      const framing = frameStage(
        BOARD_STAGE,
        { right, bottom: 653 },
        { cover: 600 }
      );

      expect(framing.viewport).toEqual({ x: -110, y: 124, zoom: 1 });
      const [[minX], [maxX]] = framing.extent;
      // Dragged right, the graph stops KEEP_IN_VIEW short of the drawer.
      expect(minX).toBe(-(BOARD_STAGE.width - 600 - KEEP_IN_VIEW));
      // The viewport sits inside its extent, so React Flow keeps the pan.
      expect(maxX).toBeGreaterThanOrEqual(110 + BOARD_STAGE.width);
    }
  });

  it('leaves a stage wide enough for the template and the drawer unpanned', () => {
    const framing = frameStage(
      { width: 2000, height: 952 },
      { right: LINKS_RIGHT, bottom: 653 },
      { cover: 600 }
    );

    expect(framing.viewport.x).toBe(0);
  });

  it('pans by the zoom the viewer is at', () => {
    expect(panFor(1408, 1, 600)).toBe(-110);
    expect(panFor(1408, 1, 0)).toBe(0);
    expect(panFor(600, MIN_FRAME_ZOOM, 0)).toBe(0);
    expect(panFor(1100, 0.8, 600)).toBeCloseTo(1100 - 600 - 24 - 894 * 0.8);
  });
});

describe('frameStage under the focus header', () => {
  it('keeps the boards framing under a one-line description', () => {
    const framing = frameStage(
      BOARD_STAGE,
      { right: STEP_RIGHT, bottom: 324 },
      { headerBottom: 72 - HEADER_GAP }
    );

    expect(framing.viewport).toEqual(BOARD_VIEWPORT);
    expect(headingsTop(framing)).toBe(72);
  });

  it('starts the column headings below a header that wraps', () => {
    const framing = frameStage(
      BOARD_STAGE,
      { right: STEP_RIGHT, bottom: 324 },
      { headerBottom: 90 }
    );

    expect(headingsTop(framing)).toBe(90 + HEADER_GAP);
    expect(framing.viewport.y).toBe(90 + HEADER_GAP + 52);
    // Dragged up, the graph stops KEEP_IN_VIEW below the header.
    expect(framing.extent[1][1]).toBe(
      324 + BOARD_STAGE.height - 90 - KEEP_IN_VIEW
    );
  });
});

describe('headingDetail', () => {
  it('shows the full headings at every zoom a framing picks', () => {
    expect(headingDetail(1)).toBe('full');
    expect(headingDetail(MIN_FRAME_ZOOM)).toBe('full');
  });

  it('drops the subtitles, then the titles, as the columns close up', () => {
    expect(headingDetail(0.5)).toBe('titles');
    expect(headingDetail(0.26)).toBe('titles');
    expect(headingDetail(0.25)).toBe('none');
  });
});
