import '../../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import { designFixture } from '../../graph/__tests__/designFixtures';
import { buildFocusGroups } from '../../graph/model/focusModel';
import type { WiringUrl } from '../../graph/useWiringUrl';
import { headingTree } from '../model/headingTree';
import { miniPayload, shipPayload } from './blocksFixture';

const sourceGet = vi.fn();
const historyGet = vi.fn<(...args: unknown[]) => Promise<never>>(
  () => new Promise(() => {})
);

vi.mock('../../../api', () => ({
  client: {
    api: {
      skills: {
        source: { $get: (...args: unknown[]) => sourceGet(...args) },
        history: { $get: (...args: unknown[]) => historyGet(...args) },
      },
      settings: {
        'default-editor': {
          $get: () => Promise.resolve({ ok: true, json: async () => ({}) }),
        },
      },
    },
  },
}));

vi.mock('../layoutEngine', async importOriginal => {
  const real = await importOriginal<typeof import('../layoutEngine')>();
  const engine = real.bundledEngine();
  return { ...real, loadLayoutEngine: () => Promise.resolve(engine) };
});

const LAID_OUT = { timeout: 15_000 };

const { BlockView } = await import('../BlockView');

const URL_AT: WiringUrl = {
  tab: 'graph',
  pack: null,
  focus: 'mini',
  select: null,
  view: null,
  attention: false,
  block: null,
};

function renderView(
  change: Partial<WiringUrl> = {},
  props: Partial<Parameters<typeof BlockView>[0]> = {}
) {
  const patch = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <BlockView
        pack="acme"
        payload={miniPayload}
        url={{ ...URL_AT, ...change }}
        patch={patch}
        {...props}
      />
    </QueryClientProvider>
  );
  return patch;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('BlockView: the skill', () => {
  it('titles the page with the skill and folds every section into a band of rows', () => {
    renderView();

    expect(
      within(screen.getByTestId('focus-header')).getByText('mini')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('block-crumbs')).not.toBeInTheDocument();
    const bands = screen.getAllByTestId('section-band');
    expect(bands.map(band => band.getAttribute('aria-label'))).toEqual([
      'Run',
      'Other blocks',
    ]);
    expect(
      within(bands[0])
        .getAllByTestId('block-row')
        .map(row => row.textContent)
    ).toEqual(['Guard', 'Check']);
    expect(screen.getByTestId('block-document')).toBeInTheDocument();
  });

  it('marks a row whose block has props with a plug and its layer dots', () => {
    renderView();

    const other = screen
      .getAllByTestId('section-band')
      .find(band => band.getAttribute('aria-label') === 'Other blocks')!;
    const gate = within(other)
      .getAllByTestId('block-row')
      .find(row => row.textContent?.startsWith('Gate'))!;
    const item = gate.closest('li')!;
    expect(within(item).getByTestId('row-has-props')).toBeInTheDocument();
  });

  it('unfolds a row in place, and opens its block from Open', async () => {
    const patch = renderView();

    const check = screen
      .getAllByTestId('block-row')
      .find(row => row.textContent === 'Check')!;
    const item = check.closest('li')!;
    expect(within(item).queryByTestId('block-row-body')).toBeNull();
    await userEvent.click(check);
    expect(within(item).getByTestId('block-row-body')).toHaveTextContent(
      'Confirm the widget works.'
    );
    expect(patch).not.toHaveBeenCalled();

    await userEvent.click(within(item).getByTestId('block-row-open'));
    expect(patch).toHaveBeenCalledWith({
      block: 'mini/run/check',
      select: null,
    });
  });

  it("leads with the skill's own description, and the document keeps the file's text", () => {
    renderView(
      {},
      {
        skill: {
          title: 'mini',
          kind: 'on-demand',
          description: 'A small skill for the tests.',
          status: null,
          checkError: null,
        },
      }
    );

    expect(screen.getByTestId('focus-header')).toHaveTextContent(
      'A small skill for the tests.'
    );
    expect(screen.getByTestId('block-document')).toHaveTextContent(
      'Runs the step, then asks for a decision.'
    );
  });

  it("heads a section band with its block's diagram button, which opens that graph", async () => {
    const patch = renderView({ focus: 'ship' }, { payload: shipPayload });

    const flow = screen
      .getAllByTestId('section-band')
      .find(band => band.getAttribute('aria-label') === 'Flow')!;
    const diagram = within(flow).getByTestId('diagram-button');
    expect(diagram).toHaveTextContent(/^Diagram · \d+ steps$/);
    await userEvent.click(diagram);
    expect(patch).toHaveBeenCalledWith({ block: 'ship/flow', select: 'graph' });
  });

  it('folds a band from its chevron, and unfolds it again', async () => {
    renderView();

    const run = screen
      .getAllByTestId('section-band')
      .find(band => band.getAttribute('aria-label') === 'Run')!;
    await userEvent.click(
      within(run).getByRole('button', { name: 'Fold Run' })
    );
    expect(run).toHaveAttribute('data-folded', 'true');
    await userEvent.click(
      within(run).getByRole('button', { name: 'Unfold Run' })
    );
    expect(run).not.toHaveAttribute('data-folded');
  });

  it('folds the document from its chevron', async () => {
    renderView();

    const doc = screen.getByTestId('block-document');
    await userEvent.click(
      within(doc).getByRole('button', { name: 'Fold the document' })
    );
    expect(doc).toHaveAttribute('data-folded', 'true');
  });

  it("leads a band with its block's first sentence, and shows the rest on Show more", async () => {
    renderView({ focus: 'ship' }, { payload: shipPayload });

    const run = screen
      .getAllByTestId('section-band')
      .find(band => band.getAttribute('aria-label') === 'Run')!;
    expect(within(run).getByTestId('band-intro')).toHaveTextContent(
      'An own run is a fresh, resumed or reopened one: it records identity and closes at the end.'
    );
    expect(within(run).queryByText(/The flags, rendered/)).toBeNull();
    await userEvent.click(
      within(run).getByRole('button', { name: 'Show more' })
    );
    expect(within(run).getByText(/The flags, rendered/)).toBeInTheDocument();
    await userEvent.click(
      within(run).getByRole('button', { name: 'Show less' })
    );
    expect(within(run).queryByText(/The flags, rendered/)).toBeNull();
  });

  it('says a stale block link names nothing, and shows the skill', () => {
    renderView({ block: 'mini/gone' });

    expect(screen.getByTestId('block-missing')).toHaveTextContent(
      'mini has no block mini/gone, so this is the whole skill.'
    );
    expect(screen.getAllByTestId('section-band')).toHaveLength(2);
  });
});

