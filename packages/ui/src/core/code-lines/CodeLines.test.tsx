import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { CodeLines } from '@mattstack/app-kit/core';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';

const ROW_HEIGHT = 19;
const VIEWPORT_HEIGHT = 190;

const TOTAL_ROWS = 2000;

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

beforeEach(stubLayout);

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

const row = (text: string) =>
  screen.getByText(text).closest('[data-line]') as HTMLElement;

describe('CodeLines', () => {
  test('numbers lines from firstLine', () => {
    renderWithProviders(
      <CodeLines
        lines={['alpha', 'bravo', 'charlie']}
        firstLine={40}
        height={VIEWPORT_HEIGHT}
      />
    );

    expect(row('alpha').getAttribute('data-line')).toBe('40');
    expect(row('charlie').getAttribute('data-line')).toBe('42');
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  test('numbers lines from 1 by default', () => {
    renderWithProviders(
      <CodeLines lines={['alpha', 'bravo']} height={VIEWPORT_HEIGHT} />
    );

    expect(row('bravo').getAttribute('data-line')).toBe('2');
  });

  test('marks rows inside the highlight range, ends included', () => {
    renderWithProviders(
      <CodeLines
        lines={['alpha', 'bravo', 'charlie', 'delta']}
        highlight={[2, 3]}
        height={VIEWPORT_HEIGHT}
      />
    );

    expect(row('alpha').hasAttribute('data-highlighted')).toBe(false);
    expect(row('bravo').hasAttribute('data-highlighted')).toBe(true);
    expect(row('charlie').hasAttribute('data-highlighted')).toBe(true);
    expect(row('delta').hasAttribute('data-highlighted')).toBe(false);
  });

  test('highlights nothing when highlight is null', () => {
    const { container } = renderWithProviders(
      <CodeLines
        lines={['alpha', 'bravo']}
        highlight={null}
        height={VIEWPORT_HEIGHT}
      />
    );

    expect(container.querySelector('[data-highlighted]')).toBeNull();
  });

  test('renders a band label once, at the first row of the band', () => {
    renderWithProviders(
      <CodeLines
        lines={['alpha', 'bravo', 'charlie', 'delta']}
        bands={[{ from: 2, to: 3, label: 'gate-protocol', tone: 'accent' }]}
        height={VIEWPORT_HEIGHT}
      />
    );

    const label = screen.getByText('gate-protocol');
    expect(screen.getAllByText('gate-protocol')).toHaveLength(1);
    expect(label.closest('[data-line]')?.getAttribute('data-line')).toBe('2');
  });

  test('puts every row of a band in its gutter with the band tone', () => {
    renderWithProviders(
      <CodeLines
        lines={['alpha', 'bravo', 'charlie', 'delta']}
        bands={[
          { from: 2, to: 3, label: 'gate-protocol', tone: 'accent' },
          { from: 4, to: 4, label: 'wrap-up-form' },
        ]}
        height={VIEWPORT_HEIGHT}
      />
    );

    const tone = (text: string) =>
      row(text).querySelector('[data-gutter]')?.getAttribute('data-tone');
    expect(tone('alpha')).toBeNull();
    expect(tone('bravo')).toBe('accent');
    expect(tone('charlie')).toBe('accent');
    expect(tone('delta')).toBe('muted');
  });

  test('labels a band at its first loaded row when the band starts above them', () => {
    renderWithProviders(
      <CodeLines
        lines={['alpha', 'bravo', 'charlie']}
        firstLine={10}
        bands={[{ from: 5, to: 11, label: 'gate-protocol' }]}
        height={VIEWPORT_HEIGHT}
      />
    );

    expect(
      screen
        .getByText('gate-protocol')
        .closest('[data-line]')
        ?.getAttribute('data-line')
    ).toBe('10');
  });

  test('has no gutter without bands', () => {
    const { container, rerender } = renderWithProviders(
      <CodeLines lines={['alpha', 'bravo']} height={VIEWPORT_HEIGHT} />
    );
    expect(container.querySelector('[data-gutter]')).toBeNull();

    rerender(
      <CodeLines
        lines={['alpha', 'bravo']}
        bands={[]}
        height={VIEWPORT_HEIGHT}
      />
    );
    expect(container.querySelector('[data-gutter]')).toBeNull();
  });

  test('tints only the lines matching tintPattern', () => {
    renderWithProviders(
      <CodeLines
        lines={['plain text', 'paste {{include:gate}} here', 'more {{x}}']}
        tintPattern={/\{\{[^}]+\}\}/g}
        height={VIEWPORT_HEIGHT}
      />
    );

    const tinted = (text: string) =>
      screen.getByText(text).hasAttribute('data-tinted');
    expect(tinted('plain text')).toBe(false);
    expect(tinted('paste {{include:gate}} here')).toBe(true);
    expect(tinted('more {{x}}')).toBe(true);
  });

  test('mounts only the rows near the viewport of a 2,000 line file', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`);
    const { container, rerender } = renderWithProviders(
      <CodeLines lines={lines} height={VIEWPORT_HEIGHT} />
    );

    expect(screen.getByText('line 1')).toBeTruthy();
    expect(screen.queryByText('line 1990')).toBeNull();
    expect(container.querySelectorAll('[data-line]').length).toBeLessThan(100);

    rerender(
      <CodeLines lines={lines} height={VIEWPORT_HEIGHT} scrollTo={1980} />
    );

    expect(screen.getByText('line 1980')).toBeTruthy();
    expect(screen.getByText('line 1990')).toBeTruthy();
    expect(screen.queryByText('line 10')).toBeNull();
    expect(container.querySelectorAll('[data-line]').length).toBeLessThan(100);
  });

  test('brings scrollTo to the top of the viewport on first render', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`);
    const { container } = renderWithProviders(
      <CodeLines lines={lines} height={VIEWPORT_HEIGHT} scrollTo={1980} />
    );

    expect(screen.getByText('line 1980')).toBeTruthy();
    expect(screen.queryByText('line 10')).toBeNull();
    const viewport = container.querySelector(
      '.mantine-ScrollArea-viewport'
    ) as HTMLElement;
    expect(viewport.scrollTop).toBe(1979 * ROW_HEIGHT);
  });

  test('scrollTo is a line number, so it accounts for firstLine', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1001}`);
    const { container } = renderWithProviders(
      <CodeLines
        lines={lines}
        firstLine={1001}
        height={VIEWPORT_HEIGHT}
        scrollTo={1401}
      />
    );

    expect(screen.getByText('line 1401')).toBeTruthy();
    const viewport = container.querySelector(
      '.mantine-ScrollArea-viewport'
    ) as HTMLElement;
    expect(viewport.scrollTop).toBe(400 * ROW_HEIGHT);
  });
});
