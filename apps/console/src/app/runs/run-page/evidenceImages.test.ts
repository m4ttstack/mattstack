import { readEvidence } from '@mattstack/rt-client/evidence';
import { describe, expect, it } from 'vitest';

import {
  addressOf,
  badgesOf,
  caseWaived,
  evidenceUrl,
  headLabel,
  isTheme,
  phaseWaived,
  shotIn,
  shotLine,
  shownName,
  slotsOf,
  themesIn,
  transcriptUrl,
  type EvidenceCases,
} from './evidenceImages';

const E = '/fixture/evidence/web-421';
const V2 = {
  v: 2,
  cases: [
    {
      id: 'rush-window',
      label: 'Rush order, same-day window',
      before: {
        path: `${E}/rush-before.png`,
        annotated: `${E}/rush-before-annotated.png`,
        caption: 'Red box: no window',
      },
      after: {
        path: `${E}/rush-after.png`,
        annotated: `${E}/rush-after-annotated.png`,
        caption: 'Red box: window shows',
      },
    },
    {
      id: 'order-card-themes',
      label: 'Order card in light and dark',
      after: {
        light: {
          path: `${E}/card-after-light.png`,
          annotated: `${E}/card-after-light-annotated.png`,
          caption: 'Arrow: contrast',
        },
        dark: {
          path: `${E}/card-after-dark.png`,
          waiver: 'Same marks as light; only the theme differs',
        },
      },
    },
    {
      id: 'empty-state',
      label: 'No delivery window yet',
      after: { path: `${E}/empty-after.png` },
      waiver: 'Before and after are pixel-identical',
    },
    {
      id: 'dark-only',
      label: 'Dark only',
      after: { dark: { path: `${E}/d.png`, waiver: 'x' } },
    },
  ],
};

function cases(value: unknown): EvidenceCases {
  const rec = readEvidence(JSON.stringify(value));
  if (rec.version !== 2) throw new Error('expected cases');
  return rec;
}
const rec = cases(V2);
const [rush, themes, empty, darkOnly] = rec.cases;

describe('case helpers', () => {
  it('lists slots before then after, and themes light first', () => {
    expect(slotsOf(rush!)).toEqual(['before', 'after']);
    expect(slotsOf(themes!)).toEqual(['after']);
    expect(themesIn(themes!)).toEqual(['light', 'dark']);
    expect(themesIn(rush!)).toEqual([]);
    expect(themesIn(darkOnly!)).toEqual(['dark']);
  });

  it('picks the asked theme, else the slot’s first shot', () => {
    expect(shotIn(themes!, 'after', 'dark')?.theme).toBe('dark');
    expect(shotIn(themes!, 'after')?.theme).toBe('light');
    expect(shotIn(darkOnly!, 'after', 'light')?.theme).toBe('dark');
    expect(shotIn(rush!, 'after', 'dark')?.theme).toBeUndefined();
    expect(shotIn(themes!, 'before')).toBeNull();
  });

  it('calls a case or slot waived only when none of its images is annotated', () => {
    expect(caseWaived(empty!)).toBe(true);
    expect(caseWaived(themes!)).toBe(false);
    expect(phaseWaived(themes!, 'after')).toBe(false);
    expect(phaseWaived(empty!, 'after')).toBe(true);
    expect(phaseWaived(empty!, 'before')).toBe(false);
  });

  it('badges themes and a waived case', () => {
    expect(badgesOf(themes!)).toEqual(['light + dark']);
    expect(badgesOf(empty!)).toEqual(['waived']);
    expect(badgesOf(empty!, 'after')).toEqual(['waived']);
    expect(badgesOf(rush!)).toEqual([]);
  });

  it('says what an image shows: its caption, its own waiver, or Waived under the case’s', () => {
    expect(shotLine(rush!, shotIn(rush!, 'after')!)).toEqual({
      kind: 'caption',
      text: 'Red box: window shows',
    });
    expect(shotLine(themes!, shotIn(themes!, 'after', 'dark')!)).toEqual({
      kind: 'waiver',
      text: 'Waived: Same marks as light; only the theme differs',
    });
    expect(shotLine(empty!, shotIn(empty!, 'after')!)).toEqual({
      kind: 'waiver',
      text: 'Waived',
    });
  });

  it('heads a case with its label, except a v1 record’s fallback label', () => {
    expect(headLabel(rec, rush!)).toBe('Rush order, same-day window');
    const v1 = cases({ v: 1, before: '/a/b.png' });
    expect(headLabel(v1, v1.cases[0]!)).toBeNull();
    const named = cases({ v: 1, before: '/a/b.png', case: 'Rush order' });
    expect(headLabel(named, named.cases[0]!)).toBe('Rush order');
  });

  it('addresses the annotated image by default and the base when there is none', () => {
    const shot = shotIn(themes!, 'after', 'light')!;
    expect(addressOf(themes!, 'after', shot)).toEqual({
      caseId: 'order-card-themes',
      slot: 'after',
      theme: 'light',
      annotated: true,
    });
    expect(addressOf(themes!, 'after', shot, 'plain').annotated).toBe(false);
    expect(addressOf(empty!, 'after', shotIn(empty!, 'after')!)).toEqual({
      caseId: 'empty-state',
      slot: 'after',
      annotated: false,
    });
    expect(shownName(shot)).toBe('card-after-light-annotated.png');
    expect(shownName(shot, 'plain')).toBe('card-after-light.png');
  });

  it('builds the image and transcript URLs', () => {
    expect(
      evidenceUrl('remote:acme%2Fweb', '20261008-1210', {
        caseId: 'order-card-themes',
        slot: 'after',
        theme: 'dark',
        annotated: false,
      })
    ).toBe(
      '/api/runs/remote:acme%2Fweb/20261008-1210/evidence/order-card-themes/after?theme=dark'
    );
    expect(
      evidenceUrl('r', '1', { caseId: 'case', slot: 'before', annotated: true })
    ).toBe('/api/runs/r/1/evidence/case/before?annotated=1');
    expect(transcriptUrl('r', '1')).toBe('/api/runs/r/1/evidence/transcript');
  });

  it('knows a theme', () => {
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('sepia')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});
