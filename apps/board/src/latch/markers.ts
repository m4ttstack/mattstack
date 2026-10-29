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

export {
  LATCH_MARKER,
  LATCH_MARKER_ERROR,
  LATCH_MARKER_QUEUED,
  LATCH_MARKER_RUNNING,
  LATCH_MARKER_SPENT,
  latchKindOf,
};
export type { LatchKind };

const ARMED_COPY = [
  "**Addressed everything?** Resolve this thread and I'll take another pass over the MR.",
  '',
  "Leave it open while there's still work in flight.",
].join('\n');

/** Why a latch was spent -- the wording differs because only one of these is
    a real reviewer verdict. "approved" is the terminal outcome; "duplicate"
    is an extra copy going defunct because another latch on the same MR
    already carries the live state, which must never read as an approval
    that did not happen. */
export type SpentReason = 'approved' | 'duplicate';

const SPENT_COPY =
  'Approved, so this latch is spent. Nothing further to do here.';
const DUPLICATE_COPY =
  'Superseded by a newer latch on this MR; nothing to do here.';

export function armedLatchBody(imageMarkdown: string): string {
  return `${LATCH_MARKER}\n\n${imageMarkdown}\n\n${ARMED_COPY}\n`;
}

export function spentLatchBody(
  imageMarkdown: string,
  reason: SpentReason = 'approved'
): string {
  const copy = reason === 'duplicate' ? DUPLICATE_COPY : SPENT_COPY;
  return `${LATCH_MARKER_SPENT}\n\n${imageMarkdown}\n\n${copy}\n`;
}

/** The banner's markdown image, pulled back out of a latch body so the spend
    can reuse the uploaded path instead of uploading the banner a second time. */
export function imageMarkdownOf(body: string): string | null {
  const m = body.match(/!\[[^\]]*\]\([^)]+\)/);
  return m ? m[0] : null;
}
