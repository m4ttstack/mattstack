import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import './icons';

import { NotFoundPage } from './NotFoundPage';

describe('NotFoundPage', () => {
  it('says why the address is empty and links back to the runs', () => {
    renderWithProviders(<NotFoundPage />);

    const root = document.querySelector('[data-parity="Not found"]');
    expect(root).toHaveTextContent('Nothing at this address');
    expect(root).toHaveTextContent(
      'The link may be from an older console, or the run was pruned after 30 days.'
    );
    expect(screen.getByRole('link', { name: 'Back to runs' })).toHaveAttribute(
      'href',
      '/'
    );
    expect(screen.queryByText('404')).toBeNull();
  });

  it('sits on the page surface, not graph paper', () => {
    renderWithProviders(<NotFoundPage />);

    expect(document.querySelector('#page-shell-content')).toHaveAttribute(
      'data-own-surface'
    );
  });
});
