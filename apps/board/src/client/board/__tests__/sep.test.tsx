import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { joinBullet } from '../bullet.ts';
import { Sep, withSeps } from '../Sep.tsx';

describe('Sep', () => {
  test('draws an element, never a typed dot, and keeps a word break', () => {
    expect(renderToStaticMarkup(<Sep />)).toBe(
      '<span class="tui-sep"> </span>'
    );
  });
});

describe('withSeps', () => {
  test('puts one drawn dot between each pair of fragments', () => {
    expect(renderToStaticMarkup(<>{withSeps(['23h', 'main'])}</>)).toBe(
      '23h<span class="tui-sep"> </span>main'
    );
  });

  test('drops empty fragments so no dot is left dangling', () => {
    expect(
      renderToStaticMarkup(
        <>{withSeps([null, 'a', '', false, 'b', undefined])}</>
      )
    ).toBe('a<span class="tui-sep"> </span>b');
  });

  test('one fragment draws no dot', () => {
    expect(renderToStaticMarkup(<>{withSeps(['solo'])}</>)).toBe('solo');
  });
});

describe('joinBullet', () => {
  test('joins a plain string with the bullet character', () => {
    expect(joinBullet(['#4103', 'export the usage table', 'waiting 7m'])).toBe(
      '#4103 • export the usage table • waiting 7m'
    );
  });

  test('skips empty fragments', () => {
    expect(joinBullet([null, 'a', '', false, 'b'])).toBe('a • b');
  });
});
