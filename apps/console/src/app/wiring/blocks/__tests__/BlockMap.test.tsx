import '../../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { BlocksPayload } from '../../../../server/blocksPayload';
import { BlockMap } from '../BlockMap';
import { bundledEngine } from '../layoutEngine';
import { blockMap, type MapKind } from '../model/blockMap';
import type { LayoutEngine } from '../model/elkGraph';
import { mainColumn, mapLayout } from '../model/mapLayout';
import { LAYOUT_TIMEOUT_MS } from '../useGraphLayout';
import { shipPayload } from './blocksFixture';

type Graph = BlocksPayload['graphs'][number];

const graph = shipPayload.graphs.find(each => each.blockId === 'ship/flow')!;
const map = blockMap(graph, blockId => {
  const block = shipPayload.blocks.find(each => each.id === blockId)!;
  return {
    label: block.label,
    kind: block.kind as Exclude<MapKind, 'end' | 'split'>,
  };
});
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
const LAID_OUT = { timeout: 15_000 };

function renderMap(
  overrides: {
    graph?: Graph;
    engine?: () => Promise<LayoutEngine>;
  } = {}
) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const onView = vi.fn();
  renderWithProviders(
    <BlockMap
      payload={shipPayload}
      graph={overrides.graph ?? graph}
      highlight={null}
      onSelect={onSelect}
      onView={onView}
      onClose={onClose}
      engine={overrides.engine ?? engine}
    />
  );
  return { onSelect, onClose, onView };
}

const cardNamed = (label: string) =>
  screen
    .getAllByTestId('map-card')
    .find(card => card.textContent?.startsWith(label))!;

