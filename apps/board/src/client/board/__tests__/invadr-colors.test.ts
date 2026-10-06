import { describe, expect, test } from 'bun:test';

import { assignMemberLooks, themePalette } from '../invadr-colors.ts';

describe('themePalette', () => {
  test('a small roster gets the seven wheel hues and a grey', () => {
    const p = themePalette(4);
    expect(p).toHaveLength(8);
    expect(p[7]).toBe('color-mix(in oklch, var(--fg) 70%, var(--card))');
  });

  test('grows with the roster, every entry distinct', () => {
    for (const n of [7, 12, 13, 30]) {
      const p = themePalette(n);
      expect(p.length).toBeGreaterThanOrEqual(n);
      expect(new Set(p).size).toBe(p.length);
    }
  });

  test('the first pass adds one midpoint per pair of neighbouring hues', () => {
    const p = themePalette(9);
    expect(p).toHaveLength(15);
    expect(p[8]).toBe('color-mix(in oklch, var(--accent), var(--cyan))');
  });
});

describe('assignMemberLooks', () => {
  const team = Array.from({ length: 12 }, (_, i) => `member-${i}`);

  test('every member gets a distinct colour and a distinct creature', () => {
    const looks = [...assignMemberLooks(team).values()];
    expect(new Set(looks.map(l => l.fill)).size).toBe(12);
    expect(new Set(looks.map(l => l.sprite)).size).toBe(12);
  });

  test('fill is the palette colour the avatar is drawn with', () => {
    for (const look of assignMemberLooks(team).values())
      expect(look.fill).toBe(look.palette[look.color]!);
  });

  test('the first eight people get the eight base hues', () => {
    const fills = [...assignMemberLooks(team.slice(0, 8)).values()].map(
      l => l.fill
    );
    expect(fills).toEqual(themePalette(8));
  });

  test('appending people never changes the ones before them, even as the palette grows', () => {
    const before = assignMemberLooks(team.slice(0, 8));
    const after = assignMemberLooks(team);
    for (const id of team.slice(0, 8)) {
      expect(after.get(id)!.sprite).toBe(before.get(id)!.sprite);
      expect(after.get(id)!.fill).toBe(before.get(id)!.fill);
    }
  });

  test('a repeated id is assigned once', () => {
    expect(assignMemberLooks(['a', 'a', 'b']).size).toBe(2);
  });
});
