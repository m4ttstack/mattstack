/**
 * The latch's GitLab writes, behind one injected gateway so the pass and the
 * server share them and tests need no network.
 */
import type { Database } from 'bun:sqlite';

import { getStateDb } from '../state/index.ts';
import { latchBannerGif } from './banner.ts';
import type { LatchRef } from './discussions.ts';
import {
  cachedUpload,
  casLatch,
  clearReplyDue,
  rememberUpload,
  type LatchPhase,
} from './latch-state.ts';
import { imageMarkdownFor, latchBody } from './markers.ts';
import {
  bannerAlt,
  copyFor,
  variantKey,
  type BannerVariant,
} from './variants.ts';

/** One MR as the gateway addresses it. `projectId` is a GitLab numeric id
    and is null where the forge has none. */
export interface LatchMr {
  projectId: number | null;
  projectPath: string;
  iid: number;
  rtRepo: string;
}

export interface LatchFile {
  filename: string;
  bytes: Uint8Array;
  contentType: string;
  alt: string;
}

export interface LatchGateway {
  forge: 'gitlab' | 'github';
  /** Markdown for each file, in the order given. */
  uploadFiles(mr: LatchMr, files: LatchFile[]): Promise<string[]>;
  createThread(
    mr: LatchMr,
    body: string
  ): Promise<{ discussionId: string; rootNoteId: number } | null>;
  updateNote(mr: LatchMr, noteId: number, body: string): Promise<void>;
  resolveDiscussion(mr: LatchMr, discussionId: string): Promise<void>;
  unresolveDiscussion(mr: LatchMr, discussionId: string): Promise<void>;
  createNote(
    mr: LatchMr,
    body: string,
    discussionId?: string
  ): Promise<{ id: number }>;
}

export type LatchTarget = LatchMr & {
  mrUrl: string;
  discussionId: string;
  rootNoteId: number;
};

type LatchMrUrl = LatchMr & { mrUrl: string };

/** Posts the reply a row owes its latch's discussion, then clears it. */
export async function postReplyDue(
  gw: LatchGateway,
  mr: LatchMrUrl,
  discussionId: string,
  body: string,
  db: Database = getStateDb()
): Promise<void> {
  await gw.createNote(mr, body, discussionId);
  clearReplyDue(mr.mrUrl, body, db);
}

/** This MR's banner for `variant`, uploaded only the first time the MR shows it. */
export async function bannerMarkdown(
  gw: LatchGateway,
  mr: LatchMrUrl,
  variant: BannerVariant,
  db: Database = getStateDb()
): Promise<string> {
  const { mrUrl, iid } = mr;
  const key = variantKey(variant);
  const alt = bannerAlt(variant);
  const cached = cachedUpload(mrUrl, key, db);
  // A row whose alt text no longer matches was drawn with older copy (or is a
  // sized pre-3x upload): it is replaced, not reused.
  if (cached?.startsWith(`![${alt}](`) && !cached.includes('{width='))
    return cached;
  const [uploaded] = await gw.uploadFiles(mr, [
    {
      filename: `latch-${iid}-${key}.gif`,
      bytes: latchBannerGif(mrUrl, variant),
      contentType: 'image/gif',
      alt,
    },
  ]);
  const markdown = imageMarkdownFor(alt, uploaded!);
  rememberUpload(mrUrl, key, markdown, db);
  return markdown;
}

async function writeNote(
  gw: LatchGateway,
  t: LatchMrUrl & { rootNoteId: number },
  phase: LatchPhase,
  variant: BannerVariant,
  db: Database
): Promise<void> {
  const img = await bannerMarkdown(gw, t, variant, db);
  const body = latchBody(phase, img, copyFor(variant).sentence);
  await gw.updateNote(t, t.rootNoteId, body);
}

/**
 * Show `phase` on the note with `variant`'s banner, then change the thread.
 * Body first: a crash between the two leaves the phase visible on the note,
 * and the row decides recovery.
 */
export async function rewriteLatch(
  gw: LatchGateway,
  t: LatchTarget,
  phase: LatchPhase,
  variant: BannerVariant,
  thread: 'resolve' | 'unresolve' | 'keep',
  now: number = Date.now(),
  db: Database = getStateDb()
): Promise<void> {
  await writeNote(gw, t, phase, variant, db);
  casLatch(t.mrUrl, [phase], { variant: variantKey(variant) }, now, db, {
    discussionId: t.discussionId,
  });
  if (thread === 'resolve') await gw.resolveDiscussion(t, t.discussionId);
  else if (thread === 'unresolve')
    await gw.unresolveDiscussion(t, t.discussionId);
}

/** Arm a fresh latch: upload this MR's banner, then open a resolvable thread.
    The caller writes the latch row from the returned ids. */
export async function postLatch(
  gw: LatchGateway,
  mr: LatchMrUrl,
  db: Database = getStateDb()
): Promise<{ discussionId: string; rootNoteId: number }> {
  const variant: BannerVariant = { state: 'armed' };
  const img = await bannerMarkdown(gw, mr, variant, db);
  const thread = await gw.createThread(
    mr,
    latchBody('armed', img, copyFor(variant).sentence)
  );
  if (!thread)
    throw new Error(`latch post on !${mr.iid} returned no root note`);
  return thread;
}

/**
 * Terminal disposal: rewrite the body to the spent form, then resolve.
 *
 * Ordered rewrite-first deliberately. A crash between the two calls leaves a
 * spent-but-unresolved latch, which the pass repairs by re-resolving. The
 * reverse order leaves a resolved-but-unspent latch, which reads as a human
 * request and costs a dispatch nobody asked for.
 *
 * The note is written whether or not this call moved the row: a caller may
 * already have moved it to spent.
 */
export async function spendLatch(
  gw: LatchGateway,
  mr: LatchMrUrl,
  latch: LatchRef,
  variant: BannerVariant,
  now: number = Date.now(),
  db: Database = getStateDb()
): Promise<void> {
  const { mrUrl } = mr;
  if (latch.kind === 'spent') {
    // Idempotent: an already-spent latch is left alone, except for the crash
    // residue where the body was written but the resolve never landed.
    if (!latch.resolved) await gw.resolveDiscussion(mr, latch.discussionId);
    return;
  }
  // The guard keeps a duplicate's spend off the row, which tracks one latch.
  const key = variantKey(variant);
  const guard = { discussionId: latch.discussionId };
  const moved = casLatch(
    mrUrl,
    ['armed', 'queued', 'running', 'error'],
    { phase: 'spent', variant: key },
    now,
    db,
    guard
  );
  if (!moved) casLatch(mrUrl, ['spent'], { variant: key }, now, db, guard);
  await writeNote(
    gw,
    { ...mr, rootNoteId: latch.rootNoteId },
    'spent',
    variant,
    db
  );
  await gw.resolveDiscussion(mr, latch.discussionId);
}

/** Terminal disposal of every latch copy found on an MR, deduped by
    discussion id. Every copy shares the same variant: whatever made the
    canonical latch terminal (an approval, most often) applies to the whole
    set, not just the newest one. */
export async function spendAllLatches(
  gw: LatchGateway,
  mr: LatchMrUrl,
  latches: LatchRef[],
  variant: BannerVariant,
  now: number = Date.now(),
  db: Database = getStateDb()
): Promise<void> {
  const seen = new Set<string>();
  for (const latch of latches) {
    if (seen.has(latch.discussionId)) continue;
    seen.add(latch.discussionId);
    await spendLatch(gw, mr, latch, variant, now, db);
  }
}
