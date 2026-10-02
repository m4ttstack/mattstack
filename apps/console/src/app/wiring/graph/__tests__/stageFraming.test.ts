// @vitest-environment node
import type { Viewport } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import {
  COLUMN_TOP,
  frameStage,
  HEADER_GAP,
  HEADER_ROOM,
  headingDetail,
  MIN_FRAME_ZOOM,
  OFF_STAGE_SHARE,
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

/** Where a drag to each limit leaves the graph's left and top edges, in
    stage px, for a graph whose bounds start at the layout's origin. */
function limits(
  { extent, viewport: { zoom } }: { extent: number[][]; viewport: Viewport },
  stage: { width: number; height: number }
) {
  const [[minX, minY], [maxX, maxY]] = extent;
  return {
    leftmost: stage.width - maxX * zoom,
    rightmost: -minX * zoom,
    highest: stage.height - maxY * zoom,
    lowest: -minY * zoom,
  };
}

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
  it('centres a graph that fits, HEADER_ROOM under the top when there is room', () => {
    for (const [right, bottom] of [
      [STEP_RIGHT, 324],
      [LINKS_RIGHT, 653],
    ] as const) {
      const framing = frameStage(BOARD_STAGE, { right, bottom });
      expect(framing.viewport.zoom).toBe(1);
      expect(framing.viewport.x).toBeCloseTo((BOARD_STAGE.width - right) / 2);
      expect(headingsTop(framing)).toBe(HEADER_ROOM);
      // The graph fits, so a drag can carry only OFF_STAGE_SHARE of it off
      // any edge of the stage.
      const at = limits(framing, BOARD_STAGE);
      expect(at.leftmost).toBeCloseTo(-OFF_STAGE_SHARE * right);
      expect(at.rightmost + right).toBeCloseTo(
        BOARD_STAGE.width + OFF_STAGE_SHARE * right
      );
      expect(at.highest).toBeCloseTo(-OFF_STAGE_SHARE * bottom);
      expect(at.lowest + bottom).toBeCloseTo(
        BOARD_STAGE.height + OFF_STAGE_SHARE * bottom
      );
    }
  });

  it('lets a tall template scroll at the boards zoom rather than shrink', () => {
    const layout = layoutTemplate(placeholderView(30));
    expect(layout.height).toBeGreaterThan(1400);

    const framing = frameStage(BOARD_STAGE, {
      right: STEP_RIGHT,
      bottom: layout.height,
    });

    expect(framing.viewport.zoom).toBe(1);
    // No room to spare, so the headings start HEADER_GAP down.
    expect(headingsTop(framing)).toBe(HEADER_GAP);
    // Taller than the stage, it scrolls to either end and then only
    // OFF_STAGE_SHARE of its height past it.
    const at = limits(framing, BOARD_STAGE);
    expect(at.highest + layout.height).toBeCloseTo(
      BOARD_STAGE.height - OFF_STAGE_SHARE * layout.height
    );
    expect(at.lowest).toBeCloseTo(OFF_STAGE_SHARE * layout.height);
  });

  it('zooms a wide graph out to the stage width on a narrow stage', () => {
    const framing = frameStage(
      { width: 1008, height: 712 },
      { right: STEP_RIGHT, bottom: 324 }
    );

    const zoom = framing.viewport.zoom;
    expect(zoom).toBeCloseTo((1008 - 24) / STEP_RIGHT, 5);
    expect(framing.viewport.x).toBeCloseTo((1008 - STEP_RIGHT * zoom) / 2);
    expect(headingsTop(framing)).toBe(HEADER_ROOM);
  });

  it('scrolls a graph wider than the stage to either end, then only its share past it', () => {
    const framing = frameStage(
      { width: 600, height: 712 },
      { right: STEP_RIGHT, bottom: 324 }
    );

    const width = STEP_RIGHT * framing.viewport.zoom;
    const at = limits(framing, { width: 600, height: 712 });
    expect(at.leftmost + width).toBeCloseTo(600 - OFF_STAGE_SHARE * width);
    expect(at.rightmost).toBeCloseTo(OFF_STAGE_SHARE * width);
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

      expect(framing.viewport.x).toBe(-110);
      expect(framing.viewport.zoom).toBe(1);
      // Wider than the stage left of the drawer, the graph scrolls to its
      // right edge there and then only its share past it.
      const at = limits(framing, BOARD_STAGE);
      expect(at.leftmost + right).toBeCloseTo(
        BOARD_STAGE.width - 600 - OFF_STAGE_SHARE * right
      );
      expect(at.rightmost).toBeCloseTo(OFF_STAGE_SHARE * right);
      // The framed viewport sits inside its extent, so React Flow keeps it.
      expect(at.leftmost).toBeLessThanOrEqual(-110);
      expect(at.rightmost).toBeGreaterThanOrEqual(-110);
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
  it('keeps HEADER_GAP under the header when the stage has no room to spare', () => {
    const framing = frameStage(
      { width: 1408, height: 500 },
      { right: STEP_RIGHT, bottom: 324 },
      { headerBottom: 90 }
    );

    expect(headingsTop(framing)).toBe(90 + HEADER_GAP);
  });

  it('starts the headings half the spare room below the header, up to HEADER_ROOM', () => {
    const framing = frameStage(
      { width: 1408, height: 700 },
      { right: STEP_RIGHT, bottom: 324 },
      { headerBottom: 90 }
    );

    expect(headingsTop(framing)).toBe(90 + (700 - 90 - (324 + 52)) / 2);
  });

  it('starts the column headings below a header that wraps', () => {
    const framing = frameStage(
      BOARD_STAGE,
      { right: STEP_RIGHT, bottom: 324 },
      { headerBottom: 90 }
    );

    expect(headingsTop(framing)).toBe(90 + HEADER_ROOM);
    expect(framing.viewport.y).toBe(90 + HEADER_ROOM + 52);
    // Dragged up, only its share of the graph goes under the header.
    expect(limits(framing, BOARD_STAGE).highest).toBeCloseTo(
      90 - OFF_STAGE_SHARE * 324
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
