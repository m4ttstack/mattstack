import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { describe, expect, it } from 'vitest';

const { HeadCost } = await import('./RunHeader');

describe('HeadCost', () => {
  it('links the spend so far to the MR page', () => {
    const { getByTestId } = renderWithProviders(
      <HeadCost cost={{ text: '$5.72 so far', href: '/usage/x' }} />
    );
    const link = getByTestId('live-cost').querySelector('a');
    expect(link?.getAttribute('href')).toBe('/usage/x');
    expect(link?.textContent).toBe('$5.72 so far');
  });

  it('shows no usage yet as plain text', () => {
    const { getByTestId } = renderWithProviders(
      <HeadCost cost={{ text: 'No usage yet' }} />
    );
    const cost = getByTestId('live-cost');
    expect(cost.querySelector('a')).toBeNull();
    expect(cost.textContent).toBe('No usage yet');
  });
});
