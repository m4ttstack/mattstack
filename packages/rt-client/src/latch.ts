/**
 * The re-review latch's machine markers.
 *
 * Detection depends on the marker and never on the banner image, so a blocked,
 * broken or missing image can never break the latch. The marker only counts
 * when it is the body's first line, so a teammate quoting one in an ordinary
 * comment never gets misread as a latch.
 */

export const LATCH_MARKER = "<!-- mattstack:board re-review-latch v1 -->";
export const LATCH_MARKER_SPENT = "<!-- mattstack:board re-review-latch v1 spent -->";

export type LatchKind = "armed" | "spent";

/** Which latch a note body is, or null if it is not a latch this reader knows.
    An unrecognized version (v2 from a newer board) is null, not armed. */
export function latchKindOf(body: string): LatchKind | null {
  const firstLine = body.split(/\r?\n/, 1)[0];
  if (firstLine === LATCH_MARKER_SPENT) return "spent";
  if (firstLine === LATCH_MARKER) return "armed";
  return null;
}
