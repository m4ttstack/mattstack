import { describe, expect, it } from 'vitest';

import { graphOf } from '../__tests__/aroundFixtures';
import type { Box, LaidOut } from './elkGraph';
import {
  flowLayout,
  LABEL_REACH,
  placeLabels,
  scrollToShow,
  STEP,
  stepBadge,
} from './flowLayout';
import { canvasPlane } from './mapLayout';

const measure = (text: string, size: number) => text.length * size * 0.5;

describe('flowLayout', () => {
  const graph = graphOf(
    [
      ['start', 'Start', 'ellipse', null],
      ['check', 'Checks pass (ship)?', 'diamond', null],
      ['long', 'x'.repeat(80), 'plaintext', null],
      ['run', 'Run', 'box', 'ship/flow/run'],
      ['done', 'Done', 'doublecircle', null],
    ],
    [
      ['start', 'check'],
      ['check', 'run', 'yes: go on'],
      ['check', 'run', 'no'],
      ['run', 'long'],
      ['long', 'done'],
    ]
  );
  const layout = flowLayout(graph, { skill: 'ship', measure });
  const card = (id: string) => layout.cards.get(id)!;
  const chrome =
    2 * STEP.border + STEP.padLeft + STEP.badge + STEP.badgeGap + STEP.padRight;

  it('caps a step card at its longest label and titles it with the whole text', () => {
    expect(card('long').width).toBe(chrome + STEP.maxLabel);
    expect(card('long').title).toBe('x'.repeat(80));
    expect(card('start').width).toBe(chrome + measure('Start', 12));
    expect(card('start').title).toBeNull();
  });

  it("titles a step whose label drops the skill's name with the whole label", () => {
    expect(card('check')).toMatchObject({
      label: 'Checks pass?',
      title: 'Checks pass (ship)?',
    });
  });

  it('badges a question, an end and any other step', () => {
    expect(card('check').badge).toBe('question');
    expect(card('start').badge).toBe('step');
    expect(stepBadge({ shape: 'box', cls: 'done' })).toBe('end');
    expect(stepBadge({ shape: 'diamond', cls: null })).toBe('question');
    expect(card('run')).toMatchObject({ kind: 'block', badge: 'step' });
  });

  it('keeps two edges between the same nodes apart, labels cut at the colon', () => {
    const between = layout.edges.filter(
      edge => edge.from === 'check' && edge.to === 'run'
    );
    expect(between.map(edge => edge.id)).toEqual([
      'check->run#1',
      'check->run#2',
    ]);
    expect(between.map(edge => edge.label)).toEqual(['yes', 'no']);
  });

  it('feeds ELK in flow order: a given order wins over the graph’s own', () => {
    expect(layout.input.nodes.map(node => node.id)).toEqual([
      'start',
      'check',
      'run',
      'long',
      'done',
    ]);
    const given = flowLayout(graph, {
      measure,
      order: ['done', 'long', 'run', 'check', 'start'],
    });
    expect(given.input.nodes.map(node => node.id)).toEqual([
      'done',
      'long',
      'run',
      'check',
      'start',
    ]);
    expect(given.input.edges.map(edge => edge.source)).toEqual([
      'long',
      'run',
      'check',
      'check',
      'start',
    ]);
  });
});

const box = (x: number, y: number, width = 40, height = 16): Box => ({
  x,
  y,
  width,
  height,
});

function laid(
  edges: LaidOut['edges'],
  nodes: Record<string, Box> = {}
): LaidOut {
  return { width: 600, height: 400, nodes, edges };
}

describe('placeLabels', () => {
  it("keeps ELK's spot when it is near the start and clear, even 2px from its own line", () => {
    const label = box(102, 120);
    const out = placeLabels(
      laid(
        {
          a: {
            points: [
              [100, 100],
              [100, 200],
            ],
            label,
          },
        },
        { source: box(60, 60, 80, 40) }
      )
    );
    expect(out.edges.a!.label).toEqual(label);
  });

  it('moves a label that sits further than the reach from its start and first bend', () => {
    const out = placeLabels(
      laid({
        a: {
          points: [
            [100, 100],
            [100, 116],
            [300, 116],
            [300, 300],
          ],
          label: box(302, 250),
        },
      })
    );
    const moved = out.edges.a!.label!;
    const near = (x: number, y: number) =>
      Math.hypot(
        Math.max(moved.x - x, 0, x - (moved.x + moved.width)),
        Math.max(moved.y - y, 0, y - (moved.y + moved.height))
      );
    expect(Math.min(near(100, 100), near(100, 116))).toBeLessThanOrEqual(
      LABEL_REACH
    );
  });

  it('moves a label off another edge’s line', () => {
    const out = placeLabels(
      laid({
        a: {
          points: [
            [100, 100],
            [100, 200],
          ],
          label: box(102, 120),
        },
        b: {
          points: [
            [120, 50],
            [120, 300],
          ],
          label: null,
        },
      })
    );
    const moved = out.edges.a!.label!;
    expect(moved.x + moved.width <= 120 || moved.x >= 120).toBe(true);
  });

  it('prefers the side its edge turns to', () => {
    const right = placeLabels(
      laid({
        a: {
          points: [
            [100, 100],
            [100, 116],
            [300, 116],
            [300, 300],
          ],
          label: box(302, 250),
        },
      })
    ).edges.a!.label!;
    const left = placeLabels(
      laid({
        a: {
          points: [
            [300, 100],
            [300, 116],
            [100, 116],
            [100, 300],
          ],
          label: box(60, 250),
        },
      })
    ).edges.a!.label!;
    expect(right.x + right.width / 2).toBeGreaterThan(100);
    expect(left.x + left.width / 2).toBeLessThan(300);
  });
});

describe('canvasPlane', () => {
  it('never makes the plane wider than a fractional canvas a map fits', () => {
    const { zoom, plane, offset } = canvasPlane(730.6, 762);
    expect(plane).toBeLessThanOrEqual(730.6);
    expect(zoom).toBeCloseTo(730 / 762);
    expect(offset).toBeGreaterThanOrEqual(0);
  });

  it('centres a small map at full size and scrolls a wide one at the floor', () => {
    expect(canvasPlane(800, 400)).toEqual({ zoom: 1, plane: 800, offset: 200 });
    expect(canvasPlane(500, 1000)).toEqual({
      zoom: 0.85,
      plane: 850,
      offset: 0,
    });
  });
});

describe('scrollToShow', () => {
  it('centres the box, within the plane', () => {
    const at = { zoom: 1, offset: 0, visible: 400, plane: 2000 };
    expect(scrollToShow({ x: 1000, width: 100 }, at)).toBe(850);
    expect(scrollToShow({ x: 10, width: 100 }, at)).toBe(0);
    expect(scrollToShow({ x: 1950, width: 50 }, at)).toBe(1600);
  });
});
