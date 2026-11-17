import type { RtResponse } from '@mattstack/rt-client';

export type RefusalStatus = 400 | 404 | 409 | 502;

/** The transport's own prefix for a failed socket connection, which no daemon
    refusal carries. */
const UNREACHABLE_PREFIX = 'rt daemon unreachable';

/** A refused pause or redo as its status and body. A daemon refusal carries
    its `failure.code`, answered 409 unless `statuses` names another; a
    stopped daemon is 502. */
export function controlRefusal(
  res: RtResponse,
  statuses: Partial<Record<string, RefusalStatus>> = {}
): { status: RefusalStatus; body: { error: string; code?: string } } {
  const error = res.error ?? 'the daemon refused with no error detail';
  if (error.startsWith(UNREACHABLE_PREFIX)) {
    return { status: 502, body: { error } };
  }
  const code = res.failure?.code ?? 'failed';
  return { status: statuses[code] ?? 409, body: { error, code } };
}
