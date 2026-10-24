import { describe, expect, test } from 'bun:test';

import { getDef } from '@mattstack/rt-client';
import { parseConfig } from '../config.ts';
import { parseTriageBlock } from '../triage/config.ts';

const minimal = parseConfig(
  JSON.stringify({
    gitlabHost: 'gitlab.example.com',
    projects: ['acme/widgets'],
    members: [{ username: 'dev1' }],
  }),
  'test'
);
const def = (key: string) => getDef(key)!.default;

describe('the registry defaults are what the board parsers fill in', () => {
  test('scalars and lists', () => {
    expect(def('board.title')).toBe(minimal.title);
    expect(def('board.defaultMember')).toBe(minimal.defaultMember);
    expect(def('board.gateGraceMinutes')).toBe(minimal.gateGraceMinutes);
    expect(def('board.doctorSkill')).toBe(minimal.doctorSkill);
    expect(def('board.botUsernames')).toEqual(minimal.botUsernames);
    expect(def('board.tabs')).toEqual(minimal.tabs);
  });

  test('workspaces and slack', () => {
    expect(def('board.workspaces')).toEqual({
      reviews: minimal.reviewsWorkspace,
      responds: minimal.respondsWorkspace,
      doctors: minimal.doctorsWorkspace,
      questions: minimal.questionsWorkspace,
    });
    const { channel: _fromTheDirectory, ...slack } = minimal.slack;
    expect(def('board.slack')).toEqual({ reviewKind: 'review', ...slack });
  });

  test('triage and its two sibling keys', () => {
    const { doctorSkill, maxConcurrent, ...block } =
      parseTriageBlock(undefined);
    expect(def('board.triage')).toEqual(block);
    expect(def('board.triage.doctorSkill')).toBe(doctorSkill);
    expect(def('board.triageMaxConcurrent')).toBe(maxConcurrent);
  });
});
