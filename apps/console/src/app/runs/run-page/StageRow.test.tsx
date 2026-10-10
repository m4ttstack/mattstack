import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { GateQuestion, GateRow } from '@mattstack/rt-client';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { StoryEntry } from '../derive/story';
import { answeredWith, AT, gateOf } from './decisionFixtures';

const { StagePane } = await import('./StageRow');
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

const story = (entries: StoryEntry[]) =>
  renderWithProviders(
    <Story
      repo="remote:acme%2Fweb"
      runId="20261008-1338"
      label="Story so far"
      entries={entries}
      evidenceField={null}
    />
  );

const gatesEntry = (): StoryEntry => ({
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
});

/** A stage's item in the story's list. */
const itemOf = (stage: string) =>
  document.querySelector<HTMLElement>(`nav [data-stage="${stage}"]`)!;

/** The stage the pane shows. */
const paneStage = () =>
  document
    .querySelector('[data-testid="story"] div > [data-stage]:not(button)')
    ?.getAttribute('data-stage');

describe('StagePane', () => {
  const pane = () =>
    renderWithProviders(
      <StagePane
        entry={planEntry()}
        repo="remote:acme%2Fweb"
        runId="20261008-1338"
        evidenceField={null}
      />
    );

  it('draws the stage doc, fields and every decision', () => {
    pane();
    expect(screen.getByText('Stage doc')).toBeInTheDocument();
    expect(screen.getByText('Approach')).toBeInTheDocument();
    expect(screen.getByText('Which approach?')).toBeInTheDocument();
    expect(screen.getByText('Spec review')).toBeInTheDocument();
  });

  it('shows a decision as its answered form: every option, the pick and the note', () => {
    pane();
    const pick = screen
      .getByText('Backend gap-fill + component work')
      .closest('[data-picked]');
    expect(pick).not.toBeNull();
    for (const text of [
      'Panel component only, mock the data',
      'Spike first, then decide',
    ]) {
      expect(screen.getByText(text).closest('[data-picked]')).toBeNull();
    }
    expect(screen.getByText('Recipients need it too')).toBeInTheDocument();
  });
});

describe('Story', () => {
  it('lists each stage with a one-line summary', () => {
    story([planEntry(), gatesEntry()]);
    expect(itemOf('plan')).toHaveTextContent(
      '3 decisions · Backend gap-fill + component work'
    );
  });

  it('starts on the newest finished stage and shows another when it is picked', async () => {
    story([planEntry(), gatesEntry()]);
    expect(itemOf('gates')).toHaveAttribute('aria-current', 'step');
    expect(paneStage()).toBe('gates');
    expect(screen.getByText('read the area docs')).toBeInTheDocument();
    expect(screen.queryByText('Which approach?')).toBeNull();
    await userEvent.click(itemOf('plan'));
    expect(paneStage()).toBe('plan');
    expect(screen.getByText('Which approach?')).toBeInTheDocument();
  });

  it('starts on the newest finished stage while a later one runs', () => {
    const running: StoryEntry = {
      ...planEntry({ gates: [] }),
      key: 'implement#1',
      label: 'implement',
      attempt: {
        ...planEntry().attempt,
        stage: 'implement',
        status: 'running',
      },
    };
    story([planEntry(), running]);
    expect(itemOf('plan')).toHaveAttribute('aria-current', 'step');
  });

  it('draws one stage alone with no list', () => {
    story([planEntry()]);
    expect(document.querySelector('nav')).toBeNull();
    expect(screen.getByText('Which approach?')).toBeInTheDocument();
  });
});