describe('BlockView: a parent block', () => {
  it('shows a trail, its own text and its children', async () => {
    const patch = renderView({ block: 'mini/run' });

    const crumbs = screen.getByTestId('block-crumbs');
    expect(crumbs).toHaveTextContent('mini');
    expect(crumbs).toHaveTextContent('Run');
    const header = screen.getByTestId('focus-header');
    expect(within(header).getByText('Run')).toBeInTheDocument();
    expect(screen.getByTestId('block-document')).toHaveTextContent(
      'Do the work for the widget.'
    );
    const inside = screen.getByRole('region', { name: 'Inside this block' });
    expect(within(inside).getAllByTestId('block-row')).toHaveLength(2);

    await userEvent.click(within(crumbs).getByText('mini'));
    expect(patch).toHaveBeenCalledWith({ block: null, select: null });
  });

  it('offers Copy for Claude, with no file menu', () => {
    renderView({ focus: 'ship', block: 'ship/flow' }, { payload: shipPayload });

    expect(
      screen.getByRole('button', { name: 'Copy for Claude' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'File' })
    ).not.toBeInTheDocument();
  });

  it('counts the blocks under it in the header', () => {
    renderView({ focus: 'ship', block: 'ship/flow' }, { payload: shipPayload });

    expect(screen.getByTestId('focus-header')).toHaveTextContent('21 blocks');
  });

  it("opens the skill's diagram from its row under the document", async () => {
    const patch = renderView();

    const row = screen.getByTestId('flow-row');
    expect(row).toHaveTextContent('4 steps · 2 blocks');
    await userEvent.click(
      within(row).getByRole('button', { name: /^Diagram/ })
    );
    expect(patch).toHaveBeenCalledWith({ block: 'mini', select: 'graph' });
  });
});

