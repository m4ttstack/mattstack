// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { BOARDS_QUESTION, boardsMarkdown, parseBoards } from './gate-boards';

const board = {
  case: 'retry-badge',
  slot: 'after',
  path: '/Users/dev/.fast-browser/screenshots/run-1-retry-badge-after.png',
  caption: 'The retry badge counts every retry',
};
const ctx = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ 'gate-ctx': 'boards@1', boards: [board], ...over });

describe('parseBoards', () => {
  it('reads a boards@1 context', () => {
    expect(parseBoards(ctx({ summary: 'One board.' }))).toEqual({
      summary: 'One board.',
      boards: [board],
    });
  });

  it('keeps a theme', () => {
    expect(
      parseBoards(
        JSON.stringify({
          'gate-ctx': 'boards@1',
          boards: [{ ...board, theme: 'dark' }],
        })
      )?.boards[0]?.theme
    ).toBe('dark');
  });

  it.each([
    ['prose', 'What the agent found: two boards'],
    ['no context', null],
    ['another shape', JSON.stringify({ 'gate-ctx': 'plan@1', boards: [board] })],
    ['an empty list', ctx({ boards: [] })],
    ['a relative path', ctx({ boards: [{ ...board, path: 'shots/b.png' }] })],
    ['a path with ..', ctx({ boards: [{ ...board, path: '/tmp/../etc/b.png' }] })],
    ['a file that is not an image', ctx({ boards: [{ ...board, path: '/tmp/b.json' }] })],
    ['a board with no caption', ctx({ boards: [{ ...board, caption: '' }] })],
    ['a slot outside the enum', ctx({ boards: [{ ...board, slot: 'pair' }] })],
  ])('is null for %s', (_, text) => {
    expect(parseBoards(text)).toBeNull();
  });
});

describe('boardsMarkdown', () => {
  it('reads the same as the form: summary, question, a line per board', () => {
    expect(
      boardsMarkdown({ summary: 'One board.', boards: [board] })
    ).toBe(
      [
        'One board.',
        '',
        BOARDS_QUESTION,
        '',
        '- **retry-badge/after**: The retry badge counts every retry',
        `  \`${board.path}\``,
      ].join('\n')
    );
  });
});