describe('BlockMap', () => {
  it('renders a card per map node with its kind badge and label', async () => {
    renderMap();

    const cards = await screen.findAllByTestId('map-card', {}, LAID_OUT);
    expect(cards).toHaveLength(
      map.nodes.filter(node => node.kind !== 'split').length
    );
    expect(
      cardNamed('Ship gate').querySelector('[data-badge="gate"]')
    ).not.toBeNull();
    expect(
      cardNamed('Rebases unfinished').querySelector('[data-badge="question"]')
    ).not.toBeNull();
    expect(
      cardNamed('Shipped').querySelector('[data-badge="end"]')
    ).not.toBeNull();
    expect(screen.getAllByTestId('map-split')).toHaveLength(
      map.nodes.filter(node => node.kind === 'split').length
    );
  }, 20_000);

  it('the header counts blocks and folded steps', async () => {
    renderMap();

    const blocks = map.nodes.filter(node => node.blockId !== null).length;
    expect(
      screen.getByText(`${blocks} blocks · ${map.foldedSteps} steps folded`)
    ).toBeInTheDocument();
    await screen.findAllByTestId('map-card', {}, LAID_OUT);
  }, 20_000);

  it('a folded link is dotted and a direct one is solid', async () => {
    renderMap();
    await screen.findAllByTestId('map-card', {}, LAID_OUT);

    const edge = (id: string) =>
      screen
        .getAllByTestId('map-edge')
        .find(path => path.getAttribute('data-edge') === id)!;
    const folded = edge('reopened_recapture->domain_steps_before_gate');
    expect(folded).toHaveAttribute('stroke-dasharray', '0 5');
    expect(folded).toHaveAttribute('stroke-linecap', 'round');
    expect(folded).toHaveAttribute('stroke-width', '2.4');
    const direct = edge('domain_runs_ci->run_watch_ci');
    expect(direct).not.toHaveAttribute('stroke-dasharray');
    expect(direct).toHaveAttribute('stroke-width', '1.5');
  }, 20_000);

  it('jump pills show the exit label and the target ("iterate", "Domain steps")', async () => {
    renderMap();
    await screen.findAllByTestId('map-card', {}, LAID_OUT);

    const box = screen
      .getAllByTestId('map-box')
      .find(each => within(each).queryByText('Ship gate'))!;
    const pill = within(box).getByTestId('jump-pill');
    expect(within(pill).getByText('iterate')).toBeInTheDocument();
    expect(within(pill).getByText('Domain steps')).toBeInTheDocument();
    expect(
      screen
        .getAllByTestId('jump-pill')
        .map(each => each.textContent)
        .filter(text => text === 'GitHubCapture')
    ).toHaveLength(1);
  }, 20_000);

  it("the main column's cards share one width", async () => {
    renderMap();
    await screen.findAllByTestId('map-card', {}, LAID_OUT);

    const widthOf = (label: string) =>
      cardNamed(label).style.getPropertyValue('--card-w');
    const labelOf = new Map(map.nodes.map(node => [node.id, node.label]));
    const main = mainColumn(map, graph)
      .nodes.filter(id => map.nodes.find(n => n.id === id)!.kind !== 'split')
      .map(id => widthOf(labelOf.get(id)!));
    expect(new Set(main).size).toBe(1);
    expect(main[0]).not.toBe('');
    expect(widthOf('Stash them')).not.toBe(main[0]);
  }, 20_000);

  it('lays the main column out straight, from the top, in model order', async () => {
    const layout = mapLayout(map, graph, {
      dotsOf: () => [],
      measure: (text, size) => text.length * size * 0.55,
    });
    const laidOut = await shared.layout(layout.input);
    const main = mainColumn(map, graph).nodes;
    const centre = (id: string) => {
      const box = laidOut.nodes[id]!;
      return box.x + layout.boxes.get(id)!.width / 2;
    };
    expect(new Set(main.map(centre)).size).toBe(1);
    const tops = main.map(id => laidOut.nodes[id]!.y);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    expect(laidOut.nodes[main[0]!]!.y).toBe(
      Math.min(...Object.values(laidOut.nodes).map(box => box.y))
    );
  }, 20_000);

  it('"No blocks here" links to Every step', () => {
    const { onView } = renderMap({
      graph: {
        blockId: 'ship/empty',
        nodes: [
          {
            id: 'only',
            label: 'Only a step',
            shape: 'box',
            cls: null,
            line: 1,
            blockId: null,
          },
        ],
        edges: [],
      },
    });

    expect(screen.getByText('No blocks here')).toBeInTheDocument();
    expect(screen.queryByTestId('map-card')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'See every step' }));
    expect(onView).toHaveBeenCalledWith('graph-steps');
  });

  it('the header switches to Every step', () => {
    const { onView } = renderMap({ engine: () => new Promise(() => {}) });

    const views = screen.getByRole('radiogroup', { name: 'Graph view' });
    expect(within(views).getByRole('radio', { name: 'Blocks' })).toBeChecked();
    fireEvent.click(within(views).getByRole('radio', { name: 'Every step' }));

    expect(onView).toHaveBeenCalledWith('graph-steps');
  });

  it('when layout fails it says "The graph didn\'t lay out" and Retry lays out again', async () => {
    let calls = 0;
    renderMap({
      engine: () =>
        calls++ === 0
          ? Promise.reject(new Error('worker failed'))
          : Promise.resolve(shared),
    });

    expect(
      await screen.findByText("The graph didn't lay out")
    ).toBeInTheDocument();
    expect(screen.queryByTestId('map-key')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findAllByTestId('map-card', {}, LAID_OUT)
    ).not.toHaveLength(0);
    expect(screen.getByTestId('map-key')).toBeInTheDocument();
    expect(calls).toBe(2);
  }, 20_000);

  it('a layout that never settles fails after the timeout', () => {
    vi.useFakeTimers();
    try {
      renderMap({ engine: () => new Promise(() => {}) });
      expect(screen.getByTestId('map-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('map-key')).toBeNull();

      act(() => vi.advanceTimersByTime(LAYOUT_TIMEOUT_MS));

      expect(screen.getByText("The graph didn't lay out")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps drawing the last layout while a new one runs', async () => {
    let calls = 0;
    const slowAfterFirst = () =>
      calls++ === 0 ? Promise.resolve(shared) : new Promise<never>(() => {});
    const props = {
      payload: shipPayload,
      highlight: null,
      onSelect: vi.fn(),
      onView: vi.fn(),
      onClose: vi.fn(),
      engine: slowAfterFirst,
    };
    const { rerender } = renderWithProviders(
      <BlockMap {...props} graph={graph} />
    );
    const before = await screen.findAllByTestId('map-card', {}, LAID_OUT);

    rerender(<BlockMap {...props} graph={{ ...graph }} />);

    expect(calls).toBe(2);
    expect(screen.getAllByTestId('map-card')).toHaveLength(before.length);
    expect(screen.queryByTestId('map-loading')).not.toBeInTheDocument();
  }, 20_000);

  it('a canvas of fractional width fits a map that fits', async () => {
    canvas.width = 1400.6;
    try {
      renderMap();

      const scroller = await screen.findByTestId('map-canvas', {}, LAID_OUT);
      const plane = scroller.firstElementChild as HTMLElement;
      expect(Number(scroller.getAttribute('data-zoom'))).toBe(1);
      expect(Number(plane.getAttribute('data-plane'))).toBe(1400);
    } finally {
      canvas.width = 0;
    }
  }, 20_000);

  it('Close calls onClose', () => {
    const { onClose } = renderMap({ engine: () => new Promise(() => {}) });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
