import '../../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EveryStep, FlowGraph } from '../FlowGraph';
import { measureText } from '../graphCards';
import { bundledEngine } from '../layoutEngine';
import { aroundBlock, aroundOrder } from '../model/around';
import { flowOrder } from '../model/blockMap';
import { labelledGraph } from '../model/blockView';
import type { Box, LaidOut } from '../model/elkGraph';
import {
  blockFactsOf,
  flowLayout,
  LABEL_REACH,
  placeLabels,
  scrollToShow,
} from '../model/flowLayout';
import { canvasPlane } from '../model/mapLayout';
import { shipPayload } from './blocksFixture';
import { labelClashes, strayLabels } from './flowGeometry';

const canvas = vi.hoisted(() => ({ width: 0 }));

vi.mock('@mattstack/app-kit/hooks', async importOriginal => ({
  ...(await importOriginal<typeof import('@mattstack/app-kit/hooks')>()),
  useElementSize: () => ({
    ref: () => {},
    width: canvas.width,
    height: 0,
  }),
}));

const shared = bundledEngine();
const engine = () => Promise.resolve(shared);
// The whole ship graph lays out in-process here; CI's parallel turbo tasks
// can stretch one layout well past 15s.
const LAID_OUT = { timeout: 45_000 };

const ship = labelledGraph(
  shipPayload,
  shipPayload.graphs.find(each => each.blockId === 'ship/flow')!
);
const FAST_CHECKS = 'domain_fast_checks';
const around = aroundBlock(ship, FAST_CHECKS);
const shipOrder = flowOrder(ship);
const aroundFlow = aroundOrder(around, FAST_CHECKS, shipOrder);

type Case = {
  name: string;
  graph: typeof ship | typeof around;
  focus: string | null;
  order?: string[];
};
const CASES: Case[] = [
  { name: 'ship Every step', graph: ship, focus: null },
  {
    name: 'Around Fast checks',
    graph: around,
    focus: FAST_CHECKS,
    order: aroundFlow,
  },
];
const WIDTHS = [560, 1100];

