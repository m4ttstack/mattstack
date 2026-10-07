import { describe, expect, test } from 'vitest';

import { ACCENT_LOOK, assignMemberLooks, themePalette } from './member-looks';
import { speakerHue } from './speaker-hue';

describe('themePalette', () => {
  test('a small roster gets the six wheel hues and a grey, never accent', () => {
    const p = themePalette(4);
    expect(p).toHaveLength(7);
    expect(p[6]!.body).toBe('var(--tk-text-2)');
    expect(p).not.toContain(ACCENT_LOOK);
  });

  test('grows with the roster, every entry distinct', () => {
    for (const n of [7, 12, 13, 30]) {
      const p = themePalette(n);
      expect(p.length).toBeGreaterThanOrEqual(n);
      expect(new Set(p.map(h => h.body)).size).toBe(p.length);
    }
  });

  test('a midpoint mixes every shade of its two neighbours', () => {
    const mid = themePalette(8)[7]!;
    expect(mid.body).toMatch(/^color-mix\(in oklch, var\(--/);
    expect(mid.fill).toMatch(/^color-mix\(in oklch, var\(--tk-fill-/);
  });
});

describe('assignMemberLooks', () => {
  const team = Array.from({ length: 12 }, (_, i) => `agent-${i}`);

  test('every member gets a distinct hue and a distinct creature', () => {
    const looks = [...assignMemberLooks(team, 'matt').values()];
    expect(new Set(looks.map(l => l.hue.body)).size).toBe(12);
    expect(new Set(looks.map(l => l.sprite)).size).toBe(12);
  });

  test('the human takes accent and nobody else does', () => {
    const looks = assignMemberLooks(['matt', ...team], 'matt');
    expect(looks.get('matt')!.hue).toBe(ACCENT_LOOK);
    for (const id of team) expect(looks.get(id)!.hue).not.toBe(ACCENT_LOOK);
  });

  test('the human does not use up a palette hue', () => {
    const withHuman = assignMemberLooks(['matt', ...team], 'matt');
    const without = assignMemberLooks(team, 'matt');
    for (const id of team)
      expect(withHuman.get(id)!.hue).toEqual(without.get(id)!.hue);
  });

  test('appending people never changes the ones before them', () => {
    const before = assignMemberLooks(team.slice(0, 6), 'matt');
    const after = assignMemberLooks(team, 'matt');
    for (const id of team.slice(0, 6)) {
      expect(after.get(id)!.sprite).toBe(before.get(id)!.sprite);
      expect(after.get(id)!.hue).toEqual(before.get(id)!.hue);
    }
  });

  test('a repeated id is assigned once', () => {
    expect(assignMemberLooks(['a', 'a', 'b'], 'matt').size).toBe(2);
  });
});

test('an assigned look sets the name chip to the avatar hue', () => {
  const look = assignMemberLooks(['fox'], 'matt').get('fox')!;
  expect(speakerHue('fox', 'matt', 'body', look)).toEqual({
    text: look.hue.body,
    fill: look.hue.fill,
  });
  expect(speakerHue('fox', 'matt', 'small', look).text).toBe(look.hue.small);
});
