import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { VirtualList } from '@mattstack/app-kit/core';
import {
  renderWithProviders,
  stubVirtualLayout,
} from '@mattstack/app-kit/test-utils';

const ROW_HEIGHT = 20;
const VIEWPORT_HEIGHT = 200;
const ITEM_COUNT = 1000;

let restoreLayout: () => void;

beforeEach(() => {
  restoreLayout = stubVirtualLayout({
    rowHeight: ROW_HEIGHT,
    viewportHeight: VIEWPORT_HEIGHT,
    contentHeight: ITEM_COUNT * ROW_HEIGHT,
  });
});

afterEach(() => restoreLayout());

const items = Array.from({ length: ITEM_COUNT }, (_, i) => `row ${i}`);

function list(scrollToIndex?: number | null) {
  return (
    <VirtualList
      items={items}
      estimateSize={() => ROW_HEIGHT}
      maxHeight={VIEWPORT_HEIGHT}
      scrollToIndex={scrollToIndex}
      renderRow={item => <div>{item}</div>}
    />
  );
}

describe('VirtualList scrollToIndex', () => {
  test('starts at the top when no index is given', () => {
    renderWithProviders(list());

    expect(screen.getByText('row 0')).toBeTruthy();
    expect(screen.queryByText('row 500')).toBeNull();
  });

  test('brings the index to the top of the viewport on mount', () => {
    const { container } = renderWithProviders(list(500));

    expect(screen.getByText('row 500')).toBeTruthy();
    expect(screen.queryByText('row 0')).toBeNull();
    const viewport = container.querySelector(
      '.mantine-ScrollArea-viewport'
    ) as HTMLElement;
    expect(viewport.scrollTop).toBe(500 * ROW_HEIGHT);
  });

  test('scrolls again when the index changes', () => {
    const { rerender } = renderWithProviders(list(500));
    rerender(list(900));

    expect(screen.getByText('row 900')).toBeTruthy();
    expect(screen.queryByText('row 500')).toBeNull();
  });

  test('null leaves the scroll position where it was', () => {
    const { rerender, container } = renderWithProviders(list(500));
    rerender(list(null));

    const viewport = container.querySelector(
      '.mantine-ScrollArea-viewport'
    ) as HTMLElement;
    expect(viewport.scrollTop).toBe(500 * ROW_HEIGHT);
    expect(screen.getByText('row 500')).toBeTruthy();
  });

  test('applies once the list gains its first rows', () => {
    const { rerender } = renderWithProviders(
      <VirtualList
        items={[]}
        estimateSize={() => ROW_HEIGHT}
        maxHeight={VIEWPORT_HEIGHT}
        scrollToIndex={500}
        renderRow={(item: string) => <div>{item}</div>}
      />
    );
    rerender(list(500));

    expect(screen.getByText('row 500')).toBeTruthy();
    expect(screen.queryByText('row 0')).toBeNull();
  });
});

describe('VirtualList visible window', () => {
  test('tells each row which items are in the viewport, overscan excluded', () => {
    const seen = new Map<number, { first: number; last: number } | null>();
    renderWithProviders(
      <VirtualList
        items={items}
        estimateSize={() => ROW_HEIGHT}
        maxHeight={VIEWPORT_HEIGHT}
        scrollToIndex={500}
        renderRow={(item, index, visible) => {
          seen.set(index, visible);
          return <div>{item}</div>;
        }}
      />
    );

    expect(seen.has(480)).toBe(true);
    expect(seen.get(500)).toEqual({ first: 500, last: 509 });
  });
});

describe('VirtualList renderOverlay', () => {
  test('draws over the rows, unshifted, knowing where each item sits', () => {
    renderWithProviders(
      <VirtualList
        items={items}
        estimateSize={() => ROW_HEIGHT}
        maxHeight={VIEWPORT_HEIGHT}
        scrollToIndex={500}
        renderRow={item => <div>{item}</div>}
        renderOverlay={layout => (
          <div
            data-testid="overlay"
            data-start={layout.start(3)}
            data-end={layout.end(4)}
          />
        )}
      />
    );

    const overlay = screen.getByTestId('overlay');
    expect(overlay.getAttribute('data-start')).toBe(String(3 * ROW_HEIGHT));
    expect(overlay.getAttribute('data-end')).toBe(String(5 * ROW_HEIGHT));
    expect(overlay.closest('[style*="translateY"]')).toBeNull();
  });

  test('draws nothing extra without one', () => {
    const { container } = renderWithProviders(list());

    expect(container.querySelector('[data-virtual-overlay]')).toBeNull();
  });
});
