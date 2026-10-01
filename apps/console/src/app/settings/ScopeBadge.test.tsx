import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScopeBadge } from './ScopeBadge';

afterEach(() => vi.restoreAllMocks());

describe('ScopeBadge', () => {
  it('shows a label cut short in the column whole in a tooltip', async () => {
    // jsdom lays nothing out, so the label's overflow is stubbed.
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(117);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(65);
    renderWithProviders(<ScopeBadge scope="machine.repo" bare />);
    await userEvent.hover(screen.getByText('machine · repo'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'machine · repo'
    );
  });
});
