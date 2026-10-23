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
import { miniPayload } from './blocksFixture';

const sourceGet = vi.fn();

vi.mock('../../../api', () => ({
  client: {
    api: {
      skills: {
        source: { $get: (...args: unknown[]) => sourceGet(...args) },
      },
      settings: {
        'default-editor': {
          $get: () => Promise.resolve({ ok: true, json: async () => ({}) }),
        },
      },
    },
  },
}));

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
      'Notes',
    ]);
    expect(
      within(bands[0])
        .getAllByTestId('block-row')
        .map(row => row.textContent)
    ).toEqual([
      'GuardGuard text with no title line.',
      'CheckConfirm the widget works.',
    ]);
    expect(screen.getByRole('region', { name: 'Layers' })).toBeInTheDocument();
  });

  it('marks a row whose block has props with a plug and its layer dots', () => {
    renderView();

    const notes = screen
      .getAllByTestId('section-band')
      .find(band => band.getAttribute('aria-label') === 'Notes')!;
    const gate = within(notes)
      .getAllByTestId('block-row')
      .find(row => row.textContent?.startsWith('Gate'))!;
    expect(within(gate).getByTestId('row-has-props')).toBeInTheDocument();
  });

  it('opens a block from its row', async () => {
    const patch = renderView();

    await userEvent.click(
      screen
        .getAllByTestId('block-row')
        .find(row => row.textContent?.startsWith('Check'))!
    );

    expect(patch).toHaveBeenCalledWith({
      block: 'mini/run/check',
      select: null,
    });
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
  it('shows a breadcrumb, its own text without its title line, and its children', async () => {
    const patch = renderView({ block: 'mini/run' });

    const crumbs = screen.getByTestId('block-crumbs');
    expect(crumbs).toHaveTextContent('mini');
    expect(crumbs).toHaveTextContent('Run');
    const header = screen.getByTestId('focus-header');
    expect(within(header).getByText('Run')).toBeInTheDocument();
    expect(within(header).getByText('Run the step')).toBeInTheDocument();
    expect(screen.getByText('Do the work for the widget.')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Run the step' })
    ).not.toBeInTheDocument();
    const [band] = screen.getAllByTestId('section-band');
    expect(within(band).getAllByTestId('block-row')).toHaveLength(2);

    await userEvent.click(within(crumbs).getByText('mini'));
    expect(patch).toHaveBeenCalledWith({ block: null, select: null });
  });

  it("draws the skill's graph card and opens the whole graph from it", async () => {
    const patch = renderView();

    const card = screen.getByTestId('graph-card');
    expect(card).toHaveTextContent('4 steps · 3 links');
    await userEvent.click(within(card).getByText('View graph'));
    expect(patch).toHaveBeenCalledWith({ select: 'graph' });
  });
});

describe('BlockView: a single block', () => {
  it('names its kind and its props in chips, and its full title under the label', () => {
    renderView({ block: 'mini/gate' });

    const header = screen.getByTestId('focus-header');
    expect(within(header).getByText('Gate')).toBeInTheDocument();
    expect(within(header).getByText('Ask the gate')).toBeInTheDocument();
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

  it('draws Around this block with block nodes under their short labels', () => {
    renderView({ block: 'mini/gate' });

    const around = screen.getByTestId('around-graph');
    expect(
      within(around)
        .getAllByTestId('around-block')
        .map(node => node.textContent)
    ).toEqual(['Run', 'Gate']);
    expect(screen.getAllByText('Around this block')).toHaveLength(1);
  });

  it('opens a block from its node in Around this block', () => {
    const patch = renderView({ block: 'mini/gate' });

    fireEvent.click(
      within(screen.getByTestId('around-graph'))
        .getAllByTestId('around-block')
        .find(node => node.textContent === 'Run')!
    );

    expect(patch).toHaveBeenCalledWith({ block: 'mini/run', select: null });
  });

  it('shows the whole graph in place of the small one, with a way back', async () => {
    const patch = renderView({ block: 'mini/gate', select: 'graph' });

    expect(screen.queryByTestId('around-graph')).not.toBeInTheDocument();
    const whole = screen.getByTestId('whole-graph');
    expect(within(whole).getAllByTestId('around-step')).toHaveLength(2);
    await userEvent.click(within(whole).getByText('Close graph'));
    expect(patch).toHaveBeenCalledWith({ select: null });
  });

  it('keeps the path and Open file behind the ⋯ menu', async () => {
    renderView({ block: 'mini/gate' });

    expect(
      screen.queryByText('attachments/pipeline/mini/gate.block.md')
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'File' }));
    expect(
      await screen.findByText('attachments/pipeline/mini/gate.block.md')
    ).toBeInTheDocument();
    const gate = miniPayload.blocks.find(block => block.id === 'mini/gate')!;
    expect(screen.getByRole('menuitem', { name: 'Open file' })).toHaveAttribute(
      'href',
      `vscode://file${gate.path}`
    );
  });

  it('shows the Layers strip for the block instead of the map', () => {
    renderView({ block: 'mini/gate' });

    const layers = screen.getByRole('region', { name: 'Layers' });
    expect(within(layers).getAllByTestId('layers-strip-row').length).toBe(2);
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

  it('reads its headings as a read-only tree, with no Layers or Copy for Claude', () => {
    renderView({ focus: 'gadgets' }, { payload: tree, readOnly: true });

    expect(screen.getByTestId('read-only-note')).toHaveTextContent(
      'Hand-written: read from its headings, not built from blocks.'
    );
    expect(
      within(screen.getAllByTestId('section-band')[0])
        .getAllByTestId('block-row')
        .map(row => row.textContent)
    ).toEqual(['BuildBuild them.', 'CheckCheck them.']);
    expect(
      screen.queryByRole('region', { name: 'Layers' })
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

  it('lists the skills that paste a shared block in, from anywhere inside it', () => {
    renderView(
      { block: 'gate-protocol/ask' },
      { payload: withShared, context }
    );

    const usedBy = screen.getByTestId('block-used-by');
    expect(
      within(usedBy)
        .getAllByTestId('used-by-row')
        .map(row => row.textContent?.split('pastes')[0])
    ).toContain('review/SKILL.md');
  });

  it('shows no Used by on a block of the skill itself', () => {
    renderView({ block: 'mini/gate' }, { payload: withShared, context });

    expect(screen.queryByTestId('block-used-by')).not.toBeInTheDocument();
  });

  it("shows the block file's History, and the skill's on the skill", () => {
    renderView({ block: 'mini/gate' }, { context });
    expect(screen.getByTestId('block-history')).toBeInTheDocument();
    expect(screen.getByTestId('history-heading')).toHaveTextContent('In work');
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
