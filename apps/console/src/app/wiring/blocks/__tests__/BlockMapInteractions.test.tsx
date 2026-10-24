import '../../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlockMap } from '../BlockMap';
import { RING_MS } from '../FoldBand';
import { bundledEngine } from '../layoutEngine';
import { blockMap, type MapKind } from '../model/blockMap';
import { shipPayload } from './blocksFixture';

const graph = shipPayload.graphs.find(each => each.blockId === 'ship/flow')!;
const shared = bundledEngine();
const engine = () => Promise.resolve(shared);
const LAID_OUT = { timeout: 15_000 };
const SLOW = 30_000;

const REBASE_TO_RESOLVE = 'domain_rebases_unfinished->resolve_conflict_files';
const REOPENED_TO_DOMAIN = 'reopened_recapture->domain_steps_before_gate';

async function renderMap() {
  const onSelect = vi.fn();
  renderWithProviders(
    <BlockMap
      payload={shipPayload}
      graph={graph}
      highlight={null}
      onSelect={onSelect}
      onClose={() => {}}
      onView={() => {}}
      engine={engine}
    />
  );
  await screen.findAllByTestId('map-card', {}, LAID_OUT);
  return { onSelect };
}

const linkButton = (id: string) =>
  screen
    .getAllByTestId('map-link')
    .find(each => each.getAttribute('data-link') === id)!;

const edgePath = (id: string) =>
  screen
    .getAllByTestId('map-edge')
    .find(each => each.getAttribute('data-edge') === id)!;

const cardNamed = (label: string) =>
  screen
    .getAllByTestId('map-card')
    .find(card => card.textContent?.startsWith(label))!;

const boxOf = (label: string) => cardNamed(label).closest('[data-node]')!;

const stepNamed = (id: string) =>
  screen
    .getAllByTestId('band-step')
    .find(step => step.getAttribute('data-node') === id)!;

async function openFold(id: string) {
  fireEvent.click(linkButton(id));
  return screen.findByTestId('fold-band', {}, LAID_OUT);
}

