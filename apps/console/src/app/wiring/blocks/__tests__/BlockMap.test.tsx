import '../../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BlocksPayload } from '../../../../server/blocksPayload';
import { BlockMap } from '../BlockMap';
import { measureText } from '../graphCards';
import { bundledEngine } from '../layoutEngine';
import { openBand } from '../model/bandLayout';
import { dotsOf as blockDots } from '../model/blockFacts';
import { blockMap, type MapKind } from '../model/blockMap';
import type { LayoutEngine } from '../model/elkGraph';
import { mainColumn, mapLayout } from '../model/mapLayout';
import { LAYOUT_TIMEOUT_MS } from '../useGraphLayout';
import { shipPayload } from './blocksFixture';
import { labelClashes, labelsOutside } from './flowGeometry';

const TRAIL = [{ key: 'skill', label: 'ship' }];

type Graph = BlocksPayload['graphs'][number];

const graph = shipPayload.graphs.find(each => each.blockId === 'ship/flow')!;
const map = blockMap(graph, blockId => {
  const block = shipPayload.blocks.find(each => each.id === blockId)!;
  return {
    label: block.label,
    kind: block.kind as Exclude<MapKind, 'end' | 'split'>,
  };
});
const dotsOf = (blockId: string) => {
  const block = shipPayload.blocks.find(each => each.id === blockId);
  return block ? blockDots(block) : [];
};
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
  const onUp = vi.fn();
  const onView = vi.fn();
  renderWithProviders(
    <BlockMap
      payload={shipPayload}
      graph={overrides.graph ?? graph}
      highlight={null}
      onSelect={onSelect}
      onView={onView}
      trail={[
        { key: 'skill', label: 'ship', onClick: onUp },
        { key: 'graph', label: 'Diagram' },
      ]}
      title="Ship"
      engine={overrides.engine ?? engine}
    />
  );
  return { onSelect, onUp, onView };
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
      screen.getByText(
        `Diagram · ${blocks} blocks · ${map.foldedSteps} steps folded`
      )
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

  it('a jump pill shows its target and names its exit only to a reader ("Domain steps", "iterate")', async () => {
    renderMap();
    await screen.findAllByTestId('map-card', {}, LAID_OUT);

    const box = screen
      .getAllByTestId('map-box')
      .find(each => within(each).queryByText('Ship gate'))!;
    const pill = within(box).getByTestId('jump-pill');
    expect(pill).toHaveTextContent('Domain steps');
    expect(pill).not.toHaveTextContent('iterate');
    expect(pill).toHaveAccessibleName('iterate: back to Domain steps');
    expect(
      screen
        .getAllByTestId('jump-pill')
        .map(each => each.getAttribute('aria-label'))
        .filter(name => name?.startsWith('GitHub:'))
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
    // A card of odd width centres on a half pixel, a split dot on a whole one.
    const centres = main.map(centre);
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(1);
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
      trail: TRAIL,
      title: 'Ship',
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

  it('the loading placeholder is a status', () => {
    renderMap({ engine: () => new Promise(() => {}) });

    expect(
      screen.getByRole('status', { name: 'laying out the map' })
    ).toBeInTheDocument();
  });

  describe('opened on a lit block', () => {
    const native = Element.prototype.scrollIntoView;
    afterEach(() => {
      Element.prototype.scrollIntoView = native;
      canvas.width = 0;
      vi.restoreAllMocks();
    });

    async function openOn(highlight: string) {
      const scrolled = vi.fn<Element['scrollIntoView']>();
      Element.prototype.scrollIntoView = scrolled;
      canvas.width = 1100;
      const props = {
        payload: shipPayload,
        graph,
        highlight,
        onSelect: vi.fn(),
        onView: vi.fn(),
        trail: TRAIL,
        title: 'Ship',
        engine,
      };
      const view = renderWithProviders(<BlockMap {...props} />);
      await screen.findAllByTestId('map-card', {}, LAID_OUT);
      await vi.waitFor(() => expect(scrolled).toHaveBeenCalled(), LAID_OUT);
      return {
        scrolled,
        rerender: () => view.rerender(<BlockMap {...props} />),
      };
    }

    it('scrolls the lit block into view once', async () => {
      const { scrolled, rerender } = await openOn('gate_mark_ready');

      expect(scrolled).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
      expect(scrolled.mock.contexts[0]).toHaveAttribute(
        'data-node',
        'gate_mark_ready'
      );
      rerender();
      expect(scrolled).toHaveBeenCalledOnce();
    }, 20_000);

    it('scrolls instantly under reduced motion', async () => {
      const real = window.matchMedia;
      vi.spyOn(window, 'matchMedia').mockImplementation(query =>
        query.includes('prefers-reduced-motion')
          ? { ...real(query), matches: true }
          : real(query)
      );

      const { scrolled } = await openOn('gate_mark_ready');

      expect(scrolled).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'instant', block: 'center' })
      );
    }, 20_000);
  });

  it('a resize that keeps the zoom keeps the canvas mounted and recentres the map', async () => {
    canvas.width = 1400;
    try {
      const props = {
        payload: shipPayload,
        graph,
        highlight: null,
        onSelect: vi.fn(),
        onView: vi.fn(),
        trail: TRAIL,
        title: 'Ship',
        engine,
      };
      const { rerender } = renderWithProviders(<BlockMap {...props} />);
      const card = (await screen.findAllByTestId('map-card', {}, LAID_OUT))[0]!;
      const viewport = () =>
        document.querySelector<HTMLElement>('.react-flow__viewport')!;
      const before = viewport().style.transform;
      const zoom = screen.getByTestId('map-canvas').getAttribute('data-zoom');

      canvas.width = 1300;
      rerender(<BlockMap {...props} />);

      expect(screen.getByTestId('map-canvas')).toHaveAttribute(
        'data-zoom',
        zoom
      );
      expect(card.isConnected).toBe(true);
      await vi.waitFor(() =>
        expect(viewport().style.transform).not.toBe(before)
      );
    } finally {
      canvas.width = 0;
    }
  }, 20_000);

  describe('label geometry', () => {
    const layout = mapLayout(map, graph, { dotsOf, measure: measureText });
    const bands = map.links.flatMap(link => {
      const banded = openBand(layout, map, graph, link, measureText);
      return banded.band ? [{ name: link.id, input: banded.input }] : [];
    });
    const states = [{ name: 'closed', input: layout.input }, ...bands];

    it('every openable band is checked', () => {
      expect(bands.length).toBeGreaterThan(20);
    });

    it.each(states)(
      '$name: no label over another line, card or label, and none outside the canvas',
      async ({ input }) => {
        const laidOut = await shared.layout(input);
        expect(labelClashes(laidOut)).toEqual([]);
        expect(labelsOutside(laidOut)).toEqual([]);
      },
      20_000
    );
  });

  it('names the page for its block, under a trail back up to the skill', () => {
    const { onUp } = renderMap({ engine: () => new Promise(() => {}) });

    expect(screen.getByRole('heading', { name: 'Ship' })).toBeInTheDocument();
    const trail = screen.getByTestId('graph-trail');
    expect(trail).toHaveTextContent('ship');
    expect(trail).toHaveTextContent('Diagram');
    fireEvent.click(within(trail).getByText('ship'));

    expect(onUp).toHaveBeenCalledOnce();
  });
});
