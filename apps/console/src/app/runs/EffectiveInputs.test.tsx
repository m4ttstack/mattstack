import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { RunDecisionRow } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EffectiveInputsPayload } from '../../server/effectiveInputs';

const effectiveInputsGet = vi.fn();
const stageDocGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      runs: {
        ':repo': {
          ':runId': {
            'effective-inputs': {
              $get: (...args: unknown[]) => effectiveInputsGet(...args),
            },
            'stage-doc': {
              $get: (...args: unknown[]) => stageDocGet(...args),
            },
          },
        },
      },
    },
  },
}));

const { EffectiveInputs } = await import('./EffectiveInputs');
const { InputsDrawer } = await import('./run-page/InputsDrawer');

function ok(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function fail(status: number, error: string) {
  return { ok: false, status, json: async () => ({ error }) };
}

const PLAN_DOC = [
  '---',
  'name: stage-plan',
  '---',
  '',
  '# Plan',
  '',
  'Read the ticket, then write the plan.',
  '',
  '- Which approach the run takes',
].join('\n');

const PAYLOAD: EffectiveInputsPayload = {
  pipeline: 'work',
  workType: 'feature',
  packVersions: [
    {
      pack: 'acme',
      recordedSha: '4c1d9e2b7a',
      currentSha: '4c1d9e2b7a51',
      drifted: false,
    },
    {
      pack: 'acme-base',
      recordedSha: '71b0e44c9d',
      currentSha: 'a92f3e1b07',
      drifted: true,
      commitsSince: 3,
    },
  ],
  packDirty: false,
  stages: ['provision', 'plan', 'gates'],
  config: [
    {
      key: 'rt.worktrees',
      value: '~/.mattstack/rt/worktrees',
      provenance: [{ scope: 'user', file: '/u' }],
      description: 'Per-repo worktree pool.',
      layers: [
        { scope: 'default', value: '~/worktrees' },
        { scope: 'team' },
        { scope: 'user', value: '~/.mattstack/rt/worktrees' },
      ],
    },
    {
      key: 'rt.runsPruneDays',
      value: 30,
      provenance: [{ scope: 'default', file: null }],
    },
  ],
};

const DECISIONS: RunDecisionRow[] = [
  {
    contract: 'execution-strategy@1',
    scope: 'implement:1',
    selection: '{"strategy":"subagent-driven","tasks":5}',
    decided_by: 'agent',
    decided_at: new Date(2026, 9, 8, 15, 49).getTime(),
  },
];

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPanel({
  decisions = DECISIONS,
}: { decisions?: RunDecisionRow[] } = {}) {
  return renderWithProviders(
    <QueryClientProvider client={client()}>
      <EffectiveInputs repo="acme" runId="run-1" decisions={decisions} />
    </QueryClientProvider>
  );
}

function renderDrawer() {
  return renderWithProviders(
    <QueryClientProvider client={client()}>
      <InputsDrawer
        repo="acme"
        runId="run-1"
        decisions={DECISIONS}
        opened
        onClose={() => {}}
      />
    </QueryClientProvider>
  );
}

async function openRow(testId: string) {
  const row = await screen.findByTestId(testId);
  await userEvent.click(within(row).getByRole('button', { expanded: false }));
}

beforeEach(() => {
  window.history.pushState(null, '', '/runs/acme/run-1?inputs');
  effectiveInputsGet.mockResolvedValue(ok(PAYLOAD));
  stageDocGet.mockImplementation(
    async ({ query }: { query: { stage: string } }) =>
      query.stage === 'gates'
        ? fail(404, 'no compiled doc recorded at this version')
        : ok({ text: PLAN_DOC, pack: 'acme', sha: '4c1d9e2b7a' })
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('EffectiveInputs', () => {
  it('draws the four sections the board names', async () => {
    renderPanel();

    for (const name of [
      'Packs',
      'Stage docs',
      'Decisions in force',
      'Configuration (current values)',
    ])
      expect(await screen.findByText(name)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Runs don't record the config they read, so these are today's values."
      )
    ).toBeInTheDocument();
  });

  it('names each pack at its short sha with whether its source moved', async () => {
    renderPanel();

    const acme = await screen.findByTestId('pack-row-acme');
    expect(acme).toHaveTextContent('4c1d9e2');
    expect(within(acme).getByText('matches source')).toBeInTheDocument();
    const base = screen.getByTestId('pack-row-acme-base');
    expect(
      within(base).getByText('moved since · 3 commits')
    ).toBeInTheDocument();
  });

  it('says when no pack version was recorded or the tree was dirty', async () => {
    effectiveInputsGet.mockResolvedValue(
      ok({ ...PAYLOAD, packVersions: null, packDirty: true })
    );

    renderPanel();

    expect(
      await screen.findByText('pre-v2 run — pack version not recorded')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'pack tree had uncommitted changes — the as-run text may exist in no commit'
      )
    ).toBeInTheDocument();
  });

  it('reads each decision as a sentence, not JSON', async () => {
    renderPanel();

    const row = await screen.findByTestId('decision-row-execution-strategy@1');
    expect(within(row).getByText('Execution strategy')).toBeInTheDocument();
    expect(
      within(row).getByText('Subagent-driven, 5 tasks')
    ).toBeInTheDocument();
    expect(within(row).getByText('implement · agent · 3:49 PM')).toBeVisible();
    expect(row).not.toHaveTextContent('{');
  });

  it('says so when no decision was recorded', async () => {
    renderPanel({ decisions: [] });

    expect(
      await screen.findByText('No decisions were recorded for this run.')
    ).toBeInTheDocument();
  });

  it('opens a stage doc inline, with no second dialog', async () => {
    renderDrawer();

    await openRow('stage-row-plan');

    const row = screen.getByTestId('stage-row-plan');
    expect(
      await within(row).findByText('Read the ticket, then write the plan.')
    ).toBeInTheDocument();
    expect(within(row).getByText('from acme')).toBeInTheDocument();
    expect(row).not.toHaveTextContent('name: stage-plan');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('says "no doc at this version" in the row of a stage with no doc', async () => {
    renderPanel();

    const row = await screen.findByTestId('stage-row-gates');
    expect(
      await within(row).findByText('no doc at this version')
    ).toBeInTheDocument();
  });

  it('swaps the inputs drawer for the stage doc drawer on "Open the full doc"', async () => {
    renderPanel();

    await openRow('stage-row-plan');
    await userEvent.click(await screen.findByText('Open the full doc →'));

    expect(window.location.search).toBe('?doc=plan');
  });

  it('opens a setting inline with its value per scope, with no second dialog', async () => {
    renderDrawer();

    await openRow('config-row-rt.worktrees');

    const row = screen.getByTestId('config-row-rt.worktrees');
    expect(
      within(row).getByText('Per-repo worktree pool.')
    ).toBeInTheDocument();
    const scopes = within(row)
      .getAllByTestId(/^scope-/)
      .map(el => el.textContent);
    expect(scopes).toEqual([
      'user~/.mattstack/rt/worktreesin effect',
      'teamnot set',
      'default~/worktrees',
    ]);
    expect(
      within(row).getByRole('link', { name: 'Change it in Settings →' })
    ).toHaveAttribute('href', '/settings?explain=rt.worktrees');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('pills the scope a value comes from, default included', async () => {
    renderPanel();

    const row = await screen.findByTestId('config-row-rt.runsPruneDays');
    expect(within(row).getByText('default')).toBeInTheDocument();
    expect(within(row).getByText('30')).toBeInTheDocument();
  });

  it('renders "unset" for a config row with no value', async () => {
    effectiveInputsGet.mockResolvedValue(
      ok({
        ...PAYLOAD,
        config: [{ key: 'rt.runaway', provenance: [] }],
      })
    );

    renderPanel();

    const row = await screen.findByTestId('config-row-rt.runaway');
    expect(within(row).getByText('unset')).toBeInTheDocument();
    expect(row).not.toHaveTextContent('undefined');
  });

  it('renders an inline error instead of throwing when the fetch fails', async () => {
    effectiveInputsGet.mockResolvedValue(fail(502, 'daemon unreachable'));

    expect(() => renderPanel()).not.toThrow();

    expect(
      await screen.findByTestId('effective-inputs-error')
    ).toHaveTextContent('daemon unreachable');
  });
});
