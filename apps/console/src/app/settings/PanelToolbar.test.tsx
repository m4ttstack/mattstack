import { useState } from 'react';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PanelToolbar, PanelToolbarSlot } from './PanelToolbar';

function WithSlot() {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <div ref={setSlot} data-testid="slot" />
      <div data-testid="body">
        <PanelToolbarSlot.Provider value={slot}>
          <PanelToolbar>
            <span>Editing the machine layer</span>
          </PanelToolbar>
        </PanelToolbarSlot.Provider>
      </div>
    </>
  );
}

describe('PanelToolbar', () => {
  it('renders in place with no slot', () => {
    renderWithProviders(
      <div data-testid="body">
        <PanelToolbar>
          <span>Editing the machine layer</span>
        </PanelToolbar>
      </div>
    );
    expect(
      within(screen.getByTestId('body')).getByText('Editing the machine layer')
    ).toBeInTheDocument();
  });

  it('moves into the slot when one is provided', () => {
    renderWithProviders(<WithSlot />);
    expect(
      within(screen.getByTestId('slot')).getByText('Editing the machine layer')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('body')).queryByText(
        'Editing the machine layer'
      )
    ).toBeNull();
  });
});
