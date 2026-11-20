import { expect, test } from 'bun:test';

import { splitNoteLinks } from '../note-links.ts';

test('pulls links out of the prose and names each by its host', () => {
  expect(
    splitNoteLinks(
      'rolled out to test, staging https://www.claude.ai/artifact/Xa91?sk=07 then prod'
    )
  ).toEqual({
    prose: 'rolled out to test, staging then prod',
    links: [
      { url: 'https://www.claude.ai/artifact/Xa91?sk=07', host: 'claude.ai' },
    ],
  });
});

test('keeps sentence punctuation out of the link, in the prose', () => {
  expect(
    splitNoteLinks('see https://gitlab.example.com/g/p/-/issues/4.')
  ).toEqual({
    prose: 'see.',
    links: [
      {
        url: 'https://gitlab.example.com/g/p/-/issues/4',
        host: 'gitlab.example.com',
      },
    ],
  });
});

test('keeps a closing paren the link opened, and returns the rest to the prose', () => {
  expect(
    splitNoteLinks('see (https://en.example.org/wiki/Foo_(bar)) here')
  ).toEqual({
    prose: 'see () here',
    links: [
      {
        url: 'https://en.example.org/wiki/Foo_(bar)',
        host: 'en.example.org',
      },
    ],
  });
});

test('stops at a backtick and matches any case of the scheme', () => {
  expect(splitNoteLinks('try `HTTPS://x.example.io/y` now')).toEqual({
    prose: 'try `` now',
    links: [{ url: 'HTTPS://x.example.io/y', host: 'x.example.io' }],
  });
});

test('the same link twice is one chip', () => {
  expect(
    splitNoteLinks('see https://example.com/a. and https://example.com/a')
  ).toEqual({
    prose: 'see. and',
    links: [{ url: 'https://example.com/a', host: 'example.com' }],
  });
});

test('a note that is only a link has no prose', () => {
  expect(splitNoteLinks('https://example.com/a')).toEqual({
    prose: '',
    links: [{ url: 'https://example.com/a', host: 'example.com' }],
  });
});

test('a note with no links is untouched, newlines included', () => {
  expect(splitNoteLinks('line one\nline two')).toEqual({
    prose: 'line one\nline two',
    links: [],
  });
});
