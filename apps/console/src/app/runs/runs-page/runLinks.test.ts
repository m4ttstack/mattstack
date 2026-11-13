import type { RunSummary } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { ticketOf } from './runLinks';

const review = (repo: string, url: string | null = null) =>
  ({
    repo,
    ticket: null,
    outcome: { status: 'done', reviewed: { iid: 412, url, posted: null } },
  }) as RunSummary;

describe('ticketOf', () => {
  it('prefers the ticket', () => {
    expect(ticketOf({ ...review('x'), ticket: 'WEB-1' })).toBe('WEB-1');
  });

  it('names the reviewed MR or PR in its forge’s form', () => {
    expect(ticketOf(review('remote:gitlab.example.com%2Fa%2Fb'))).toBe('!412');
    expect(ticketOf(review('remote:github.com%2Fa%2Fb'))).toBe('#412');
    expect(
      ticketOf(review('remote:acme%2Fweb', 'https://github.com/a/b/pull/412'))
    ).toBe('#412');
    expect(ticketOf(review('remote:acme%2Fweb'))).toBe('!412');
  });

  it('is null with neither', () => {
    expect(ticketOf({ ...review('x'), outcome: undefined })).toBeNull();
  });
});
