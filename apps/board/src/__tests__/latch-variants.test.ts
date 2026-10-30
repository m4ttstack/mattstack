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
        'Superseded',
        'A newer latch is live',
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
      'Starts on the next sweep'
    );
    expect(SUB({ state: 'queued', wait: 'cooldown' })).toBe(
      'Waiting out the cooldown'
    );
    expect(SUB({ state: 'queued', wait: 'budget' })).toBe(
      'Daily limit hit; starts tomorrow'
    );
    expect(SUB({ state: 'queued', wait: 'review-in-flight' })).toBe(
      'Waiting for the running review'
    );
  });

  test('error-retrying subtitles name the wait', () => {
    expect(SUB({ state: 'error-retrying', wait: 'next-sweep' })).toBe(
      'Retrying on the next sweep'
    );
    expect(SUB({ state: 'error-retrying', wait: 'cooldown' })).toBe(
      'Retrying after the cooldown'
    );
    expect(SUB({ state: 'error-retrying', wait: 'budget' })).toBe(
      'Daily limit hit; retrying tomorrow'
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

  test('sentences under the image', () => {
    expect(copyFor({ state: 'armed' }).sentence).toBe(
      "**Addressed everything?** Resolve this thread and I'll take another pass over the MR.\n\nLeave it open while there's still work in flight."
    );
    expect(copyFor({ state: 'approved' }).sentence).toBe(
      'Approved, so this latch is spent. Nothing further to do here.'
    );
    expect(copyFor({ state: 'superseded' }).sentence).toBe(
      'Superseded by a newer latch on this MR; nothing to do here.'
    );
    expect(copyFor({ state: 'queued', wait: 'budget' }).sentence).toBe(
      "Follow-up review requested. I'll start it as soon as I can."
    );
    expect(copyFor({ state: 'running' }).sentence).toBe(
      "Follow-up review in progress. I'll reply here when it's done."
    );
    expect(
      copyFor({ state: 'error-retrying', wait: 'cooldown' }).sentence
    ).toBe("The follow-up review didn't finish. I'll try again.");
    expect(copyFor({ state: 'error-stuck' }).sentence).toBe(
      "The follow-up review didn't finish after 3 tries. The reviewer has been told."
    );
    expect(copyFor({ state: 'done-comments', count: 4 }).sentence).toBe(
      "Follow-up review done. Resolve this thread again when you've addressed the new comments."
    );
    expect(copyFor({ state: 'done-approved' }).sentence).toBe(
      'Follow-up review done and approved, so this latch is spent.'
    );
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
