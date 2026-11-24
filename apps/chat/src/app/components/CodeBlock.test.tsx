import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import '../icons';

import { CodeBlock } from './CodeBlock';

function layout({ rows, scrollWidth }: { rows: number; scrollWidth: number }) {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    if (el.tagName !== 'PRE') return real(el, pseudo);
    return { lineHeight: '20px' } as CSSStyleDeclaration;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(
    rows * 20
  );
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(
    scrollWidth
  );
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(400);
}

const toggle = () =>
  screen.getByTestId('code-block').querySelector('[aria-label="Wrap lines"]');

afterEach(() => {
  vi.restoreAllMocks();
});

test('a block whose lines all fit has no wrap toggle', () => {
  layout({ rows: 2, scrollWidth: 400 });
  renderWithProviders(<CodeBlock code={'one\ntwo'} />);
  expect(toggle()).toBeNull();
});

test('a long line wraps, until the toggle turns wrapping off for the block', () => {
  layout({ rows: 3, scrollWidth: 900 });
  renderWithProviders(<CodeBlock code={'one\ntwo'} />);
  const pre = screen.getByTestId('code-block').querySelector('pre')!;
  expect(pre).toHaveAttribute('data-wrap');
  expect(toggle()).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(toggle()!);
  expect(pre).not.toHaveAttribute('data-wrap');
  expect(toggle()).toHaveAttribute('aria-pressed', 'false');

  fireEvent.click(toggle()!);
  expect(pre).toHaveAttribute('data-wrap');
});
