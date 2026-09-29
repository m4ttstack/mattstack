import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { RefreshProgress } from '../../shared/types';

import '../icons';

import { RefreshStatus } from './RefreshStatus';
import { SkeletonStandings } from './SkeletonStandings';

const PROGRESS: RefreshProgress = {
  phase: 'mrs-detail',
  label: 'Fetching MR details',
  done: 142,
  total: 310,
  window: 'current',
  totals: { users: 7, 'mrs-list': 1 },
};

const phase = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-phase="${name}"]`) as HTMLElement;

describe('RefreshStatus', () => {
  it('shows the step, the count and the phases a warm refresh has finished', () => {
    const { container } = renderWithProviders(
      <RefreshStatus
        progress={PROGRESS}
        stalledMs={null}
        window="Aug 30 – Sep 29"
        cold={false}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Refreshing Aug 30 – Sep 29')).toBeInTheDocument();
    expect(
      screen.getByText('Showing the last good numbers until this finishes')
    ).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 7')).toBeInTheDocument();
    expect(container.querySelector('[data-parity="Count"]')?.textContent).toBe(
      '142 / 310'
    );

    expect(phase(container, 'Roster').dataset.state).toBe('done');
    expect(
      within(phase(container, 'Roster')).getByText('7 users')
    ).toBeTruthy();
    expect(phase(container, 'Merge requests').dataset.state).toBe('done');
    expect(
      within(phase(container, 'Merge requests')).getByText('310 MRs')
    ).toBeTruthy();
    expect(phase(container, 'MR details').dataset.state).toBe('active');
    expect(
      within(phase(container, 'MR details')).getByText('142 / 310')
    ).toBeTruthy();
    for (const name of ['Pipelines', 'Pushes', 'Linear issues', 'Compute']) {
      expect(phase(container, name).dataset.state).toBe('waiting');
      expect(within(phase(container, name)).getByText('waiting')).toBeTruthy();
    }

    const bar = container.querySelector(
      '[data-parity="Overall Bar"]'
    ) as HTMLElement;
    expect(parseFloat(bar.style.width)).toBeCloseTo(
      ((2 + 142 / 310) / 7) * 100,
      3
    );
  });

  it('names a cold, stalled build and lets the stall copy cancel it', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { container } = renderWithProviders(
      <>
        <RefreshStatus
          progress={PROGRESS}
          stalledMs={42_000}
          window="Aug 30 – Sep 29"
          cold
          onCancel={onCancel}
        />
        <SkeletonStandings />
      </>
    );

    expect(screen.getByText('Building Aug 30 – Sep 29')).toBeInTheDocument();
    expect(container.querySelector('[data-parity="RS Sub"]')?.textContent).toBe(
      'No progress for 42s · still waiting on GitLab, cancel to try again later'
    );
    expect(
      container
        .querySelector('[data-parity="Refresh Status"]')
        ?.getAttribute('data-tone')
    ).toBe('warn');
    expect(
      screen.getByRole('region', { name: 'Loading standings' })
    ).toBeInTheDocument();
    expect(container.querySelectorAll('[data-row]')).toHaveLength(6);

    await user.click(screen.getByRole('button', { name: 'cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('falls back to the raw label for a phase it does not know', () => {
    const { container } = renderWithProviders(
      <RefreshStatus
        progress={{
          ...PROGRESS,
          phase: 'mystery' as RefreshProgress['phase'],
          label: 'Doing something new',
        }}
        stalledMs={null}
        window="Aug 30 – Sep 29"
        cold={false}
        onCancel={vi.fn()}
      />
    );

    const active = container.querySelector('[data-state="active"]');
    expect(active?.textContent).toContain('Doing something new');
    expect(screen.queryByText(/^Step /)).not.toBeInTheDocument();
  });

  it('drops the count while a phase reports no total yet', () => {
    const { container } = renderWithProviders(
      <RefreshStatus
        progress={{ ...PROGRESS, phase: 'linear', done: 0, total: 0 }}
        stalledMs={null}
        window="Aug 30 – Sep 29"
        cold={false}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Step 6 of 7')).toBeInTheDocument();
    expect(container.querySelector('[data-parity="Count"]')).toBeNull();
    expect(
      within(phase(container, 'Linear issues')).getByText('working')
    ).toBeTruthy();
  });

  it('starts with every phase waiting before the first reading lands', () => {
    const { container } = renderWithProviders(
      <RefreshStatus
        progress={null}
        stalledMs={null}
        window="Aug 30 – Sep 29"
        cold={false}
        onCancel={vi.fn()}
      />
    );

    expect(container.querySelectorAll('[data-state="waiting"]')).toHaveLength(
      7
    );
  });
});
