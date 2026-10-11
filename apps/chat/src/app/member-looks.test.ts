import { describe, expect, test } from 'vitest';

import {
  ACCENT_LOOK,
  assignMemberLooks,
  settleRoomLooks,
  themePalette,
} from './member-looks';
import { speakerHue } from './speaker-hue';

describe('themePalette', () => {
  test('a small roster gets the six wheel hues and a grey, never accent', () => {
    const p = themePalette(7);
    expect(new Set(p.map(h => h.body)).size).toBe(7);
    expect(p[6]!.body).toBe('var(--tk-text-2)');
    expect(p).not.toContain(ACCENT_LOOK);
  });

  test("no hue draws on the human's accent", () => {
    for (const h of themePalette(60))
      expect(Object.values(h).join(' ')).not.toMatch(/accent/);
  });

  test('the first six people never get neighbouring hues on the wheel', () => {
    const wheel = ['cyan', 'ok', 'gold', 'warn', 'bad', 'purple'];
    const at = (h: { body: string }) =>
      wheel.findIndex(
        name =>
          h.body.startsWith(`var(--tk-text-${name})`) ||
          h.body.includes(`var(--tk-text-${name}),`)
      );
    const first = themePalette(7).slice(0, 6).map(at);
    expect(new Set(first).size).toBe(6);
    for (let i = 1; i < first.length; i++)
      expect(Math.abs(first[i]! - first[i - 1]!)).toBeGreaterThan(1);
  });

  test('past the seven base hues the palette repeats, never blends', () => {
    const p = themePalette(16);
    expect(p[7]).toEqual(p[0]);
    for (const h of p)
      expect(h.body).not.toMatch(/color-mix\(in oklch, var\(--tk-text-(?!ok)/);
  });
});

describe('assignMemberLooks', () => {
  const team = Array.from({ length: 12 }, (_, i) => `agent-${i}`);

  test('every member gets a distinct look, and a distinct creature', () => {
    const looks = [...assignMemberLooks(team, 'matt').values()];
    expect(new Set(looks.map(l => `${l.hue.body}|${l.sprite}`)).size).toBe(12);
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

describe('settleRoomLooks', () => {
  const team = Array.from({ length: 9 }, (_, i) => `agent-${i}`);

  test('two people in one room never share a hue', () => {
    const looks = assignMemberLooks(team, 'matt');
    expect(looks.get('agent-7')!.hue).toEqual(looks.get('agent-0')!.hue);
    const room = settleRoomLooks(looks, ['agent-7', 'agent-0']);
    expect(room.get('agent-7')!.hue).not.toEqual(room.get('agent-0')!.hue);
    expect(room.get('agent-0')).toEqual(looks.get('agent-0'));
    expect(room.get('agent-7')!.sprite).toBe(looks.get('agent-7')!.sprite);
  });

  test('without a clash nobody changes', () => {
    const looks = assignMemberLooks(team, 'matt');
    expect(settleRoomLooks(looks, ['agent-1', 'agent-2'])).toEqual(looks);
  });
});
