import '../../icons';

import { useState } from 'react';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { GateQuestion, GateRow } from '@mattstack/rt-client';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { StoryEntry } from '../derive/story';
import { answeredWith, AT, gateOf } from './decisionFixtures';

const { StageRow } = await import('./StageRow');
const { Story } = await import('./Story');

const question = (id: string, label: string, picked: string): GateQuestion => ({
  id,
  label,
  multi: false,
  options: [
    { value: picked, label: `${picked} (Recommended)` },
    { value: 'other', label: 'Something else' },
  ],
});

const planGates: GateRow[] = [
  gateOf({
    id: 'g-approach',
    answer: answeredWith({
      approach: { value: 'backend', note: 'Recipients need it too' },
    }),
  }),
  gateOf({
    id: 'g-scope',
    openedAt: AT + 60_000,
    questions: [question('scope', 'Scope', 'Both')],
    answer: answeredWith({ scope: 'Both' }),
  }),
  gateOf({
    id: 'g-spec',
    openedAt: AT + 120_000,
    questions: [question('spec', 'Spec review', 'Approve')],
    answer: answeredWith({ spec: 'Approve' }),
  }),
];

const planEntry = (over: Partial<StoryEntry> = {}): StoryEntry => ({
  key: 'plan#1',
  attempt: {
    stage: 'plan',
    attempt: 1,
    status: 'done',
    startedAt: AT - 120_000,
    endedAt: AT - 60_000,
  } as StoryEntry['attempt'],
  label: 'plan',
  durationMs: 60_000,
  fields: [
    {
      key: 'approach',
      value: 'Superpowers: spec, plan, then subagent tasks',
      produced_by: 'plan',
      at: AT - 90_000,
    },
  ],
  gates: planGates,
  holds: [],
  failure: null,
  redirect: null,
  evidence: null,
  ...over,
});

function Harness({ start = false }: { start?: boolean }) {
  const [open, setOpen] = useState(start);
  return (
    <StageRow
      entry={planEntry()}
      open={open}
      onToggle={() => setOpen(o => !o)}
      repo="remote:acme%2Fweb"
      runId="20261008-1338"
      evidenceField={null}
    />
  );
}

describe('StageRow', () => {
  it('sums a folded stage up in one line', () => {
    renderWithProviders(<Harness />);
    expect(
      screen.getByText('3 decisions · Backend gap-fill + component work')
    ).toBeInTheDocument();
  });

  it('draws no fields or decisions while folded', () => {
    renderWithProviders(<Harness />);
    expect(screen.queryByText('Which approach?')).toBeNull();
    expect(screen.queryByText('Approach')).toBeNull();
    expect(screen.queryByText('Stage doc')).toBeNull();
  });

  it('opens when its head is clicked', async () => {
    renderWithProviders(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Show plan' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(screen.getByText('plan'));
    expect(screen.getByRole('button', { name: 'Hide plan' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByText('Approach')).toBeInTheDocument();
    expect(screen.getByText('Which approach?')).toBeInTheDocument();
    expect(screen.getByText('Spec review')).toBeInTheDocument();
    expect(screen.getByText('Stage doc')).toBeInTheDocument();
  });

  it('opens a decision to the pick, the options passed on and the note', async () => {
    renderWithProviders(<Harness start />);
    expect(screen.queryByText('Passed on')).toBeNull();
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Show details' })[0]!
    );
    const open = screen
      .getByText('Passed on')
      .closest('[data-parity="decision open"]') as HTMLElement;
    expect(
      within(open).getByText('Backend gap-fill + component work')
    ).toBeInTheDocument();
    for (const text of [
      'Panel component only, mock the data',
      'Spike first, then decide',
    ])
      expect(within(open).getByText(text)).toBeInTheDocument();
    expect(
      within(open).getByText('“Recipients need it too”')
    ).toBeInTheDocument();
  });

  it('starts the newest finished stage opened and the earlier ones folded', () => {
    const gates: StoryEntry = {
      ...planEntry({ gates: [] }),
      key: 'gates#1',
      label: 'gates',
      attempt: { ...planEntry().attempt, stage: 'gates' },
      fields: [
        {
          key: 'extra-gate',
          value: 'read the area docs',
          produced_by: 'gates',
          at: AT,
        },
      ],
    };
    renderWithProviders(
      <Story
        repo="remote:acme%2Fweb"
        runId="20261008-1338"
        label="Story so far"
        entries={[planEntry(), gates]}
        evidenceField={null}
      />
    );
    expect(screen.getByRole('button', { name: 'Show plan' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    const newest = screen.getByRole('button', { name: 'Hide gates' });
    expect(newest).toHaveAttribute('aria-expanded', 'true');
    expect(
      document.getElementById(newest.getAttribute('aria-controls')!)
    ).toHaveTextContent('read the area docs');
    expect(screen.queryByText('Which approach?')).toBeNull();
  });
});
