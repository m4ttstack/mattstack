import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';

import '../icons';

import { customRangeLabel, PageHeader, type RangeState } from './PageHeader';

function renderHeader(range: RangeState = { range: '7d' }) {
  const props = {
    onRange: vi.fn(),
    onTrend: vi.fn(),
    onView: vi.fn(),
  };
  renderWithProviders(
    <PageHeader
      title="Leaderboard"
      subtitle={null}
      range={range}
      trend={false}
      view="table"
      {...props}
    />
  );
  return props;
}

const group = (name: string) => screen.getByRole('radiogroup', { name });
const checked = (name: string) =>
  within(group(name))
    .getAllByRole('radio')
    .filter(r => (r as HTMLInputElement).checked)
    .map(r => r.getAttribute('value'));

describe('PageHeader switches', () => {
  it('renders range, mode and view as segmented controls with one active segment each', () => {
    renderHeader();
    expect(checked('Range')).toEqual(['7d']);
    expect(checked('Mode')).toEqual(['values']);
    expect(checked('View')).toEqual(['table']);
    expect(
      within(group('Range'))
        .getAllByRole('radio')
        .map(r => r.getAttribute('value'))
    ).toEqual(['7d', '30d', '90d', 'custom']);
  });

  it('switches view, mode and preset range on click', async () => {
    const user = userEvent.setup();
    const { onRange, onTrend, onView } = renderHeader();
    await user.click(screen.getByRole('radio', { name: 'Cards view' }));
    expect(onView).toHaveBeenCalledWith('cards');
    await user.click(screen.getByRole('radio', { name: 'Trend' }));
    expect(onTrend).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('radio', { name: '30d' }));
    expect(onRange).toHaveBeenCalledWith('30d');
  });

  it('moves between segments with the arrow keys', async () => {
    const user = userEvent.setup();
    const { onView } = renderHeader();
    screen.getByRole('radio', { name: 'Table view' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onView).toHaveBeenCalledWith('cards');
  });

  it('opens the custom range picker and cancel restores the previous preset', async () => {
    const user = userEvent.setup();
    const { onRange } = renderHeader();
    await user.click(screen.getByRole('radio', { name: 'Custom' }));
    expect(checked('Range')).toEqual(['custom']);
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(checked('Range')).toEqual(['7d']);
    expect(onRange).not.toHaveBeenCalled();
  });

  it('closes on Escape without changing the range', async () => {
    const user = userEvent.setup();
    const { onRange } = renderHeader();
    await user.click(screen.getByRole('radio', { name: 'Custom' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(checked('Range')).toEqual(['7d']);
    expect(onRange).not.toHaveBeenCalled();
  });

  it('reopens on a second click while custom is active and applies a new window', async () => {
    const user = userEvent.setup();
    const { onRange } = renderHeader({
      range: 'custom',
      start: '2026-08-03T00:00:00.000Z',
      end: '2026-08-20T00:00:00.000Z',
    });
    await user.click(screen.getByText('Aug 3 \u2013 Aug 20'));
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeEnabled();
    const days = (label: string) =>
      screen
        .getAllByRole('button', { name: new RegExp(`^${label} August 2026`) })
        .filter(b => !b.hasAttribute('data-outside'));
    await user.click(days('5')[0]!);
    await user.click(days('12')[0]!);
    await user.click(apply);
    expect(onRange).toHaveBeenCalledWith(
      'custom',
      '2026-08-05T00:00:00.000Z',
      '2026-08-12T00:00:00.000Z'
    );
  });

  it.each(['{Enter}', ' '])(
    'reopens from the keyboard (%s) while custom is active',
    async key => {
      const user = userEvent.setup();
      renderHeader({
        range: 'custom',
        start: '2026-08-03T00:00:00.000Z',
        end: '2026-08-20T00:00:00.000Z',
      });
      const custom = within(group('Range'))
        .getAllByRole('radio')
        .find(r => r.getAttribute('value') === 'custom')!;
      custom.focus();
      await user.keyboard(key);
      expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
    }
  );

  it('reopens from a click on the segment outside its label text', async () => {
    const user = userEvent.setup();
    renderHeader({
      range: 'custom',
      start: '2026-08-03T00:00:00.000Z',
      end: '2026-08-20T00:00:00.000Z',
    });
    const segment = screen.getByText('Aug 3 \u2013 Aug 20').closest('label')!;
    await user.click(segment);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });
});

describe('customRangeLabel', () => {
  it('shows the custom window in UTC, or Custom without one', () => {
    expect(
      customRangeLabel({
        range: 'custom',
        start: '2026-08-03T00:00:00.000Z',
        end: '2026-09-01T00:00:00.000Z',
      })
    ).toBe('Aug 3 \u2013 Sep 1');
    expect(customRangeLabel({ range: '30d' })).toBe('Custom');
  });
});
