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

  it("says the skill's summary once, not again as the root's first line", () => {
    renderView();

    expect(
      screen.getAllByText('Runs the step, then asks for a decision.')
    ).toHaveLength(1);
  });

  it("heads a section band with its block's graph card, which opens that graph", async () => {
    const patch = renderView({ focus: 'ship' }, { payload: shipPayload });

    const flow = screen
      .getAllByTestId('section-band')
      .find(band => band.getAttribute('aria-label') === 'Flow')!;
    const card = within(flow).getByTestId('graph-card');
    expect(card).toHaveTextContent(/\d+ steps · \d+ links/);
    await userEvent.click(within(card).getByText('View graph'));
    expect(patch).toHaveBeenCalledWith({ block: 'ship/flow', select: 'graph' });
  });

  it('opens every folded row with Expand all, and folds them again', async () => {
    renderView();

    expect(screen.queryAllByTestId('block-row-body')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByTestId('block-row-body')).toHaveLength(4);
    expect(
      screen.getByText('Keep notes short.', { selector: 'p' })
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryAllByTestId('block-row-body')).toHaveLength(0);
  });

  it("says the root's first paragraph under the title, in place of the skill's description", () => {
    renderView(
      { focus: 'ship' },
      {
        payload: shipPayload,
        skill: {
          title: 'ship',
          kind: 'on-demand',
          description: 'Pushes the branch and opens the merge request.',
          status: null,
          checkError: null,
          loading: false,
        },
      }
    );

    const header = screen.getByTestId('focus-header');
    expect(header).toHaveTextContent(
      "The pipeline's ship stage, reached directly"
    );
    expect(
      screen.queryByText('Pushes the branch and opens the merge request.')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('pack-line')).toHaveTextContent(
      /widgets extends acme-base extends mattstack ship · \d+ blocks, \d+ with props, \d+ prop values, 2 graphs, 5 shared/
    );
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

  it("shows a graph's Mermaid source from its card", async () => {
    renderView({ focus: 'ship' }, { payload: shipPayload });

    const flow = screen
      .getAllByTestId('section-band')
      .find(band => band.getAttribute('aria-label') === 'Flow')!;
    const card = within(flow).getByTestId('graph-card');
    expect(within(flow).queryByTestId('graph-source')).toBeNull();
    await userEvent.click(
      within(card).getByRole('button', { name: 'Mermaid source' })
    );
    expect(within(flow).getByTestId('graph-source')).toHaveTextContent(
      'flowchart TB'
    );
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
    expect(within(band).queryByText('Run')).not.toBeInTheDocument();

    await userEvent.click(within(crumbs).getByText('mini'));
    expect(patch).toHaveBeenCalledWith({ block: null, select: null });
  });

  it('offers Expand all, not Copy for Claude or the file menu', () => {
    renderView({ focus: 'ship', block: 'ship/flow' }, { payload: shipPayload });

    expect(
      screen.getByRole('button', { name: 'Expand all' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy for Claude' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'File' })
    ).not.toBeInTheDocument();
  });

  it('says its first paragraph under the title, and the counts of what is under it', () => {
    renderView({ focus: 'ship', block: 'ship/flow' }, { payload: shipPayload });

    const header = screen.getByTestId('focus-header');
    expect(header).toHaveTextContent(
      '<root> is the worktree root, the absolute path git rev-parse --show-toplevel prints.'
    );
    expect(screen.getByTestId('pack-line')).toHaveTextContent(
      'widgets extends acme-base extends mattstack ship · 21 blocks, 13 with props, 4 prop values, 1 graph'
    );
  });

  it('keeps the counts dot with the engine chip and the first count, so a wrap never strands it', () => {
    renderView({ focus: 'ship', block: 'ship/flow' }, { payload: shipPayload });

    const held = screen.getByTestId('pack-line-held');
    expect(held).toHaveTextContent(/^mattstack ship · 21 blocks,$/);
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

  it("marks a block node with its block's kind glyph", () => {
    renderView({ block: 'mini/gate' });

    const gate = within(screen.getByTestId('around-graph'))
      .getAllByTestId('around-block')
      .find(node => node.textContent === 'Gate')!;
    expect(gate.querySelector('[data-glyph="gate"]')).not.toBeNull();
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

  it('shows its path in the skill beside the ⋯ menu, which holds Open file', async () => {
    renderView({ block: 'mini/gate' });

    const gateBlock = miniPayload.blocks.find(b => b.id === 'mini/gate')!;
    expect(screen.getByTestId('block-path')).toHaveTextContent(
      gateBlock.path.slice(miniPayload.dir.length + 1)
    );
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

  it('names the block file a skill pastes the shared block from, with its line', () => {
    renderView(
      { block: 'gate-protocol/ask' },
      { payload: withShared, context }
    );

    const review = within(screen.getByTestId('block-used-by'))
      .getAllByTestId('used-by-row')
      .find(row => row.textContent?.startsWith('review/SKILL.md'))!;
    expect(review).toHaveTextContent('pastes it at review/index.block.md L786');
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
      'No skill in this pack pastes gate-protocol in directly.'
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

    expect(screen.getByTestId('history-heading')).toHaveTextContent(
      'Built from'
    );
    expect(fileCells()).toContain('ship/index.block.md');
  });

  it("scopes a block's commit timeline to its files inside the pack", () => {
    const anatomy = designFixture('anatomy.ship');
    for (const part of anatomy.parts)
      if (part.source?.path.endsWith('/fast-checks.md'))
        part.source.path =
          '/fixture/packs/acme/attachments/ship-lint/fast-checks.md';
    renderView(
      { focus: 'ship', block: 'ship/flow/domain-fast-checks' },
      { payload: shipPayload, context: { ...context, anatomy } }
    );

    expect(screen.getByTestId('version-timeline')).toBeInTheDocument();
    expect(historyGet).toHaveBeenCalledWith({
      query: {
        pack: 'acme',
        verb: 'ship',
        path: ['attachments/ship-lint/fast-checks.md'],
      },
    });
  });

  it('draws no timeline for a block whose files all live outside the pack', () => {
    renderView(
      { focus: 'ship', block: 'ship/flow/domain-fast-checks' },
      { payload: shipPayload, context: shipContext }
    );

    expect(screen.queryByTestId('version-timeline')).not.toBeInTheDocument();
  });

  it("gives each Shared row its include's name, length and the skills that paste it", () => {
    renderView({ focus: 'ship' }, { payload: shipPayload, context });

    const band = screen
      .getAllByTestId('section-band')
      .find(b => b.getAttribute('aria-label') === 'Shared')!;
    expect(band).toHaveTextContent('4 blocks · same for everyone');
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
