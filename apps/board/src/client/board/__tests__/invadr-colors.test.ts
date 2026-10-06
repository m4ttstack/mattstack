import { describe, expect, test } from 'bun:test';
import { CSS_VARS, hashStr } from 'invadrs';

import {
  assignInvadrColors,
  assignMemberLooks,
  themePalette,
} from '../invadr-colors.ts';

const hashed = (id: string) =>
  CSS_VARS.colors[(hashStr(id) >>> 4) % CSS_VARS.colors.length];

describe('themePalette', () => {
  test('a small roster gets the base hues, which include every invadrs colour', () => {
    const p = themePalette(4);
    expect(p).toHaveLength(8);
    for (const c of CSS_VARS.colors) expect(p).toContain(c);
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

describe('assignInvadrColors', () => {
  const team = Array.from({ length: 20 }, (_, i) => `member-${i}`);

  test('no two members share a colour', () => {
    const colors = assignInvadrColors(team);
    expect(new Set(colors.values()).size).toBe(team.length);
  });

  test('the first member keeps the colour invadrs always gave it', () => {
    expect(assignInvadrColors(team).get('member-0')).toBe(hashed('member-0'));
  });

  test('a member with no clash keeps its hashed colour', () => {
    const a = 'member-0';
    const b = team.find(id => hashed(id) !== hashed(a))!;
    const colors = assignInvadrColors([a, b]);
    expect(colors.get(b)).toBe(hashed(b));
  });

  test('a clash moves the later member, not the earlier one', () => {
    const a = 'member-0';
    const b = team.find(id => id !== a && hashed(id) === hashed(a))!;
    const colors = assignInvadrColors([a, b]);
    expect(colors.get(a)).toBe(hashed(a));
    expect(colors.get(b)).not.toBe(hashed(a));
  });

  test('appending a member never recolours the ones before it', () => {
    const before = assignInvadrColors(team.slice(0, 8));
    const after = assignInvadrColors(team.slice(0, 9));
    for (const id of team.slice(0, 8))
      expect(after.get(id)).toBe(before.get(id));
  });

  test('a repeated id is assigned once', () => {
    const colors = assignInvadrColors(['member-1', 'member-1', 'member-2']);
    expect(colors.size).toBe(2);
  });
});

describe('assignMemberLooks', () => {
  test('every member gets a distinct colour and a distinct creature', () => {
    const team = Array.from({ length: 12 }, (_, i) => `member-${i}`);
    const looks = assignMemberLooks(team);
    expect(new Set([...looks.values()].map(l => l.color)).size).toBe(12);
    expect(new Set([...looks.values()].map(l => l.sprite)).size).toBe(12);
  });
});