describe('BlockMap interactions', () => {
  let scrolled: ReturnType<typeof vi.fn<Element['scrollIntoView']>>;
  const native = Element.prototype.scrollIntoView;
  beforeEach(() => {
    scrolled = vi.fn<Element['scrollIntoView']>();
    Element.prototype.scrollIntoView = scrolled;
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = native;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it(
    'hovering a dotted link lights it and lists its folded steps, ending "Click to unfold"',
    async () => {
      await renderMap();

      fireEvent.mouseEnter(linkButton(REBASE_TO_RESOLVE));

      expect(edgePath(REBASE_TO_RESOLVE)).toHaveAttribute('data-hot');
      const tip = await screen.findByTestId('fold-steps');
      expect(within(tip).getByText('3 steps folded')).toBeInTheDocument();
      const rows = within(tip)
        .getAllByRole('listitem')
        .map(row => row.textContent);
      expect(rows).toEqual([
        'git_rebase {tree: <root>, onto: origin/<resolved target>}',
        'Rebase status?',
        'Conflict rounds left? · 4',
      ]);
      expect(tip.lastElementChild).toHaveTextContent('Click to unfold');
    },
    SLOW
  );

  it(
    'clicking a dotted link opens its band with "<n> steps" and Fold; Fold closes it',
    async () => {
      await renderMap();

      const band = await openFold(REBASE_TO_RESOLVE);

      expect(within(band).getByText('3 steps')).toBeInTheDocument();
      expect(
        screen.getAllByTestId('band-step').map(step => step.dataset.node)
      ).toEqual([
        'git_rebase_onto',
        'rebase_status',
        'run_budget_conflict_rounds',
      ]);
      expect(stepNamed('rebase_status')).toHaveTextContent('Rebase status?');
      expect(stepNamed('git_rebase_onto')).toHaveTextContent(
        'git_rebase {tree: <root>, onto: origin/<resolved target>}'
      );
      fireEvent.click(within(band).getByRole('button', { name: 'Fold' }));

      await vi.waitFor(() => {
        expect(screen.queryByTestId('fold-band')).toBeNull();
        expect(screen.queryByTestId('band-step')).toBeNull();
      }, LAID_OUT);
    },
    SLOW
  );

  it(
    'opening a second fold closes the first',
    async () => {
      await renderMap();
      await openFold(REBASE_TO_RESOLVE);

      fireEvent.click(linkButton(REOPENED_TO_DOMAIN));

      await vi.waitFor(() => {
        const bands = screen.getAllByTestId('fold-band');
        expect(bands).toHaveLength(1);
        expect(bands[0]).toHaveAttribute('data-link', REOPENED_TO_DOMAIN);
      }, LAID_OUT);
    },
    SLOW
  );

  it(
    'a band jump to a step off the map is a plain exit, and one to a block is a button',
    async () => {
      await renderMap();
      await openFold(REBASE_TO_RESOLVE);
      const status = stepNamed('rebase_status');

      expect(
        within(status).getByRole('button', {
          name: 'clean: back to Fast checks',
        })
      ).toBeInTheDocument();
      const exit = within(status).getByTestId('band-exit');
      expect(exit).toHaveTextContent('errorWhich exit?');
      expect(within(exit).queryByRole('button')).toBeNull();
    },
    SLOW
  );

  it(
    'hovering a block lights its links and fades every other node and link',
    async () => {
      await renderMap();

      fireEvent.mouseEnter(cardNamed('Fix test-first'));

      expect(cardNamed('Fix test-first')).toHaveAttribute('data-hot');
      expect(boxOf('Fix test-first')).not.toHaveAttribute('data-dim');
      expect(boxOf('Ship gate')).toHaveAttribute('data-dim');
      const own = screen
        .getAllByTestId('map-edge')
        .filter(edge => edge.getAttribute('data-hot') !== null);
      expect(own.length).toBeGreaterThan(0);
      expect(edgePath(REOPENED_TO_DOMAIN)).toHaveAttribute('data-dim');

      fireEvent.mouseLeave(cardNamed('Fix test-first'));

      expect(boxOf('Ship gate')).not.toHaveAttribute('data-dim');
    },
    SLOW
  );

  it(
    'clicking a block calls onSelect with its block id',
    async () => {
      const { onSelect } = await renderMap();

      fireEvent.click(screen.getByRole('button', { name: 'Ship gate' }));

      expect(onSelect).toHaveBeenCalledWith('ship/flow/gate-ship');
    },
    SLOW
  );

  it(
    'clicking a jump scrolls to the target, rings it for RING_MS and shows "from <source>" with Back',
    async () => {
      await renderMap();
      vi.useFakeTimers();

      const pill = within(boxOf('Resolve conflicts') as HTMLElement).getByRole(
        'button',
        { name: 'back to Fast checks' }
      );
      fireEvent.click(pill);

      expect(scrolled).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth', block: 'center' })
      );
      expect(scrolled.mock.contexts.at(-1)).toBe(boxOf('Fast checks'));
      expect(cardNamed('Fast checks')).toHaveAttribute('data-ring');
      const from = within(boxOf('Fast checks') as HTMLElement).getByTestId(
        'jump-from'
      );
      expect(from).toHaveTextContent('from Resolve conflicts');
      expect(
        within(from).getByRole('button', { name: 'Back' })
      ).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(RING_MS));

      expect(cardNamed('Fast checks')).not.toHaveAttribute('data-ring');
    },
    SLOW
  );

  it(
    'Back scrolls to the source',
    async () => {
      await renderMap();
      fireEvent.click(
        within(boxOf('Resolve conflicts') as HTMLElement).getByRole('button', {
          name: 'back to Fast checks',
        })
      );

      fireEvent.click(screen.getByRole('button', { name: 'Back' }));

      expect(scrolled.mock.contexts.at(-1)).toBe(boxOf('Resolve conflicts'));
      expect(screen.queryByTestId('jump-from')).toBeNull();
    },
    SLOW
  );

  it(
    'with reduced motion the scroll is instant',
    async () => {
      const real = window.matchMedia;
      vi.spyOn(window, 'matchMedia').mockImplementation(query =>
        query.includes('prefers-reduced-motion')
          ? { ...real(query), matches: true }
          : real(query)
      );
      await renderMap();

      fireEvent.click(
        within(boxOf('Resolve conflicts') as HTMLElement).getByRole('button', {
          name: 'back to Fast checks',
        })
      );

      expect(scrolled).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'instant' })
      );
    },
    SLOW
  );

  it(
    'hovering a split dot shows its question; the dot is not a button',
    async () => {
      await renderMap();

      const question = 'Forge host (ship, create)?';
      const dot = screen
        .getAllByTestId('map-split')
        .find(each => each.getAttribute('aria-label') === question)!;
      fireEvent.mouseEnter(dot);

      expect(await screen.findByRole('tooltip')).toHaveTextContent(question);
      expect(dot.closest('button')).toBeNull();
    },
    SLOW
  );

  it(
    'hovering a jump pill lists its folded steps',
    async () => {
      await renderMap();

      fireEvent.mouseEnter(
        screen.getByRole('button', { name: 'iterate: back to Domain steps' })
      );

      const tip = await screen.findByTestId('fold-steps');
      expect(
        within(tip)
          .getAllByRole('listitem')
          .map(row => row.textContent)
      ).toEqual([
        'run_field_set {key: shipTarget, value: -, stage} (iterate)',
        'Ship gate rounds left? · 2',
      ]);
      expect(tip).not.toHaveTextContent('Click to unfold');
    },
    SLOW
  );

  it(
    'Enter and Space on a dotted link open its band',
    async () => {
      await renderMap();

      fireEvent.keyDown(linkButton(REBASE_TO_RESOLVE), { key: 'Enter' });
      const band = await screen.findByTestId('fold-band', {}, LAID_OUT);
      fireEvent.click(within(band).getByRole('button', { name: 'Fold' }));
      await vi.waitFor(
        () => expect(screen.queryByTestId('fold-band')).toBeNull(),
        LAID_OUT
      );
      fireEvent.keyDown(linkButton(REBASE_TO_RESOLVE), { key: ' ' });

      expect(
        await screen.findByTestId('fold-band', {}, LAID_OUT)
      ).toBeInTheDocument();
    },
    SLOW
  );

  it(
    'opening a band focuses its Fold button, and Fold gives focus back to the link',
    async () => {
      await renderMap();

      const band = await openFold(REBASE_TO_RESOLVE);
      const fold = within(band).getByRole('button', { name: 'Fold' });
      await vi.waitFor(() => expect(fold).toHaveFocus(), LAID_OUT);
      fireEvent.click(fold);

      await vi.waitFor(
        () => expect(linkButton(REBASE_TO_RESOLVE)).toHaveFocus(),
        LAID_OUT
      );
    },
    SLOW
  );

  it(
    "band steps and the band fade on another block's hover, not on its own link's",
    async () => {
      await renderMap();
      const band = await openFold(REBASE_TO_RESOLVE);

      fireEvent.mouseEnter(cardNamed('Ship gate'));
      expect(band).toHaveAttribute('data-dim');
      expect(stepNamed('rebase_status')).toHaveAttribute('data-dim');

      fireEvent.mouseLeave(cardNamed('Ship gate'));
      fireEvent.mouseEnter(cardNamed('Rebases unfinished'));
      expect(band).not.toHaveAttribute('data-dim');
      expect(stepNamed('rebase_status')).not.toHaveAttribute('data-dim');
    },
    SLOW
  );

  it(
    "Back from a band row's jump, once the band has folded, goes to the link's source block",
    async () => {
      await renderMap();
      await openFold(REBASE_TO_RESOLVE);
      fireEvent.click(
        within(stepNamed('rebase_status')).getByRole('button', {
          name: 'clean: back to Fast checks',
        })
      );
      fireEvent.click(screen.getByRole('button', { name: 'Fold' }));
      await vi.waitFor(
        () => expect(screen.queryByTestId('band-step')).toBeNull(),
        LAID_OUT
      );

      fireEvent.click(screen.getByRole('button', { name: 'Back' }));

      expect(scrolled.mock.contexts.at(-1)).toBe(boxOf('Rebases unfinished'));
      expect(
        screen.getByRole('button', { name: 'Rebases unfinished' })
      ).toHaveFocus();
    },
    SLOW
  );

  it(
    'a jump and Back made before a fold lands keep their focus once the link draws',
    async () => {
      await renderMap();
      const band = await openFold(REBASE_TO_RESOLVE);

      fireEvent.click(within(band).getByRole('button', { name: 'Fold' }));
      fireEvent.click(
        screen.getByRole('button', { name: 'iterate: back to Domain steps' })
      );
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      const gate = screen.getByRole('button', { name: 'Ship gate' });
      expect(gate).toHaveFocus();

      await vi.waitFor(
        () => expect(screen.queryByTestId('fold-band')).toBeNull(),
        LAID_OUT
      );
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(linkButton(REBASE_TO_RESOLVE)).toBeInTheDocument();
      expect(gate).toHaveFocus();
    },
    SLOW
  );

  it(
    'Back after a second jump returns to the second source',
    async () => {
      await renderMap();
      fireEvent.click(
        within(boxOf('Resolve conflicts') as HTMLElement).getByRole('button', {
          name: 'back to Fast checks',
        })
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'iterate: back to Domain steps' })
      );

      expect(screen.getAllByTestId('jump-from')).toHaveLength(1);
      expect(
        within(boxOf('Domain steps') as HTMLElement).getByTestId('jump-from')
      ).toHaveTextContent('from Ship gate');
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));

      expect(scrolled.mock.contexts.at(-1)).toBe(boxOf('Ship gate'));
      expect(screen.getByRole('button', { name: 'Ship gate' })).toHaveFocus();
    },
    SLOW
  );

  it(
    'no link button stands for a link with nothing folded',
    async () => {
      await renderMap();
      const map = blockMap(graph, blockId => {
        const block = shipPayload.blocks.find(each => each.id === blockId)!;
        return {
          label: block.label,
          kind: block.kind as Exclude<MapKind, 'end' | 'split'>,
        };
      });
      const foldedOf = new Map(
        map.links.map(link => [link.id, link.folded.length])
      );

      const buttons = screen.getAllByTestId('map-link');
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) {
        expect(foldedOf.get(button.getAttribute('data-link')!)).toBeGreaterThan(
          0
        );
        expect(button.getAttribute('aria-label')).not.toMatch(/Unfold 0 /);
      }
    },
    SLOW
  );

  it(
    'opening a second band focuses its own Fold button',
    async () => {
      await renderMap();
      await openFold(REBASE_TO_RESOLVE);

      fireEvent.click(linkButton(REOPENED_TO_DOMAIN));

      await vi.waitFor(() => {
        const band = screen.getByTestId('fold-band');
        expect(band).toHaveAttribute('data-link', REOPENED_TO_DOMAIN);
        expect(
          within(band).getByRole('button', { name: 'Fold' })
        ).toHaveFocus();
      }, LAID_OUT);
    },
    SLOW
  );

  it(
    "hovering a block on another link of the band's trunk keeps the band lit",
    async () => {
      await renderMap();
      const band = await openFold(
        'domain_rebases_unfinished->create_forge_host'
      );

      fireEvent.mouseEnter(cardNamed('Push refused'));

      expect(band).not.toHaveAttribute('data-dim');
      expect(stepNamed('push_result')).not.toHaveAttribute('data-dim');
    },
    SLOW
  );

  it(
    'Which forge\'s pill back into the forge split scrolls to the dot, rings it and shows "from Which forge" with Back',
    async () => {
      await renderMap();
      vi.useFakeTimers();
      const split = () =>
        screen
          .getAllByTestId('map-split')
          .find(dot => dot.closest('[data-node="create_forge_host"]'))!;

      fireEvent.click(
        within(boxOf('Which forge') as HTMLElement).getByRole('button', {
          name: 'back to Forge host?',
        })
      );

      const dotBox = split().closest('[data-node]') as HTMLElement;
      expect(scrolled.mock.contexts.at(-1)).toBe(dotBox);
      expect(split()).toHaveAttribute('data-ring');
      const from = within(dotBox).getByTestId('jump-from');
      expect(from).toHaveTextContent('from Which forge');
      expect(
        within(from).getByRole('button', { name: 'Back' })
      ).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(RING_MS));
      expect(split()).not.toHaveAttribute('data-ring');
    },
    SLOW
  );

  it(
    'a pill whose target is its own card rings that card and shows no "from" chip',
    async () => {
      await renderMap();

      fireEvent.click(
        screen.getByRole('button', { name: 'iterate: back to Push refused' })
      );

      expect(cardNamed('Push refused')).toHaveAttribute('data-ring');
      expect(screen.queryByTestId('jump-from')).toBeNull();
    },
    SLOW
  );

  it(
    'the "from" chip sits under its card, kept inside the canvas',
    async () => {
      await renderMap();

      fireEvent.click(
        within(boxOf('Resolve conflicts') as HTMLElement).getByRole('button', {
          name: 'back to Fast checks',
        })
      );

      const from = screen.getByTestId('jump-from');
      expect(from).toHaveAttribute('data-place', 'below');
      expect(parseFloat(from.style.maxWidth)).toBeGreaterThan(0);
    },
    SLOW
  );

  it(
    'a link that folds one step says "1 step"',
    async () => {
      await renderMap();
      const id = 'record_evidence->attach_evidence';

      expect(linkButton(id)).toHaveAccessibleName(
        'Unfold 1 step: Record evidence to Attach evidence'
      );
      fireEvent.mouseEnter(linkButton(id));
      const tip = await screen.findByTestId('fold-steps');
      expect(within(tip).getByText('1 step folded')).toBeInTheDocument();
    },
    SLOW
  );

  it(
    'cards, pills and dotted links are buttons with names, reachable by Tab',
    async () => {
      await renderMap();
      const user = userEvent.setup();

      const card = screen.getByRole('button', { name: 'Ship gate' });
      const pill = screen.getByRole('button', {
        name: 'iterate: back to Domain steps',
      });
      const link = screen.getByRole('button', {
        name: 'Unfold 3 steps: Rebases unfinished to Resolve conflicts',
      });
      const reached = new Set<Element>();
      for (let step = 0; step < 200 && reached.size < 3; step++) {
        await user.tab();
        const at = document.activeElement;
        if (at === card || at === pill || at === link) reached.add(at);
      }

      expect(reached.size).toBe(3);
    },
    SLOW
  );
});
