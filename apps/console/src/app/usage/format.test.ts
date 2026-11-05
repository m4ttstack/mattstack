import type { UsageMrRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import {
  compact,
  modelName,
  mrParts,
  mrSummary,
  usageMrHref,
  usd,
} from './format';

const KEY = 'remote:github.com%2Facme%2Fwidgets!123';

function row(over: Partial<UsageMrRow>): UsageMrRow {
  return {
    costByKind: { work: 0, review: 0, respond: 0, doctor: 0, other: 0 },
    roundCount: 0,
    ...over,
  } as UsageMrRow;
}

describe('usage format', () => {
  it('reads the repo and number out of an MR key', () => {
    expect(mrParts(KEY)).toEqual({
      repoKey: 'remote:github.com%2Facme%2Fwidgets',
      repo: 'acme/widgets',
      number: '!123',
    });
  });

  it('encodes a key once for its link', () => {
    expect(usageMrHref(KEY)).toBe(
      '/usage/remote%3Agithub.com%252Facme%252Fwidgets!123'
    );
  });

  it('names models the way people say them', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelName('claude-sonnet-5')).toBe('Sonnet 5');
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelName('gpt-thing')).toBe('gpt-thing');
    expect(modelName(null)).toBe('Unknown');
  });

  it('says what an MR spent on', () => {
    const cost = row({}).costByKind;
    expect(
      mrSummary(row({ costByKind: { ...cost, work: 1 }, roundCount: 3 }))
    ).toBe('work run, 3 rounds');
    expect(
      mrSummary(row({ costByKind: { ...cost, work: 1 }, roundCount: 1 }))
    ).toBe('work run, 1 round');
    expect(mrSummary(row({ costByKind: { ...cost, review: 1 } }))).toBe(
      'review only'
    );
  });

  it('formats money and counts', () => {
    expect(usd(4.6)).toBe('$4.60');
    expect(usd(1284.2)).toBe('$1,284');
    expect(compact(950)).toBe('950');
    expect(compact(9000)).toBe('9.0K');
    expect(compact(96000)).toBe('96K');
    expect(compact(11_400_000)).toBe('11.4M');
  });
});
