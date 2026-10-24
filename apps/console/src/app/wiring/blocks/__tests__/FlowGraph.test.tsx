import '../../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EveryStep, FlowGraph } from '../FlowGraph';
import { measureText } from '../graphCards';
import { bundledEngine } from '../layoutEngine';
import { aroundBlock } from '../model/around';
import { labelledGraph } from '../model/blockView';
import type { Box, LaidOut } from '../model/elkGraph';
import { flowLayout, LABEL_REACH, placeLabels } from '../model/flowLayout';
import { fitZoom } from '../model/mapLayout';
import { shipPayload } from './blocksFixture';
import { labelClashes, strayLabels } from './flowGeometry';

const canvas = vi.hoisted(() => ({ width: 0 }));

vi.mock('@mattstack/app-kit/hooks', async importOriginal => ({
  ...(await importOriginal<typeof import('@mattstack/app-kit/hooks')>()),
  useElementSize: () => ({
    ref: { current: null },
    width: canvas.width,
    height: 0,
  }),
}));

const shared = bundledEngine();
const engine = () => Promise.resolve(shared);
const LAID_OUT = { timeout: 15_000 };

const ship = labelledGraph(
  shipPayload,
  shipPayload.graphs.find(each => each.blockId === 'ship/flow')!
);
const FAST_CHECKS = 'domain_fast_checks';
const around = aroundBlock(ship, FAST_CHECKS);

const CASES = [
  { name: 'ship Every step', graph: ship, focus: null },
  { name: 'Around Fast checks', graph: around, focus: FAST_CHECKS },
] as const;
const WIDTHS = [560, 1100];

async function laidOutFor(
  graph: (typeof CASES)[number]['graph'],
  focus: string | null
): Promise<LaidOut> {
  const layout = flowLayout(graph, {
    skill: 'ship',
    focus,
    factsOf: () => ({ kind: 'step', dots: [] }),
    measure: measureText,
  });
  return placeLabels(await shared.layout(layout.input));
}

const chipBox = (chip: HTMLElement): Box => ({
  x: parseFloat(chip.style.getPropertyValue('--chip-x')),
  y: parseFloat(chip.style.getPropertyValue('--chip-y')),
  width: parseFloat(chip.style.getPropertyValue('--chip-w')),
  height: 16,
});

const key = (box: Box) => `${box.x},${box.y},${box.width}`;

/** The chips the canvas draws at `width`, which must be the laid-out label
    boxes, and that laid-out graph. */
async function drawnAt(
  width: number,
  graph: (typeof CASES)[number]['graph'],
  focus: string | null
): Promise<LaidOut> {
  canvas.width = width;
  const view = renderWithProviders(
    <FlowGraph
      graph={graph}
      skill="ship"
      focus={focus}
      onSelect={() => {}}
      engine={engine}
    />
  );
  const flow = await screen.findByTestId('flow-canvas', {}, LAID_OUT);
  const laidOut = await laidOutFor(graph, focus);
  expect(Number(flow.getAttribute('data-zoom'))).toBe(
    fitZoom(width, laidOut.width)
  );
  const labels = Object.values(laidOut.edges).flatMap(edge =>
    edge.label ? [key(edge.label)] : []
  );
  expect(labels.length).toBeGreaterThan(0);
  expect(
    screen
      .getAllByTestId('map-chip')
      .map(chip => key(chipBox(chip)))
      .sort()
  ).toEqual(labels.sort());
  view.unmount();
  return laidOut;
}

describe('FlowGraph', () => {
  it('Every step draws every node of the graph', async () => {
    renderWithProviders(
      <EveryStep
        payload={shipPayload}
        graph={ship}
        highlight={null}
        onSelect={() => {}}
        onView={() => {}}
        onClose={() => {}}
        engine={engine}
      />
    );

    await screen.findByTestId('flow-canvas', {}, LAID_OUT);
    const blocks = screen.getAllByTestId('map-card');
    const steps = screen.getAllByTestId('flow-step');
    expect(blocks.length + steps.length).toBe(ship.nodes.length);
    expect(blocks).toHaveLength(
      ship.nodes.filter(node => node.blockId !== null).length
    );
    expect(screen.getAllByTestId('map-edge')).toHaveLength(ship.edges.length);
    expect(
      screen.getByText(`${ship.nodes.length} steps · ${blocks.length} blocks`)
    ).toBeInTheDocument();
  }, 30_000);

  it('opens a block from its card, and lights the focus', async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <FlowGraph
        graph={around}
        payload={shipPayload}
        skill="ship"
        focus={FAST_CHECKS}
        onSelect={onSelect}
        engine={engine}
      />
    );

    const focus = await screen.findByRole(
      'button',
      { name: 'Fast checks' },
      LAID_OUT
    );
    expect(focus).toHaveAttribute('data-hot', 'true');
    fireEvent.click(focus);
    expect(onSelect).toHaveBeenCalledWith('ship/flow/domain-fast-checks');
  }, 20_000);

  describe.each(CASES)('$name', ({ graph, focus }) => {
    it.each(WIDTHS)(
      "no edge label overlaps another edge's line or any card, at %ipx",
      async width => {
        const laidOut = await drawnAt(width, graph, focus);
        expect(labelClashes(laidOut)).toEqual([]);
      },
      30_000
    );

    it.each(WIDTHS)(
      `every edge label sits within ${LABEL_REACH}px of its own edge's start or first bend, at %ipx`,
      async width => {
        const laidOut = await drawnAt(width, graph, focus);
        expect(strayLabels(laidOut, 40)).toEqual([]);
      },
      30_000
    );
  });
});
