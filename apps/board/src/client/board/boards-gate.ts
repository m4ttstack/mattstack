import { consoleOrigin } from '@mattstack/settings-kit/embed';

/** A boards@1 gate asks whether evidence boards are safe to post, and the
    board's sheet cannot show the boards, so it points at the console's own
    view of the gate and offers no answer. */
export function boardsInConsole(
  gateId: string,
  context: string | undefined,
  loc: { protocol: string; hostname: string }
): { context: string; readOnly: string } | null {
  if (!context || context.trimStart()[0] !== '{') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(context);
  } catch {
    return null;
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as Record<string, unknown>)['gate-ctx'] !== 'boards@1'
  )
    return null;
  const url = `${consoleOrigin(loc)}/gates/${encodeURIComponent(gateId)}`;
  return {
    context: `[Look at these boards in the console](${url})`,
    readOnly:
      'This gate asks about evidence boards the board cannot show. Answer it in the console, where every board is on screen.',
  };
}
