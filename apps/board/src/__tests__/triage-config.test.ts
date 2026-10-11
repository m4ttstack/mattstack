import { describe, expect, test } from 'bun:test';

import type { getSetting } from '@mattstack/rt-client';
import {
  loadPeerAsksAlwaysAllow,
  loadTriageConfig,
  parseTriageBlock,
} from '../triage/config.ts';
import { fakeResolve } from './fake-resolve.ts';

describe('loadPeerAsksAlwaysAllow', () => {
  const resolve = (v: unknown) =>
    (() => ({ value: v, provenance: [] })) as unknown as typeof getSetting;

  test('reads canonical usernames, empty when unset or malformed', () => {
    expect([...loadPeerAsksAlwaysAllow(resolve([' Rae ', 'tom']))]).toEqual([
      'rae',
      'tom',
    ]);
    expect(loadPeerAsksAlwaysAllow(resolve(undefined)).size).toBe(0);
    expect(loadPeerAsksAlwaysAllow(resolve('rae')).size).toBe(0);
  });
});

describe('parseTriageBlock', () => {
  test('absent block yields disabled defaults', () => {
    const cfg = parseTriageBlock(undefined);
    expect(cfg.enabled).toBe(false);
    expect(cfg.cooldownMinutes).toBe(30);
    expect(cfg.maxConcurrent).toBe(2);
    expect(cfg.dailyAttemptBudget).toBe(3);
    expect(cfg.fixClasses).toEqual({
      retryFlake: true,
      inheritedNoteDraft: true,
      cleanApiRebase: false,
      mechanicalLint: false,
      codeFix: false,
    });
    expect(cfg.doctorSkill).toBe('');
    expect(cfg.notify).toBe('rt');
  });

  test('partial block overlays defaults', () => {
    const cfg = parseTriageBlock({
      enabled: true,
      fixClasses: { cleanApiRebase: true },
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.fixClasses.cleanApiRebase).toBe(true);
    expect(cfg.fixClasses.retryFlake).toBe(true); // untouched default
    expect(cfg.cooldownMinutes).toBe(30);
  });

  test('mechanicalLint defaults off and is independently settable (MAT-351)', () => {
    expect(parseTriageBlock(undefined).fixClasses.mechanicalLint).toBe(false);
    const cfg = parseTriageBlock({
      enabled: true,
      fixClasses: { mechanicalLint: true },
    });
    expect(cfg.fixClasses.mechanicalLint).toBe(true);
    expect(cfg.fixClasses.retryFlake).toBe(true); // untouched default
    expect(() =>
      parseTriageBlock({ fixClasses: { mechanicalLint: 'yes' } })
    ).toThrow();
  });

  test('rejects bad shapes', () => {
    expect(() => parseTriageBlock([])).toThrow();
    expect(() => parseTriageBlock({ notify: 'slack' })).toThrow();
    expect(() => parseTriageBlock({ cooldownMinutes: -1 })).toThrow();
    expect(() => parseTriageBlock({ doctorSkill: 5 })).toThrow();
  });
});

test('tier defaults to api, accepts checkout, rejects junk', () => {
  expect(parseTriageBlock({ enabled: true }).tier).toBe('api');
  expect(parseTriageBlock({ enabled: true, tier: 'checkout' }).tier).toBe(
    'checkout'
  );
  expect(() => parseTriageBlock({ enabled: true, tier: 'yolo' })).toThrow(
    /triage.tier/
  );
});

describe('loadTriageConfig', () => {
  test('nothing set reads the disabled defaults', () => {
    expect(loadTriageConfig(fakeResolve({}))).toEqual(
      parseTriageBlock(undefined)
    );
  });
  test('the two sibling keys win independently of board.triage', () => {
    const cfg = loadTriageConfig(
      fakeResolve({
        'board.triage': { enabled: true },
        'board.triage.doctorSkill': 'acme:doctor',
        'board.triageMaxConcurrent': 4,
      })
    );
    expect(cfg).toMatchObject({
      enabled: true,
      doctorSkill: 'acme:doctor',
      maxConcurrent: 4,
    });
  });
  test('a non-positive maxConcurrent keeps the default', () => {
    expect(
      loadTriageConfig(fakeResolve({ 'board.triageMaxConcurrent': 0 }))
        .maxConcurrent
    ).toBe(2);
  });
  test('a malformed board.triage names the settings key', () => {
    expect(() =>
      loadTriageConfig(fakeResolve({ 'board.triage': { enabled: 'yes' } }))
    ).toThrow('settings key "board.triage"');
  });
});
