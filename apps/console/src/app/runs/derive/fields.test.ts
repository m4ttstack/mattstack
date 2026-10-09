import type { RunFieldRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { fieldLabel, placeFields, shortPath, storyFields } from './fields';
import type { StageAttempt } from './stages';

const f = (key: string, at: number): RunFieldRow => ({
  key,
  value: 'v',
  produced_by: 'x',
  at,
});
const a = (
  stage: string,
  attempt: number,
  startedAt: number | null,
  endedAt: number | null
): StageAttempt => ({
  stage,
  attempt,
  status: 'done',
  startedAt,
  endedAt,
});

describe('storyFields', () => {
  it('drops plumbing, side-card keys and evidence', () => {
    const keys = [
      'hold',
      'gate',
      'waiting-gate',
      'claude-session',
      'herdr-pane',
      'agent',
      'pipeline-stages',
      'extra.foo',
      'ticket',
      'branch',
      'worktree',
      'mr',
      'commits',
      'evidence',
      'approach',
      'plan-path',
    ];
    expect(storyFields(keys.map(k => f(k, 1))).map(x => x.key)).toEqual([
      'approach',
      'plan-path',
    ]);
  });
});

describe('placeFields', () => {
  const attempts = [
    a('plan', 1, 100, 200),
    a('implement', 1, 200, 300),
    a('implement', 2, 400, 500),
  ];

  it('places a field in the attempt whose window holds its time', () => {
    const placed = placeFields(
      [f('p', 150), f('x', 250), f('y', 450)],
      attempts
    );
    expect(placed.get('plan#1')?.map(x => x.key)).toEqual(['p']);
    expect(placed.get('implement#1')?.map(x => x.key)).toEqual(['x']);
    expect(placed.get('implement#2')?.map(x => x.key)).toEqual(['y']);
  });

  it('runs a window to the next attempt when the attempt has no end', () => {
    const open = [a('implement', 1, 200, null), a('implement', 2, 400, null)];
    const placed = placeFields([f('x', 350), f('y', 900)], open);
    expect(placed.get('implement#1')?.map(x => x.key)).toEqual(['x']);
    expect(placed.get('implement#2')?.map(x => x.key)).toEqual(['y']);
  });

  it('gives a boundary time to the later attempt', () => {
    const placed = placeFields([f('x', 200)], attempts);
    expect(placed.get('implement#1')?.map(x => x.key)).toEqual(['x']);
    expect(placed.has('plan#1')).toBe(false);
  });

  it('holds a field written after an attempt ended until the next one starts', () => {
    const placed = placeFields([f('gap', 350)], attempts);
    expect(placed.get('implement#1')?.map(x => x.key)).toEqual(['gap']);
  });

  it('drops a field written before the first attempt', () => {
    expect(placeFields([f('early', 50)], attempts).size).toBe(0);
  });

  it('ignores attempts that never started', () => {
    expect(placeFields([f('x', 5)], [a('plan', 1, null, null)]).size).toBe(0);
  });
});

describe('fieldLabel', () => {
  it.each([
    ['approach', 'Approach'],
    ['evidence-plan', 'Evidence plan'],
    ['extra_gates', 'Extra gates'],
    ['ShipTarget', 'Ship target'],
    ['ci', 'CI'],
    ['mr', 'MR'],
    ['shiptarget', 'Ship target'],
    ['ship-target', 'Ship target'],
  ])('%s reads %s', (key, label) => expect(fieldLabel(key)).toBe(label));
});

describe('shortPath', () => {
  it('keeps the last three folders of a long path', () => {
    expect(
      shortPath('/Users/acme/.mattstack/rt/worktrees/acme-web/molly')
    ).toBe('…/worktrees/acme-web/molly');
  });

  it('leaves a short path alone', () => {
    expect(shortPath('/tmp/x')).toBe('/tmp/x');
  });
});
