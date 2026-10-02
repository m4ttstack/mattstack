import { vi } from 'vitest';

export interface VirtualLayout {
  /** Height of each row wrapper, the element carrying `data-index`. */
  rowHeight: number;
  /** Height of the scroll viewport. */
  viewportHeight: number;
  /** Total scrollable height; bounds how far `scrollTo` can move. */
  contentHeight: number;
}

/**
 * Gives `@tanstack/react-virtual` a layout under jsdom, which has none. The
 * virtualizer reads `offsetHeight` of its scroll element and of each row
 * wrapper and bounds its scroll target by `scrollHeight - clientHeight`, so
 * the stub answers those per element; `scrollTo` behaves like a browser's, it
 * moves `scrollTop` and fires `scroll`. Call before rendering and run the
 * returned function in `afterEach`.
 */
export function stubVirtualLayout({
  rowHeight,
  viewportHeight,
  contentHeight,
}: VirtualLayout): () => void {
  const spies = [
    vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute('data-index') ? rowHeight : viewportHeight;
      }),
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600),
    vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(viewportHeight),
    vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(contentHeight),
  ];

  const originalScrollTo = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollTo'
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

  return () => {
    spies.forEach(spy => spy.mockRestore());
    if (originalScrollTo) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollTo',
        originalScrollTo
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    }
  };
}
