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
import { copyFor, variantKey, type BannerVariant } from './variants.ts';

export interface LatchGateway {
  uploadFile(
    projectId: number,
    filename: string,
    bytes: Uint8Array,
    contentType?: string
  ): Promise<{ markdown: string; url: string; alt: string; full_path: string }>;
  createDiscussion(
    projectId: number,
    mrIid: number,
    body: string
  ): Promise<{ id: string; notes: { id: number }[] }>;
  updateNote(
    projectId: number,
    mrIid: number,
    noteId: number,
    body: string
  ): Promise<void>;
  resolveDiscussion(
    projectPath: string,
    mrIid: number,
    discussionId: string
  ): Promise<void>;
  unresolveDiscussion(
    projectPath: string,
    mrIid: number,
    discussionId: string
  ): Promise<void>;
  createNote(
    projectId: number,
    mrIid: number,
    body: string,
    discussionId?: string
  ): Promise<{ id: number }>;
}

export interface LatchTarget {
  projectId: number;
  projectPath: string;
  iid: number;
  mrUrl: string;
  discussionId: string;
  rootNoteId: number;
}

/** Posts the reply a row owes its latch's discussion, then clears it. */
export async function postReplyDue(
  gw: LatchGateway,
  mr: Pick<LatchTarget, 'projectId' | 'iid' | 'mrUrl'>,
  discussionId: string,
  body: string,
  db: Database = getStateDb()
): Promise<void> {
  await gw.createNote(mr.projectId, mr.iid, body, discussionId);
  clearReplyDue(mr.mrUrl, body, db);
}

/** This MR's banner for `variant`, uploaded only the first time the MR shows it. */
export async function bannerMarkdown(
  gw: LatchGateway,
  projectId: number,
  mrUrl: string,
  iid: number,
  variant: BannerVariant,
  db: Database = getStateDb()
): Promise<string> {
  const key = variantKey(variant);
  const cached = cachedUpload(mrUrl, key, db);
  if (cached) return cached;
  const up = await gw.uploadFile(
    projectId,
    `latch-${iid}-${key}.gif`,
    latchBannerGif(mrUrl, variant),
    'image/gif'
  );
  const markdown = imageMarkdownFor(copyFor(variant).title, up.markdown);
  rememberUpload(mrUrl, key, markdown, db);
  return markdown;
}

async function writeNote(
  gw: LatchGateway,
  t: Pick<LatchTarget, 'projectId' | 'iid' | 'mrUrl' | 'rootNoteId'>,
  phase: LatchPhase,
  variant: BannerVariant,
  db: Database
): Promise<void> {
  const img = await bannerMarkdown(
    gw,
    t.projectId,
    t.mrUrl,
    t.iid,
    variant,
    db
  );
  const body = latchBody(phase, img, copyFor(variant).sentence);
  await gw.updateNote(t.projectId, t.iid, t.rootNoteId, body);
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
  if (thread === 'resolve')
    await gw.resolveDiscussion(t.projectPath, t.iid, t.discussionId);
  else if (thread === 'unresolve')
    await gw.unresolveDiscussion(t.projectPath, t.iid, t.discussionId);
}

/** Arm a fresh latch: upload this MR's banner, then open a resolvable thread.
    The caller writes the latch row from the returned ids. */
export async function postLatch(
  gw: LatchGateway,
  projectId: number,
  _projectPath: string,
  mrUrl: string,
  iid: number,
  db: Database = getStateDb()
): Promise<{ discussionId: string; rootNoteId: number }> {
  const variant: BannerVariant = { state: 'armed' };
  const img = await bannerMarkdown(gw, projectId, mrUrl, iid, variant, db);
  const d = await gw.createDiscussion(
    projectId,
    iid,
    latchBody('armed', img, copyFor(variant).sentence)
  );
  const root = d.notes[0];
  if (!root) throw new Error(`latch post on !${iid} returned no root note`);
  return { discussionId: d.id, rootNoteId: root.id };
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
  projectId: number,
  projectPath: string,
  mrUrl: string,
  iid: number,
  latch: LatchRef,
  variant: BannerVariant,
  now: number = Date.now(),
  db: Database = getStateDb()
): Promise<void> {
  if (latch.kind === 'spent') {
    // Idempotent: an already-spent latch is left alone, except for the crash
    // residue where the body was written but the resolve never landed.
    if (!latch.resolved)
      await gw.resolveDiscussion(projectPath, iid, latch.discussionId);
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
    { projectId, iid, mrUrl, rootNoteId: latch.rootNoteId },
    'spent',
    variant,
    db
  );
  await gw.resolveDiscussion(projectPath, iid, latch.discussionId);
}

/** Terminal disposal of every latch copy found on an MR, deduped by
    discussion id. Every copy shares the same variant: whatever made the
    canonical latch terminal (an approval, most often) applies to the whole
    set, not just the newest one. */
export async function spendAllLatches(
  gw: LatchGateway,
  projectId: number,
  projectPath: string,
  mrUrl: string,
  iid: number,
  latches: LatchRef[],
  variant: BannerVariant,
  now: number = Date.now(),
  db: Database = getStateDb()
): Promise<void> {
  const seen = new Set<string>();
  for (const latch of latches) {
    if (seen.has(latch.discussionId)) continue;
    seen.add(latch.discussionId);
    await spendLatch(
      gw,
      projectId,
      projectPath,
      mrUrl,
      iid,
      latch,
      variant,
      now,
      db
    );
  }
}
