import { describe, expect, test } from 'bun:test';

import { LAYOUT, STRIPS } from '../../assets/latch/index.ts';
import {
  allVariantKeys,
  copyFor,
  DOT_GAP_PX,
  DOT_PX,
  variantKey,
  variantOfKey,
  type BannerVariant,
} from '../latch/variants.ts';

const SUB = (v: BannerVariant) => copyFor(v).sub;

describe('variant keys', () => {
  test('every key is unique and round-trips through variantOfKey', () => {
    const keys = allVariantKeys();
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      const v = variantOfKey(key);
      expect(v).not.toBeNull();
      expect(variantKey(v!)).toBe(key);
    }
  });

  test('covers every queued and error wait and every done-comments count', () => {
    const keys = allVariantKeys();
    for (const w of ['next-sweep', 'cooldown', 'budget', 'review-in-flight']) {
      expect(keys).toContain(`queued-${w}`);
    }
    for (const w of ['next-sweep', 'cooldown', 'budget']) {
      expect(keys).toContain(`error-retrying-${w}`);
    }
    expect(keys).not.toContain('error-retrying-review-in-flight');
    for (let n = 1; n <= 20; n++) expect(keys).toContain(`done-comments-${n}`);
    expect(keys).toContain('done-comments-20plus');
    expect(keys).toContain('done-comments-none');
    for (const k of [
      'armed',
      'running',
      'error-stuck',
      'done-approved',
      'approved',
      'superseded',
    ]) {
      expect(keys).toContain(k);
    }
  });

  test('counts map to their keys', () => {
    expect(variantKey({ state: 'done-comments', count: 3 })).toBe(
      'done-comments-3'
    );
    expect(variantKey({ state: 'done-comments', count: 21 })).toBe(
      'done-comments-20plus'
    );
    expect(variantKey({ state: 'done-comments', count: 0 })).toBe(
      'done-comments-none'
    );
    expect(variantKey({ state: 'done-comments', count: null })).toBe(
      'done-comments-none'
    );
    expect(variantKey({ state: 'queued', wait: 'cooldown' })).toBe(
      'queued-cooldown'
    );
  });

  test('fractional counts floor and non-finite counts read as none', () => {
    expect(variantKey({ state: 'done-comments', count: 2.5 })).toBe(
      'done-comments-2'
    );
    expect(variantKey({ state: 'done-comments', count: NaN })).toBe(
      'done-comments-none'
    );
    expect(variantKey({ state: 'done-comments', count: Infinity })).toBe(
      'done-comments-none'
    );
    expect(SUB({ state: 'done-comments', count: 2.5 })).toBe(
      '2 new comments. Resolve when ready'
    );
    expect(SUB({ state: 'done-comments', count: NaN })).toBe(
      'Review posted. Resolve when ready'
    );
  });

  test('a null wait reads as the next sweep', () => {
    expect(variantKey({ state: 'queued', wait: null })).toBe(
      'queued-next-sweep'
    );
    expect(variantKey({ state: 'error-retrying', wait: null })).toBe(
      'error-retrying-next-sweep'
    );
  });

  test('dot pitch is shared in CSS px', () => {
    expect(DOT_PX).toBe(4);
    expect(DOT_GAP_PX).toBe(4);
  });

  test('unknown keys have no variant', () => {
    expect(variantOfKey('queued-sometime')).toBeNull();
    expect(variantOfKey('done-comments-21')).toBeNull();
    expect(variantOfKey('nonsense')).toBeNull();
  });
});