describe('BlockView: a single block', () => {
  it('names its kind and its props in chips', () => {
    renderView({ block: 'mini/gate' });

    const header = screen.getByTestId('focus-header');
    expect(within(header).getByText('Gate')).toBeInTheDocument();
    expect(within(header).getByTestId('block-kind')).toHaveTextContent('gate');
    expect(within(header).getByTestId('block-has-props')).toHaveTextContent(
      'has props'
    );
  });

  it('puts each prop in a box at its marker and offers Copy for Claude', () => {
    renderView({ block: 'mini/gate' });

    expect(screen.getByTestId('prop-box')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy for Claude' })
    ).toBeInTheDocument();
  });

  it('draws Around this block with block nodes under their short labels', async () => {
    renderView({ block: 'mini/gate' });

    const around = screen.getByTestId('around-graph');
    const cards = await within(around).findAllByTestId(
      'map-card',
      {},
      LAID_OUT
    );
    expect(cards.map(node => node.textContent)).toEqual(['Run', 'Gate']);
    expect(screen.getAllByText('Around this block')).toHaveLength(1);
  });

  it("marks a block node with its block's kind badge", async () => {
    renderView({ block: 'mini/gate' });

    const cards = await within(
      screen.getByTestId('around-graph')
    ).findAllByTestId('map-card', {}, LAID_OUT);
    const gate = cards.find(node => node.textContent === 'Gate')!;
    expect(gate.querySelector('[data-badge="gate"]')).not.toBeNull();
  });

  it('opens a block from its node in Around this block', async () => {
    const patch = renderView({ block: 'mini/gate' });

    const cards = await within(
      screen.getByTestId('around-graph')
    ).findAllByTestId('map-card', {}, LAID_OUT);
    fireEvent.click(cards.find(node => node.textContent === 'Run')!);

    expect(patch).toHaveBeenCalledWith({ block: 'mini/run', select: null });
  });

  it('shows the block map in place of the small graph, with a trail back to the block', async () => {
    const patch = renderView({ block: 'mini/gate', select: 'graph' });

    expect(screen.queryByTestId('around-graph')).not.toBeInTheDocument();
    const map = screen.getByTestId('block-map');
    expect(within(map).getByRole('heading', { name: 'Gate' })).toBeVisible();
    const trail = within(map).getByTestId('graph-trail');
    expect(trail).toHaveTextContent('Diagram');
    await userEvent.click(within(trail).getByText('Gate'));
    expect(patch).toHaveBeenCalledWith({ block: 'mini/gate', select: null });
  });

  it('the Blocks | Every step control switches the URL between graph and graph-steps', async () => {
    const patch = renderView({ block: 'mini/gate', select: 'graph' });

    await userEvent.click(
      within(screen.getByTestId('block-map')).getByRole('radio', {
        name: 'Every step',
      })
    );
    expect(patch).toHaveBeenCalledWith({ select: 'graph-steps' });
  });

  it('shows Every step at graph-steps, switches back to Blocks and goes back up', async () => {
    const patch = renderView({ block: 'mini/gate', select: 'graph-steps' });

    expect(screen.queryByTestId('block-map')).not.toBeInTheDocument();
    expect(screen.queryByTestId('around-graph')).not.toBeInTheDocument();
    const steps = screen.getByTestId('every-step');
    expect(
      within(steps).getByRole('radio', { name: 'Every step' })
    ).toBeChecked();
    await userEvent.click(within(steps).getByRole('radio', { name: 'Blocks' }));
    expect(patch).toHaveBeenCalledWith({ select: 'graph' });
    await userEvent.click(
      within(within(steps).getByTestId('graph-trail')).getByText('Gate')
    );
    expect(patch).toHaveBeenCalledWith({ block: 'mini/gate', select: null });
  });

  it('shows the block when the URL asks for a map where no graph is', () => {
    renderView({ block: 'mini/notes', select: 'graph' });

    expect(screen.queryByTestId('block-map')).not.toBeInTheDocument();
    expect(screen.getByTestId('block-document')).toBeInTheDocument();
  });

  it("names its file in the document's bar, with a link that opens it", () => {
    renderView({ block: 'mini/gate' });

    const gate = miniPayload.blocks.find(block => block.id === 'mini/gate')!;
    const name = screen.getByTestId('block-file').textContent!;
    expect(gate.path.endsWith(name)).toBe(true);
    expect(screen.getByTestId('block-open-file')).toHaveAttribute(
      'href',
      `vscode://file${gate.path}`
    );
  });

  it('shows the Layers strip for the block under the bar', () => {
    renderView({ block: 'mini/gate' });

    const strip = screen.getByTestId('layer-strip');
    expect(
      within(strip).getAllByTestId('layer-strip-entry').length
    ).toBeGreaterThan(0);
  });
});

