import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { VirtualList } from '@mattstack/app-kit/core';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';

const ROW_HEIGHT = 20;
const VIEWPORT_HEIGHT = 200;

const TOTAL_ROWS = 1000;

// jsdom does no layout. The virtualizer reads `offsetHeight` of its scroll
// element and of each row wrapper (`data-index`) and bounds its scroll target
// by `scrollHeight - clientHeight`, so the stub answers those per element,
// and `scrollTo` behaves like a browser's: it moves `scrollTop` and fires
// `scroll`.
function stubLayout() {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute('data-index') ? ROW_HEIGHT : VIEWPORT_HEIGHT;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(
    VIEWPORT_HEIGHT
  );
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(
    TOTAL_ROWS * ROW_HEIGHT
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      Object.defineProperty(this, 'scrollTop', {
        configurable: true,
        writable: true,
        value: options.top ?? 0,
      });
      this.dispatchEvent(new Event('scroll'));
    },
  });
}

const items = Array.from({ length: 1000 }, (_, i) => `row ${i}`);

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

beforeEach(stubLayout);

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

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