describe('copy', () => {
  test('titles and fixed subtitles match the spec', () => {
    const rows: [BannerVariant, string, string, string][] = [
      [
        { state: 'armed' },
        'Ready for another pass?',
        'Resolve this thread to ask',
        '#f08fb0',
      ],
      [
        { state: 'running' },
        'Follow-up review running',
        'Results post here when done',
        '#7fbfe8',
      ],
      [
        { state: 'error-stuck' },
        'Follow-up review stuck',
        'Reviewer notified',
        '#f2917e',
      ],
      [
        { state: 'done-approved' },
        'Follow-up review done',
        'Approved. Nothing more to do',
        '#86cfa0',
      ],
      [{ state: 'approved' }, 'Approved', 'Nothing more to do', '#86cfa0'],
      [
        { state: 'superseded' },
        'Replaced',
        'See the newer thread below',
        '#8e88a0',
      ],
    ];
    for (const [v, title, sub, accent] of rows) {
      expect(copyFor(v)).toMatchObject({ title, sub, accent });
    }
    expect(copyFor({ state: 'queued', wait: 'next-sweep' })).toMatchObject({
      title: 'Follow-up review queued',
      accent: '#e6b860',
    });
    expect(
      copyFor({ state: 'error-retrying', wait: 'next-sweep' })
    ).toMatchObject({
      title: 'Follow-up review hit a snag',
      accent: '#f2917e',
    });
    expect(copyFor({ state: 'done-comments', count: 2 })).toMatchObject({
      title: 'Follow-up review done',
      accent: '#b9a0f2',
    });
  });

  test('queued subtitles name the wait', () => {
    expect(SUB({ state: 'queued', wait: 'next-sweep' })).toBe(
      'Starts in a few minutes'
    );
    expect(SUB({ state: 'queued', wait: 'cooldown' })).toBe(
      'Waiting between reviews'
    );
    expect(SUB({ state: 'queued', wait: 'budget' })).toBe(
      'Daily limit reached. Starts tomorrow'
    );
    expect(SUB({ state: 'queued', wait: 'review-in-flight' })).toBe(
      'Waiting on another review'
    );
  });

  test('error-retrying subtitles name the wait', () => {
    expect(SUB({ state: 'error-retrying', wait: 'next-sweep' })).toBe(
      'Trying again in a few minutes'
    );
    expect(SUB({ state: 'error-retrying', wait: 'cooldown' })).toBe(
      'Trying again after a pause'
    );
    expect(SUB({ state: 'error-retrying', wait: 'budget' })).toBe(
      'Daily limit reached. Trying again tomorrow'
    );
  });

  test('done-comments subtitles count what landed', () => {
    expect(SUB({ state: 'done-comments', count: 1 })).toBe(
      '1 new comment. Resolve when ready'
    );
    expect(SUB({ state: 'done-comments', count: 2 })).toBe(
      '2 new comments. Resolve when ready'
    );
    expect(SUB({ state: 'done-comments', count: 20 })).toBe(
      '20 new comments. Resolve when ready'
    );
    expect(SUB({ state: 'done-comments', count: 21 })).toBe(
      '20+ new comments. Resolve when ready'
    );
    expect(SUB({ state: 'done-comments', count: 0 })).toBe(
      'Review posted. Resolve when ready'
    );
    expect(SUB({ state: 'done-comments', count: null })).toBe(
      'Review posted. Resolve when ready'
    );
  });

  test('a sentence only where the author has something to do', () => {
    expect(copyFor({ state: 'armed' }).sentence).toBe(
      "**Addressed everything?** Resolve this thread and I'll take another pass over the MR.\n\nLeave it open while there's still work in flight."
    );
    expect(copyFor({ state: 'done-comments', count: 4 }).sentence).toBe(
      "Follow-up review done. Resolve this thread again when you've addressed the new comments."
    );
    for (const key of allVariantKeys()) {
      const v = variantOfKey(key)!;
      if (v.state === 'armed' || v.state === 'done-comments') continue;
      expect(copyFor(v).sentence).toBeUndefined();
    }
  });

  test('no posted copy names the latch', () => {
    for (const key of allVariantKeys()) {
      const c = copyFor(variantOfKey(key)!);
      expect(`${c.title} ${c.sub} ${c.sentence ?? ''}`).not.toMatch(
        /latch|spent|supersed|sweep|cooldown/i
      );
    }
  });

  test('indicator follows the state', () => {
    for (const key of allVariantKeys()) {
      const v = variantOfKey(key)!;
      const expected =
        v.state === 'queued' || v.state === 'error-retrying'
          ? 'dots'
          : v.state === 'running'
            ? 'ring'
            : 'none';
      expect(copyFor(v).indicator).toBe(expected);
    }
  });
});

describe('committed strips', () => {
  test('every variant key has an embedded strip', () => {
    for (const key of allVariantKeys()) {
      expect(STRIPS[key]).toBeString();
      expect(LAYOUT[key as keyof typeof LAYOUT]).toBeDefined();
    }
  });
});