describe('BlockView: Blocks and Rendered', () => {
  it('switches to the rendered view through the URL', async () => {
    const patch = renderView({ block: 'mini/gate' }, { renderedPath: '/r.md' });

    await userEvent.click(screen.getByRole('radio', { name: 'Rendered' }));

    expect(patch).toHaveBeenCalledWith({ view: 'rendered' });
  });

  it("shows the compiled file at the block's rendered lines", async () => {
    const lines = Array.from({ length: 70 }, (_, i) => `line ${i + 1}`);
    sourceGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        path: '/r.md',
        content: lines.join('\n'),
        lines: 70,
      }),
    });
    renderView(
      { block: 'mini/gate', view: 'rendered' },
      { renderedPath: '/r.md' }
    );

    const rendered = await screen.findByTestId('block-rendered');
    expect(rendered).toHaveTextContent('line 49');
    expect(rendered).toHaveTextContent('line 56');
    expect(rendered).not.toHaveTextContent('line 48');
    expect(rendered).not.toHaveTextContent('line 57');
    expect(sourceGet).toHaveBeenCalledWith({
      query: { pack: 'acme', path: '/r.md' },
    });
  });
});

describe('BlockView: a hand-written skill', () => {
  const tree = headingTree(
    '# Gadgets\n\nBuilds gadgets.\n\n## Build\n\nBuild them.\n\n## Check\n\nCheck them.',
    'gadgets',
    '/acme/gadgets/SKILL.md'
  );

  it('reads its headings as a read-only tree, with no Copy for Claude', () => {
    renderView({ focus: 'gadgets' }, { payload: tree, readOnly: true });

    expect(screen.getByTestId('read-only-note')).toHaveTextContent(
      'Standard skill: read from its headings, not built from blocks.'
    );
    expect(
      within(screen.getAllByTestId('section-band')[0])
        .getAllByTestId('block-row')
        .map(row => row.textContent)
    ).toEqual(['Build', 'Check']);
    expect(
      screen.queryByRole('button', { name: 'Copy for Claude' })
    ).not.toBeInTheDocument();
  });

  it('opens a heading section as a block without Copy for Claude', () => {
    renderView(
      { focus: 'gadgets', block: 'gadgets/build' },
      { payload: tree, readOnly: true }
    );

    expect(screen.getByText('Build them.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy for Claude' })
    ).not.toBeInTheDocument();
  });
});

