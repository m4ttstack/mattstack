import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { GateRow, RunSummary } from '@mattstack/rt-client';
import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Banner } from '../derive/lanes';

const { GateQueueStrip } = await import('./GateQueueStrip');

const MIN = 60_000;
const NOW = new Date(2026, 9, 15, 14, 0).getTime();

const run = (id: string, ticket: string | null): RunSummary =>
  ({
    id,
    repo: 'remote:acme%2Fweb',
    status: 'running',
    ticket,
  }) as RunSummary;

const entry = (
  id: string,
  ticket: string | null,
  kind: string,
  ageMin: number
): Banner => ({
  run: run(`run-${id}`, ticket),
  gate: {
    id,
    subject: `run:run-${id}`,
    kind,
    status: 'open',
    owner: 'human',
    openedAt: NOW - ageMin * MIN,
    questions: [],
  } as unknown as GateRow,
});

const QUEUE = [
  entry('g1', 'WEB-409', 'evidence', 12),
  entry('g2', 'WEB-411', 'plan', 3),
  entry('g3', null, 'ship', 1),
];

const strip = (queue: Banner[]) =>
  renderWithProviders(<GateQueueStrip queue={queue} now={NOW} />);

afterEach(() => history.replaceState(null, '', '/'));

describe('GateQueueStrip', () => {
  it('renders nothing when no other run waits on me', () => {
    const { queryByTestId } = strip([]);
    expect(queryByTestId('gate-queue')).toBeNull();
  });

  it('counts the queue and links each gate to its panel', () => {
    const { getByText, getByRole } = strip(QUEUE);
    expect(getByText('3 waiting on other runs')).toBeInTheDocument();
    expect(
      getByRole('link', { name: /WEB-411.*plan gate · 3m/ })
    ).toHaveAttribute('href', '/runs/remote:acme%2Fweb/run-g2#gate-g2');
  });

  it('names a run with no ticket by its gate alone', () => {
    const { getByRole } = strip(QUEUE);
    expect(getByRole('link', { name: 'ship gate · 1m' })).toBeInTheDocument();
  });

  it('opens the oldest gate from Answer next', () => {
    const { getByRole } = strip(QUEUE);
    expect(
      getByRole('link', { name: /Answer next · WEB-409/ })
    ).toHaveAttribute('href', '/runs/remote:acme%2Fweb/run-g1#gate-g1');
  });

  it('opens the oldest gate on g', () => {
    strip(QUEUE);
    fireEvent.keyDown(document.documentElement, { key: 'g' });
    expect(location.pathname + location.hash).toBe(
      '/runs/remote:acme%2Fweb/run-g1#gate-g1'
    );
  });

  it('leaves g to an open modal', () => {
    strip(QUEUE);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    fireEvent.keyDown(document.documentElement, { key: 'g' });
    dialog.remove();
    expect(location.pathname).toBe('/');
  });

  it('shows no more link for exactly three gates', () => {
    const { queryByRole } = strip(QUEUE);
    expect(queryByRole('link', { name: /more/ })).toBeNull();
  });

  it('shows three gates and sends the rest to the waiting runs', () => {
    const five = [
      ...QUEUE,
      entry('g4', 'WEB-415', 'plan', 1),
      entry('g5', 'WEB-416', 'plan', 1),
    ];
    const { getByRole, queryByRole } = strip(five);
    expect(queryByRole('link', { name: /WEB-415/ })).toBeNull();
    expect(getByRole('link', { name: '+2 more' })).toHaveAttribute(
      'href',
      '/?filter=waiting'
    );
  });
});