async function laidOutFor({ graph, order }: Case): Promise<LaidOut> {
  const layout = flowLayout(graph, {
    skill: 'ship',
    factsOf: blockFactsOf(shipPayload),
    measure: measureText,
    order,
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
async function drawnAt(width: number, at: Case): Promise<LaidOut> {
  canvas.width = width;
  const view = renderWithProviders(
    <FlowGraph
      graph={at.graph}
      payload={shipPayload}
      skill="ship"
      focus={at.focus}
      order={at.order}
      onSelect={() => {}}
      engine={engine}
    />
  );
  const flow = await screen.findByTestId('flow-canvas', {}, LAID_OUT);
  const laidOut = await laidOutFor(at);
  expect(Number(flow.getAttribute('data-zoom'))).toBe(
    canvasPlane(width, laidOut.width).zoom
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
  }, 60_000);

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
      { name: /^Fast checks/ },
      LAID_OUT
    );
    expect(focus).toHaveAttribute('data-hot', 'true');
    fireEvent.click(focus);
    expect(onSelect).toHaveBeenCalledWith('ship/flow/domain-fast-checks');
  }, 20_000);

  it('puts the trigger in the top layer', async () => {
    const laidOut = await laidOutFor(CASES[0]!);
    const trigger = ship.nodes.find(node => node.shape === 'ellipse')!;
    const tops = Object.values(laidOut.nodes).map(box => box.y);

    expect(laidOut.nodes[trigger.id]!.y).toBe(Math.min(...tops));
    expect(
      Object.entries(laidOut.nodes).filter(
        ([, box]) => box.y < laidOut.nodes[trigger.id]!.y + 40
      )
    ).toHaveLength(1);
  }, 20_000);

  it('Around sets every step into the block above it', async () => {
    const laidOut = await laidOutFor(CASES[1]!);
    const into = around.edges
      .filter(edge => edge.to === FAST_CHECKS && edge.from !== FAST_CHECKS)
      .map(edge => edge.from);

    expect(into.length).toBeGreaterThan(2);
    for (const id of into) {
      expect(laidOut.nodes[id]!.y).toBeLessThan(laidOut.nodes[FAST_CHECKS]!.y);
    }
  }, 20_000);

  it('Every step opens scrolled to its first step', async () => {
    canvas.width = 560;
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

    const flow = await screen.findByTestId('flow-canvas', {}, LAID_OUT);
    const laidOut = await laidOutFor(CASES[0]!);
    const { zoom, plane, offset } = canvasPlane(560, laidOut.width);
    const first = laidOut.nodes[shipOrder[0]!]!;
    expect(first.y).toBe(
      Math.min(...Object.values(laidOut.nodes).map(box => box.y))
    );
    const left = scrollToShow(first, { zoom, offset, visible: 560, plane });
    expect(left).toBeGreaterThan(0);
    expect(flow.scrollLeft).toBe(left);
  }, 60_000);

  it('Every step opens on the open block when one is lit', async () => {
    canvas.width = 560;
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      renderWithProviders(
        <EveryStep
          payload={shipPayload}
          graph={ship}
          highlight={FAST_CHECKS}
          onSelect={() => {}}
          onView={() => {}}
          onClose={() => {}}
          engine={engine}
        />
      );

      const flow = await screen.findByTestId('flow-canvas', {}, LAID_OUT);
      const laidOut = await laidOutFor(CASES[0]!);
      const { zoom, plane, offset } = canvasPlane(560, laidOut.width);
      expect(flow.scrollLeft).toBe(
        scrollToShow(laidOut.nodes[FAST_CHECKS]!, {
          zoom,
          offset,
          visible: 560,
          plane,
        })
      );
      expect(scrolled).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
      expect(scrolled.mock.contexts[0]).toHaveAttribute('data-id', FAST_CHECKS);
    } finally {
      // @ts-expect-error jsdom has no scrollIntoView of its own.
      delete Element.prototype.scrollIntoView;
    }
  }, 60_000);

  it('Every step shows its key only once the graph is laid out', async () => {
    canvas.width = 560;
    let fail = true;
    renderWithProviders(
      <EveryStep
        payload={shipPayload}
        graph={ship}
        highlight={null}
        onSelect={() => {}}
        onView={() => {}}
        onClose={() => {}}
        engine={() =>
          fail ? Promise.reject(new Error('worker failed')) : engine()
        }
      />
    );

    expect(await screen.findByText("The graph didn't lay out")).toBeVisible();
    expect(screen.queryByTestId('flow-key')).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await screen.findByTestId('flow-canvas', {}, LAID_OUT);
    expect(screen.getByTestId('flow-key')).toBeInTheDocument();
  }, 60_000);

  it('a canvas of fractional width fits a graph that fits above the zoom floor', async () => {
    canvas.width = 730.6;
    renderWithProviders(
      <FlowGraph
        graph={around}
        payload={shipPayload}
        skill="ship"
        focus={FAST_CHECKS}
        order={aroundFlow}
        onSelect={() => {}}
        engine={engine}
      />
    );

    const flow = await screen.findByTestId('flow-canvas', {}, LAID_OUT);
    const plane = flow.firstElementChild as HTMLElement;
    expect(Number(plane.getAttribute('data-plane'))).toBeLessThanOrEqual(730.6);
    expect(Number(flow.getAttribute('data-zoom'))).toBeGreaterThan(0.85);
  }, 20_000);

  describe.each(CASES)('$name', at => {
    it.each(WIDTHS)(
      "no edge label overlaps another edge's line or any card, at %ipx",
      async width => {
        const laidOut = await drawnAt(width, at);
        expect(labelClashes(laidOut)).toEqual([]);
      },
      60_000
    );

    it.each(WIDTHS)(
      `every edge label sits within ${LABEL_REACH}px of its own edge's start or first bend, at %ipx`,
      async width => {
        const laidOut = await drawnAt(width, at);
        expect(strayLabels(laidOut, 40)).toEqual([]);
      },
      60_000
    );
  });
});
