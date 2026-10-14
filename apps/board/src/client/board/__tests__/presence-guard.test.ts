import { describe, expect, test } from 'bun:test';

import type { BoardMR } from '../../../data.ts';
import { presenceConfirmFor } from '../presence-guard.ts';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const mr = (reviewer?: string) =>
  ({
    author: { username: 'kim' },
    peerReviews: reviewer
      ? [
          {
            mrUrl: 'u',
            iid: 1,
            reviewer,
            status: 'reviewing',
            updatedAt: NOW,
            receivedAt: NOW,
          },
        ]
      : [],
  }) as unknown as BoardMR;

describe('presenceConfirmFor', () => {
  test('a fresh review or re-review on a peer-reviewed MR asks first', () => {
    expect(presenceConfirmFor('review', {}, mr('mira'), 'me', NOW)).toBe(
      'mira'
    );
    expect(presenceConfirmFor('re-review', {}, mr('mira'), 'me', NOW)).toBe(
      'mira'
    );
  });

  test('focus, quiet, resume and other lanes never ask', () => {
    expect(
      presenceConfirmFor('review', { intent: 'focus' }, mr('mira'), 'me', NOW)
    ).toBeNull();
    expect(
      presenceConfirmFor('review', { quiet: true }, mr('mira'), 'me', NOW)
    ).toBeNull();
    expect(
      presenceConfirmFor('resume-review', {}, mr('mira'), 'me', NOW)
    ).toBeNull();
    expect(presenceConfirmFor('respond', {}, mr('mira'), 'me', NOW)).toBeNull();
  });

  test('my own reviewing state, or nobody reviewing, never asks', () => {
    expect(presenceConfirmFor('review', {}, mr('me'), 'me', NOW)).toBeNull();
    expect(presenceConfirmFor('review', {}, mr(), 'me', NOW)).toBeNull();
  });
});
