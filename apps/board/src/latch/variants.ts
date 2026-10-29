/**
 * Every banner the latch can show, keyed so each one maps to a committed
 * text strip (assets/latch/<key>.png), plus the copy painted on the strip
 * and the plain sentence posted under it.
 */

import type { WaitReason } from './latch-state.ts';
import { ARMED_COPY, DUPLICATE_COPY, SPENT_COPY } from './markers.ts';

export type BannerState =
  | 'armed'
  | 'queued'
  | 'running'
  | 'error-retrying'
  | 'error-stuck'
  | 'done-comments'
  | 'done-approved'
  | 'approved'
  | 'superseded';

export interface BannerVariant {
  state: BannerState;
  wait?: WaitReason;
  count?: number | null;
}

export type Indicator = 'none' | 'dots' | 'ring';

export interface VariantCopy {
  title: string;
  sub: string;
  accent: string;
  indicator: Indicator;
  sentence: string;
}

const STATES: BannerState[] = [
  'armed',
  'queued',
  'running',
  'error-retrying',
  'error-stuck',
  'done-comments',
  'done-approved',
  'approved',
  'superseded',
];

const QUEUED_SUB: Record<WaitReason, string> = {
  'next-sweep': 'Starts on the next sweep',
  cooldown: 'Waiting out the cooldown',
  budget: 'Daily limit hit; starts tomorrow',
  'review-in-flight': 'Waiting for the running review',
};

const RETRY_SUB: Partial<Record<WaitReason, string>> = {
  'next-sweep': 'Retrying on the next sweep',
  cooldown: 'Retrying after the cooldown',
  budget: 'Daily limit hit; retrying tomorrow',
};

const WAITS = Object.keys(QUEUED_SUB) as WaitReason[];
const RETRY_WAITS = Object.keys(RETRY_SUB) as WaitReason[];

const MAX_COUNT = 20;

function countSlug(count: number | null | undefined): string {
  if (count == null || count <= 0) return 'none';
  if (count > MAX_COUNT) return '20plus';
  return String(count);
}

export function variantKey(v: BannerVariant): string {
  switch (v.state) {
    case 'queued':
      return `queued-${v.wait ?? 'next-sweep'}`;
    case 'error-retrying':
      return `error-retrying-${v.wait && RETRY_SUB[v.wait] ? v.wait : 'next-sweep'}`;
    case 'done-comments':
      return `done-comments-${countSlug(v.count)}`;
    default:
      return v.state;
  }
}

function allVariants(): BannerVariant[] {
  const out: BannerVariant[] = [];
  for (const state of STATES) {
    if (state === 'queued') {
      for (const wait of WAITS) out.push({ state, wait });
    } else if (state === 'error-retrying') {
      for (const wait of RETRY_WAITS) out.push({ state, wait });
    } else if (state === 'done-comments') {
      for (let n = 1; n <= MAX_COUNT + 1; n++) out.push({ state, count: n });
      out.push({ state, count: null });
    } else {
      out.push({ state });
    }
  }
  return out;
}

const BY_KEY = new Map(allVariants().map((v) => [variantKey(v), v]));

/** Stable order: BannerState order, then waits, then counts 1..20, 20plus, none. */
export function allVariantKeys(): string[] {
  return [...BY_KEY.keys()];
}

export function variantOfKey(key: string): BannerVariant | null {
  const v = BY_KEY.get(key);
  return v ? { ...v } : null;
}

function doneCommentsSub(count: number | null | undefined): string {
  if (count == null || count <= 0) return 'Review posted. Resolve when ready';
  if (count === 1) return '1 new comment. Resolve when ready';
  if (count > MAX_COUNT) return '20+ new comments. Resolve when ready';
  return `${count} new comments. Resolve when ready`;
}

export function copyFor(v: BannerVariant): VariantCopy {
  switch (v.state) {
    case 'armed':
      return {
        title: 'Ready for another pass?',
        sub: 'Resolve this thread to ask',
        accent: '#f08fb0',
        indicator: 'none',
        sentence: ARMED_COPY,
      };
    case 'queued':
      return {
        title: 'Follow-up review queued',
        sub: QUEUED_SUB[v.wait ?? 'next-sweep'],
        accent: '#e6b860',
        indicator: 'dots',
        sentence: "Follow-up review requested. I'll start it as soon as I can.",
      };
    case 'running':
      return {
        title: 'Follow-up review running',
        sub: 'Results post here when done',
        accent: '#7fbfe8',
        indicator: 'ring',
        sentence: "Follow-up review in progress. I'll reply here when it's done.",
      };
    case 'error-retrying':
      return {
        title: 'Follow-up review hit a snag',
        sub: (v.wait && RETRY_SUB[v.wait]) || 'Retrying on the next sweep',
        accent: '#f2917e',
        indicator: 'dots',
        sentence: "The follow-up review didn't finish. I'll try again.",
      };
    case 'error-stuck':
      return {
        title: 'Follow-up review stuck',
        sub: 'Reviewer notified',
        accent: '#f2917e',
        indicator: 'none',
        sentence:
          "The follow-up review didn't finish after 3 tries. The reviewer has been told.",
      };
    case 'done-comments':
      return {
        title: 'Follow-up review done',
        sub: doneCommentsSub(v.count),
        accent: '#b9a0f2',
        indicator: 'none',
        sentence:
          "Follow-up review done. Resolve this thread again when you've addressed the new comments.",
      };
    case 'done-approved':
      return {
        title: 'Follow-up review done',
        sub: 'Approved. Nothing more to do',
        accent: '#86cfa0',
        indicator: 'none',
        sentence: 'Follow-up review done and approved, so this latch is spent.',
      };
    case 'approved':
      return {
        title: 'Approved',
        sub: 'Nothing more to do',
        accent: '#86cfa0',
        indicator: 'none',
        sentence: SPENT_COPY,
      };
    case 'superseded':
      return {
        title: 'Superseded',
        sub: 'A newer latch is live',
        accent: '#8e88a0',
        indicator: 'none',
        sentence: DUPLICATE_COPY,
      };
  }
}
