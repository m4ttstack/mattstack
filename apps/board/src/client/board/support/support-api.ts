import type { SupportPart } from '@mattstack/rt-client';
import type { SupportRead } from '../../../support.ts';
import { postAction } from '../../api.ts';
import type { HelpMr, HelpRequest, SendError } from './support-model.ts';

async function read<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export const getSupport = () =>
  read<Partial<SupportRead>>('/support').then(r =>
    r?.availability ? (r as SupportRead) : null
  );

export const getRequests = () =>
  read<{ requests: HelpRequest[] }>('/support/mine').then(
    d => d?.requests ?? null
  );

export async function getParts(
  mr: HelpMr | null
): Promise<SupportPart[] | null> {
  const r = await postAction(
    '/support/context',
    mr ? { mr: { url: mr.url, state: mr.state } } : {}
  );
  return r.ok ? (r.body as unknown as { parts: SupportPart[] }).parts : null;
}

/** What rt stored, or why it was not sent. */
export async function sendRequest(a: {
  id: string;
  text: string;
  parts: SupportPart[];
}): Promise<{ request: HelpRequest } | { error: SendError }> {
  const r = await postAction('/support/send', a);
  const body = r.body as unknown as
    (Partial<SendError> & { request?: HelpRequest }) | null;
  if (r.ok && body?.request) return { request: body.request };
  return {
    error:
      body?.code && body.message
        ? { code: body.code, message: body.message }
        : { code: 'no-answer', message: 'rt did not answer' },
  };
}
