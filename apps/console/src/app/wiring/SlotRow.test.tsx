import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import type { SlotOutlineNode } from './outline';
import { SlotRow } from './SlotRow';

function slot(over: Partial<SlotOutlineNode> = {}): SlotOutlineNode {
  return {
    name: 'gates',
    contract: 'gates@1',
    required: true,
    boundTo: 'widgets:gates',
    fillSourcePath: '/fills/widgets:gates/SKILL.md',
    fill: {
      binding: 'widgets:gates',
      provides: 'gates@1',
      sourcePath: '/fills/widgets:gates',
      registered: false,
    },
    siteCount: 1,
    inlined: true,
    layer: null,
    ...over,
  };
}

describe('SlotRow: the layer that set the slot', () => {
  test('badges the layer beside the fill', () => {
    renderWithProviders(
      <SlotRow slot={slot({ layer: 'override' })} onShowSites={() => {}} />
    );

    expect(
      within(screen.getByTestId('slot-gates')).getByText('override')
    ).toBeInTheDocument();
  });

  test('shows no layer badge when rt states no layer', () => {
    renderWithProviders(<SlotRow slot={slot()} onShowSites={() => {}} />);

    const row = screen.getByTestId('slot-gates');
    for (const layer of ['default', 'pack', 'override', 'base:acme-base']) {
      expect(within(row).queryByText(layer)).not.toBeInTheDocument();
    }
  });
});
