/**
 * The bodies built around the latch's machine markers. The markers and
 * their detection live in rt-client.
 */

import {
  LATCH_MARKER,
  LATCH_MARKER_ERROR,
  LATCH_MARKER_QUEUED,
  LATCH_MARKER_RUNNING,
  LATCH_MARKER_SPENT,
  latchKindOf,
  type LatchKind,
} from '@mattstack/rt-client';
import { mrNoun, type ForgeKind } from '../mr-ref.ts';

export {
  LATCH_MARKER,
  LATCH_MARKER_ERROR,
  LATCH_MARKER_QUEUED,
  LATCH_MARKER_RUNNING,
  LATCH_MARKER_SPENT,
  latchKindOf,
};
export type { LatchKind };

export function armedCopy(forge: ForgeKind): string {
  return [
    `**Addressed everything?** Resolve this thread and I'll take another pass over the ${mrNoun(forge)}.`,
    '',
    "Leave it open while there's still work in flight.",
  ].join('\n');
}

export const ARMED_COPY = armedCopy('gitlab');

// Typed by LatchKind, not latch-state's LatchPhase: the client bundle reaches
// this file, and latch-state pulls in bun:sqlite.
const PHASE_MARKER: Record<LatchKind, string> = {
  armed: LATCH_MARKER,
  queued: LATCH_MARKER_QUEUED,
  running: LATCH_MARKER_RUNNING,
  error: LATCH_MARKER_ERROR,
  spent: LATCH_MARKER_SPENT,
};

export function latchBody(
  phase: LatchKind,
  imageMarkdown: string,
  sentence?: string
): string {
  const parts = [PHASE_MARKER[phase], imageMarkdown];
  if (sentence) parts.push(sentence);
  return `${parts.join('\n\n')}\n`;
}

export function armedLatchBody(imageMarkdown: string): string {
  return latchBody('armed', imageMarkdown, ARMED_COPY);
}

export function spentLatchBody(imageMarkdown: string): string {
  return latchBody('spent', imageMarkdown);
}

/** Unsized on purpose: GitLab stretches the image to the comment column. */
export function imageMarkdownFor(
  title: string,
  markdownFromUpload: string
): string {
  const url =
    markdownFromUpload.match(/\]\(([^)]+)\)/)?.[1] ?? markdownFromUpload;
  return `![${title}](${url})`;
}

/** The banner's markdown image, pulled back out of a latch body. Also matches
    the older `{width=N}` GIF form. */
export function imageMarkdownOf(body: string): string | null {
  const m = body.match(/!\[[^\]]*\]\([^)]+\)(?:\{width=\d+\})?/);
  return m ? m[0] : null;
}
