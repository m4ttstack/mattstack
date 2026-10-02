// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  BOARD_VIEWPORT,
  frameStage,
  headingDetail,
  MIN_FRAME_ZOOM,
} from '../layout/stageFraming';
import { LAYOUT, layoutTemplate } from '../layout/templateLayout';
import {
  buildTemplateView,
  type InputCard,
  type TemplateRow,
  type TemplateView,
} from '../model/templateModel';
import { designFixture } from './designFixtures';

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
      expect(framing.contentTop).toBe(72);
      // No travel either way: the stage already shows the whole graph.
      expect(framing.extent).toEqual([
        [0, -124],
        [1408, 828],
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
    expect(framing.extent[0]).toEqual([0, -124]);
    expect(framing.extent[1]).toEqual([1408, layout.height + 136]);
  });

  it('zooms a wide graph out to the stage width on a narrow stage', () => {
    const framing = frameStage(
      { width: 1008, height: 712 },
      { right: STEP_RIGHT, bottom: 324 }
    );

    expect(framing.viewport.x).toBe(0);
    expect(framing.viewport.y).toBe(124);
    expect(framing.viewport.zoom).toBeCloseTo((1008 - 24) / STEP_RIGHT, 5);
    expect(framing.contentTop).toBeCloseTo(124 - 52 * framing.viewport.zoom);
  });

  it('never frames below a readable zoom, and leaves the rest to scroll', () => {
    const framing = frameStage(
      { width: 600, height: 712 },
      { right: STEP_RIGHT, bottom: 324 }
    );

    expect(framing.viewport.zoom).toBe(MIN_FRAME_ZOOM);
    const [[minX], [maxX]] = framing.extent;
    expect(maxX - minX).toBeGreaterThan(600 / MIN_FRAME_ZOOM);
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
