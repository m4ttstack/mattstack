import '../../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AroundGraph } from '../AroundGraph';
import { shipShaped } from './aroundFixtures';

function renderAround() {
  const onSelect = vi.fn();
  const onViewWholeGraph = vi.fn();
  renderWithProviders(
    <AroundGraph
      graph={shipShaped}
      focus="fast_checks"
      onSelect={onSelect}
      onViewWholeGraph={onViewWholeGraph}
    />
  );
  return { onSelect, onViewWholeGraph };
}

// Clicks, not pointer sequences: React Flow's pan handler reads the
// `MouseEvent.view` that jsdom's synthetic pointer events leave null.
const click = (element: Element) => fireEvent.click(element);

describe('AroundGraph', () => {
  it('draws the subgraph: block nodes solid, graph steps outlined', () => {
    renderAround();

    expect(
      screen.getAllByTestId('around-block').map(node => node.textContent)
    ).toEqual(
      expect.arrayContaining(['Commit named', 'Fast checks', 'Fix test-first'])
    );
    expect(
      screen.getAllByTestId('around-step').map(node => node.textContent)
    ).toEqual(
      expect.arrayContaining([
        'Tree dirty?',
        'Checks pass?',
        'Fix rounds left?',
      ])
    );
    expect(screen.queryByText('Rebase this pass?')).not.toBeInTheDocument();
  });

  it('marks the focus node', () => {
    renderAround();

    expect(screen.getByRole('button', { name: 'Fast checks' })).toHaveAttribute(
      'data-focus',
      'true'
    );
    expect(
      screen.getByRole('button', { name: 'Commit named' })
    ).not.toHaveAttribute('data-focus');
  });

  it('opens a block when its node is clicked', () => {
    const { onSelect } = renderAround();

    click(screen.getByRole('button', { name: 'Commit named' }));

    expect(onSelect).toHaveBeenCalledWith('ship/flow/commit-named');
  });

  it('does nothing when a graph-only step is clicked', () => {
    const { onSelect } = renderAround();

    click(screen.getByText('Tree dirty?'));

    expect(onSelect).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Tree dirty?' })
    ).not.toBeInTheDocument();
  });

  it('shows the key and opens the whole graph', () => {
    const { onViewWholeGraph } = renderAround();

    expect(screen.getByText('Opens a block')).toBeInTheDocument();
    expect(screen.getByText('Graph step only')).toBeInTheDocument();
    click(screen.getByRole('button', { name: 'View whole graph' }));

    expect(onViewWholeGraph).toHaveBeenCalledOnce();
  });
});
