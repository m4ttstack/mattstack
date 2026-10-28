import { describe, expect, test } from 'bun:test';

import { sourceOffset } from '../caret-map.ts';

/** The caret in `source` for a click just after `before` in the rendered text. */
function caretAfter(source: string, rendered: string, before: string) {
  const at = rendered.indexOf(before);
  if (at < 0) throw new Error(`"${before}" is not in the rendered text`);
  return sourceOffset(source, rendered, at + before.length);
}

describe('sourceOffset', () => {
  test('plain text maps one to one', () => {
    expect(sourceOffset('hello world', 'hello world', 5)).toBe(5);
  });

  test('skips bold markers before the click', () => {
    const source = '**suggestion:** thanks for the run';
    const rendered = 'suggestion: thanks for the run';
    expect(source.slice(0, caretAfter(source, rendered, 'thanks'))).toBe(
      '**suggestion:** thanks'
    );
  });

  test('a click inside bold text lands inside the markers', () => {
    const source = '**suggestion:** thanks';
    const rendered = 'suggestion: thanks';
    expect(source.slice(0, caretAfter(source, rendered, 'sugg'))).toBe(
      '**sugg'
    );
  });

  test('skips backticks around inline code', () => {
    const source = 'the `--changed` flag and `src/jobs/**` too';
    const rendered = 'the --changed flag and src/jobs/** too';
    expect(source.slice(0, caretAfter(source, rendered, 'flag and src/'))).toBe(
      'the `--changed` flag and `src/'
    );
  });

  test('a link maps to its text, not its url', () => {
    const source = 'see [the docs](https://example.test/a.b) for more';
    const rendered = 'see the docs for more';
    expect(source.slice(0, caretAfter(source, rendered, 'for'))).toBe(
      'see [the docs](https://example.test/a.b) for'
    );
  });

  test('paragraph breaks collapse without drifting', () => {
    const source = 'first line\n\nsecond line';
    const rendered = 'first line\nsecond line';
    expect(source.slice(0, caretAfter(source, rendered, 'second'))).toBe(
      'first line\n\nsecond'
    );
  });

  test('a click at the start stays at the start', () => {
    expect(sourceOffset('**bold**', 'bold', 0)).toBe(0);
  });

  test('a click past the end lands at the end of the source', () => {
    expect(sourceOffset('**bold**', 'bold', 99)).toBe(8);
  });

  test('rendered text the source cannot match lands at the end', () => {
    expect(sourceOffset('abc', 'xyz', 2)).toBe(3);
  });
});
