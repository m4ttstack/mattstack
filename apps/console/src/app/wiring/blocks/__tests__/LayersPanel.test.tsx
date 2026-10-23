import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LayersPanel } from '../LayersPanel';
import { zoomOf } from '../model/zoom';
import { miniPayload } from './blocksFixture';

const zoomAt = (id: string | null) => zoomOf(miniPayload, id).zoom;

describe('LayersPanel', () => {
  it('draws one bar segment per non-zero layer, labelled with the total', () => {
    renderWithProviders(
      <LayersPanel payload={miniPayload} zoom={zoomAt(null)} />
    );
    const bar = screen.getByTestId('layers-bar');
    const segments = within(bar).getAllByTestId('layers-bar-segment');
    expect(segments.map(s => s.getAttribute('data-layer'))).toEqual([
      'mattstack',
      'team',
    ]);
    expect(screen.getByText('29 lines')).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: 'How much text: mattstack 27 lines, widgets 2 lines, 29 lines in all',
      })
    ).toBeInTheDocument();
  });

  it('shows a legend row per layer with its count of blocks', () => {
    renderWithProviders(
      <LayersPanel payload={miniPayload} zoom={zoomAt(null)} />
    );
    const rows = screen.getAllByTestId('layers-map-legend-row');
    expect(rows.map(row => row.textContent)).toEqual([
      'mattstack only5 blocks',
      'widgets1 block',
    ]);
  });

  it('groups the block map by section, each square named for its block', () => {
    renderWithProviders(
      <LayersPanel payload={miniPayload} zoom={zoomAt(null)} />
    );
    const map = screen.getByRole('group', { name: 'Where they add' });
    expect(within(map).getByText('Run')).toBeInTheDocument();
    expect(within(map).getByText('Notes')).toBeInTheDocument();
    expect(
      within(map).getByRole('img', { name: 'Gate: mattstack only' })
    ).toBeInTheDocument();
  });

  it('shows the strip for a single block, top to bottom', () => {
    renderWithProviders(
      <LayersPanel payload={miniPayload} zoom={zoomAt('mini/gate')} />
    );
    expect(screen.queryByTestId('layers-bar')).not.toBeInTheDocument();
    const rows = screen.getAllByTestId('layers-strip-row');
    expect(rows.map(row => row.textContent)).toEqual([
      'engine text3',
      'tiering · default1',
    ]);
  });
});