describe('BlockView: Used by and History', () => {
  const shared = (
    id: string,
    parentId: string,
    extra: Partial<PayloadBlock> = {}
  ): PayloadBlock => ({
    ...miniPayload.blocks.find(block => block.id === 'mini/notes')!,
    id,
    parentId,
    title: 'Gate protocol',
    label: 'Gate protocol',
    kind: 'shared',
    props: [],
    segments: [
      {
        layer: 'default',
        color: 'mattstack',
        prop: null,
        text: '## Gate protocol\n\nHow a gate asks.',
      },
    ],
    ...extra,
  });
  const withShared: BlocksPayload = {
    ...miniPayload,
    blocks: [
      ...miniPayload.blocks,
      shared('gate-protocol', 'mini'),
      shared('gate-protocol/ask', 'gate-protocol', {
        title: 'Ask',
        label: 'Ask',
      }),
    ],
    includes: [{ name: 'gate-protocol', blockId: 'mini' }],
  };
  const composition = designFixture('composition');
  const check = designFixture('check');
  const context = {
    composition,
    check,
    groups: buildFocusGroups(composition, check),
    pipeline: null,
    anatomy: designFixture('anatomy.work'),
    anatomyError: null,
    onFocus: vi.fn(),
  };

  it('lists the skills that include a shared block, from anywhere inside it, pipeline steps first', async () => {
    renderView(
      { block: 'gate-protocol/ask' },
      { payload: withShared, context }
    );

    const usedBy = screen.getByTestId('block-used-by');
    const rows = () =>
      within(usedBy)
        .getAllByTestId('used-by-row')
        .map(row => row.textContent);
    expect(rows()).toHaveLength(6);
    expect(rows()[0]).toBe('workpipeline step');
    await userEvent.click(
      within(usedBy).getByRole('button', { name: /^Show all/ })
    );
    expect(rows().some(row => row?.startsWith('review'))).toBe(true);
  });

  it('says plainly when no skill pastes the block, with no note about the skills above', () => {
    renderView(
      { block: 'gate-protocol/ask' },
      {
        payload: withShared,
        context: {
          ...context,
          composition: {
            ...composition,
            verbs: composition.verbs.map(verb => ({ ...verb, includes: [] })),
            targets: composition.targets!.map(target => ({
              ...target,
              placeholders: target.placeholders.filter(
                p => p.kind !== 'include'
              ),
            })),
          },
        },
      }
    );

    const usedBy = screen.getByTestId('block-used-by');
    expect(usedBy).toHaveTextContent(
      'No skill in this pack includes gate-protocol directly.'
    );
    expect(usedBy).not.toHaveTextContent('One copy for every skill above');
  });

  it('shows no Used by on a block of the skill itself', () => {
    renderView({ block: 'mini/gate' }, { payload: withShared, context });

    expect(screen.queryByTestId('block-used-by')).not.toBeInTheDocument();
  });

  const shipContext = { ...context, anatomy: designFixture('anatomy.ship') };
  const fileCells = () =>
    screen
      .getAllByTestId('built-from-row')
      .map(row => row.querySelector('[data-parity="f"]')?.textContent);

  it("lists a block's History from its prop files, after one engine row", () => {
    renderView(
      { focus: 'ship', block: 'ship/flow/domain-fast-checks' },
      { payload: shipPayload, context: shipContext }
    );

    expect(screen.getByTestId('history-heading')).toHaveTextContent('In ship');
    expect(fileCells()).toEqual([
      'flow/domain-fast-checks.block.md',
      'ship-lint/base-checks.md',
      'ship-lint/fast-checks.md',
    ]);
    const [engine] = screen.getAllByTestId('built-from-row');
    expect(engine).toHaveTextContent('engine');
    expect(engine).toHaveTextContent('mattstack 0.32.23');
    expect(screen.queryByTestId('history-no-copy')).not.toBeInTheDocument();
  });

  it('gives a block with no props its engine row alone', () => {
    renderView(
      { focus: 'ship', block: 'ship/flow/stash-them' },
      { payload: shipPayload, context: shipContext }
    );

    expect(fileCells()).toEqual(['flow/stash-them.block.md']);
  });

  it('keeps the whole build on the skill itself', () => {
    renderView(
      { focus: 'ship' },
      { payload: shipPayload, context: shipContext }
    );

    expect(
      screen.getByRole('region', { name: 'Built from' })
    ).toBeInTheDocument();
    expect(screen.queryByTestId('history-heading')).not.toBeInTheDocument();
    expect(fileCells()).toContain('ship/index.block.md');
  });

  it("names the org base's file in History as the org base's", () => {
    renderView(
      { focus: 'ship', block: 'ship/flow/domain-fast-checks' },
      { payload: shipPayload, context: shipContext }
    );

    const base = screen
      .getAllByTestId('built-from-row')
      .find(row => row.textContent?.startsWith('ship-lint/base-checks.md'))!;
    expect(base).toHaveTextContent('acme-base 0.1.0');
    expect(base).toHaveTextContent('org base');
  });

  it("gives each Includes row its include's name, length and the skills that include it", () => {
    renderView({ focus: 'ship' }, { payload: shipPayload, context });

    const band = screen
      .getAllByTestId('section-band')
      .find(b => b.getAttribute('aria-label') === 'Includes')!;
    expect(band).toHaveTextContent('4 attachments');
    const gate = within(band)
      .getAllByTestId('block-row')
      .find(row => row.textContent?.startsWith('Gate protocol'))!;
    expect(gate).toHaveTextContent(/gate-protocol · \d+ lines · in \d+ skills/);
    expect(gate.querySelector('[data-glyph]')).toBeNull();
    const browser = within(band)
      .getAllByTestId('block-row')
      .find(row => row.textContent?.startsWith('Browser evidence'))!;
    expect(browser).toHaveTextContent(/· in 1 skill$/);
  });

  it("says why History is missing when the skill's build cannot be read", () => {
    renderView(
      {},
      {
        context: { ...context, anatomy: undefined, anatomyError: 'no anatomy' },
      }
    );
    expect(screen.getByTestId('history-unavailable')).toHaveTextContent(
      'History unavailable: no anatomy'
    );
  });
});
