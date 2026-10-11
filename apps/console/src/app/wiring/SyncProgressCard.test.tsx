import '../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STALL_AFTER_MS, SyncProgressCard } from './SyncProgressCard';

const START = new Date('2026-10-10T12:00:00Z').getTime();

describe('SyncProgressCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the pack, says what sync does, and counts from the click', () => {
    renderWithProviders(<SyncProgressCard pack="demo" startedAt={START} />);

    const card = screen.getByTestId('sync-progress-card');
    expect(card).toHaveAttribute('data-tone', 'accent');
    expect(card).toHaveTextContent('Syncing demo');
    expect(card).toHaveTextContent(
      'Pulling, compiling and publishing the pack; this can take a minute'
    );
    expect(screen.getByTestId('sync-progress-elapsed')).toHaveTextContent(
      'Syncing · 0s'
    );
  });

  it('ticks the elapsed counter each second', () => {
    renderWithProviders(<SyncProgressCard pack="demo" startedAt={START} />);

    act(() => {
      vi.advanceTimersByTime(14_000);
    });

    expect(screen.getByTestId('sync-progress-elapsed')).toHaveTextContent(
      'Syncing · 14s'
    );
  });

  it('turns warn and says it is still running once the stall threshold passes', () => {
    renderWithProviders(<SyncProgressCard pack="demo" startedAt={START} />);

    act(() => {
      vi.advanceTimersByTime(STALL_AFTER_MS - 1000);
    });
    expect(screen.getByTestId('sync-progress-card')).toHaveAttribute(
      'data-tone',
      'accent'
    );

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    const card = screen.getByTestId('sync-progress-card');
    expect(STALL_AFTER_MS).toBe(90_000);
    expect(card).toHaveAttribute('data-tone', 'warn');
    expect(screen.getByTestId('sync-progress-elapsed')).toHaveTextContent(
      'Still running · 95s'
    );
    expect(card).toHaveTextContent('Syncing demo');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
