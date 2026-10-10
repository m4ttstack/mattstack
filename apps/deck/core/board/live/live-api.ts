import { apiDelete, apiPut } from '../api.ts';

export type SourceRow = {
  path: string;
  branch: string | null;
  main: boolean;
  needsSetup: boolean;
  lastActiveAt: string | null;
  liveApps: string[];
};

type LiveAnswer = {
  status: number;
  body: { ok?: true; setup?: 'running'; error?: string };
};

export async function getSources(
  name: string
): Promise<{ sources: SourceRow[]; error: string | null }> {
  try {
    const res = await fetch(`/api/v1/apps/${name}/live/sources`);
    const body = (await res.json().catch(() => ({}))) as {
      sources?: SourceRow[];
      error?: string | null;
    };
    if (!res.ok)
      return { sources: [], error: body.error ?? `failed (${res.status})` };
    return { sources: body.sources ?? [], error: body.error ?? null };
  } catch {
    return { sources: [], error: 'the board did not answer.' };
  }
}

async function send(res: Promise<Response>): Promise<LiveAnswer> {
  try {
    const r = await res;
    const body = (await r.json().catch(() => ({}))) as LiveAnswer['body'];
    return { status: r.status, body };
  } catch {
    return { status: 0, body: { error: 'the board did not answer.' } };
  }
}

export function putLive(name: string, source: string): Promise<LiveAnswer> {
  return send(apiPut(`/api/v1/apps/${name}/live`, { source }));
}

export function deleteLive(name: string): Promise<LiveAnswer> {
  return send(apiDelete(`/api/v1/apps/${name}/live`));
}
