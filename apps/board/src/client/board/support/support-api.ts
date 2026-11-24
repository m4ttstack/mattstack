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

export const getSupport = () => read<SupportRead>('/support');

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

/** The refusal, or null once it was sent. */
export async function sendRequest(a: {
  id: string;
  text: string;
  parts: SupportPart[];
}): Promise<SendError | null> {
  const r = await postAction('/support/send', a);
  if (r.ok) return null;
  const body = r.body as unknown as Partial<SendError> | null;
  return body?.code && body.message
    ? { code: body.code, message: body.message }
    : { code: 'no-answer', message: 'rt did not answer' };
}
