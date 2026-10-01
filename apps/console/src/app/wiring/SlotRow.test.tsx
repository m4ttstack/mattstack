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

describe('SlotRow: a binding with no fill behind it', () => {
  test('says so in plain words beside the bound name', () => {
    renderWithProviders(
      <SlotRow slot={slot({ fill: null })} onShowSites={() => {}} />
    );

    expect(screen.getByTestId('slot-fill')).toHaveTextContent(
      /^widgets:gates \(no matching fill in this pack\)$/
    );
  });
});

describe('SlotRow: the layer that set the slot', () => {
  test.each([
    ['default', 'default'],
    ['pack', 'this pack'],
    ['override', 'your override'],
    ['base:acme-base', 'base: acme-base'],
  ])('badges the %s layer beside the fill as "%s"', (layer, shown) => {
    renderWithProviders(
      <SlotRow slot={slot({ layer })} onShowSites={() => {}} />
    );

    const row = screen.getByTestId('slot-gates');
    expect(within(row).getByText(shown)).toBeInTheDocument();
    if (layer !== shown)
      expect(within(row).queryByText(layer)).not.toBeInTheDocument();
  });

  test('shows no layer badge when rt states no layer', () => {
    renderWithProviders(<SlotRow slot={slot()} onShowSites={() => {}} />);

    const row = screen.getByTestId('slot-gates');
    for (const shown of [
      'default',
      'this pack',
      'your override',
      'base: acme-base',
    ]) {
      expect(within(row).queryByText(shown)).not.toBeInTheDocument();
    }
  });
});
