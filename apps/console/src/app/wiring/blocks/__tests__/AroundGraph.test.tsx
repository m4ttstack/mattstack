import '../../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AroundGraph } from '../AroundGraph';
import { bundledEngine } from '../layoutEngine';
import { shipShaped } from './aroundFixtures';

const shared = bundledEngine();
const engine = () => Promise.resolve(shared);
const LAID_OUT = { timeout: 15_000 };

async function renderAround() {
  const onSelect = vi.fn();
  const onViewWholeGraph = vi.fn();
  renderWithProviders(
    <AroundGraph
      graph={shipShaped}
      focus="fast_checks"
      onSelect={onSelect}
      onViewWholeGraph={onViewWholeGraph}
      engine={engine}
    />
  );
  await screen.findByTestId('flow-canvas', {}, LAID_OUT);
  return { onSelect, onViewWholeGraph };
}

const texts = (testId: string) =>
  screen.getAllByTestId(testId).map(node => node.textContent);

describe('AroundGraph', () => {
  it('Around keeps one hop in and out and short cycles', async () => {
    await renderAround();

    expect(texts('map-card').sort()).toEqual(
      ['Commit named', 'Fast checks', 'Fix test-first', 'Stash them'].sort()
    );
    expect(texts('flow-step').sort()).toEqual(
      [
        'Checks pass?',
        'Fix rounds left?',
        'Rebase status?',
        'Tree dirty?',
      ].sort()
    );
    expect(screen.queryByText('Rebase this pass?')).not.toBeInTheDocument();
    expect(screen.queryByText('Push')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('map-edge')).toHaveLength(11);
  }, 20_000);

  it('draws its exit labels as chips', async () => {
    await renderAround();

    expect(texts('map-chip')).toEqual(
      expect.arrayContaining(['commit', 'stash', 'clean', 'red test'])
    );
  }, 20_000);

  it('lights the focus', async () => {
    await renderAround();

    expect(screen.getByRole('button', { name: 'Fast checks' })).toHaveAttribute(
      'data-hot',
      'true'
    );
    expect(
      screen.getByRole('button', { name: 'Commit named' })
    ).not.toHaveAttribute('data-hot');
  }, 20_000);

  it('opens a block when its card is clicked', async () => {
    const { onSelect } = await renderAround();

    fireEvent.click(screen.getByRole('button', { name: 'Commit named' }));

    expect(onSelect).toHaveBeenCalledWith('ship/flow/commit-named');
  }, 20_000);

  it('does nothing when a graph-only step is clicked', async () => {
    const { onSelect } = await renderAround();

    fireEvent.click(screen.getByText('Tree dirty?'));

    expect(onSelect).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Tree dirty?' })
    ).not.toBeInTheDocument();
  }, 20_000);

  it('shows the key and opens the whole graph', async () => {
    const { onViewWholeGraph } = await renderAround();

    expect(screen.getByText('Opens a block')).toBeInTheDocument();
    expect(screen.getByText('Graph step only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View whole graph' }));

    expect(onViewWholeGraph).toHaveBeenCalledOnce();
  }, 20_000);
});
