/** The board's side of a help request: what the form may show, and the one
    route that sends it. rt owns every check; these pass its answers on. */
import type {
  Commands,
  RtResponse,
  SupportPart,
  SupportSent,
} from '@mattstack/rt-client';

export type SupportAvailability = Commands['support:availability']['data'];
export interface SupportSentRequest extends SupportSent {
  /** Opens a Slack DM with the person it went to, when the board knows them. */
  hostDm: string | null;
}

export interface SupportRead {
  availability: SupportAvailability;
  /** What the org's support agent goes by. */
  persona: string;
  /** Opens a Slack DM with the host, when the board knows their account. */
  hostDm: string | null;
}

export interface SupportRouteDeps {
  isLocal: (req: Request) => boolean;
  /** From the board's own page: a send is a person's alone, and the daemon
      asks no gate for it. */
  fromPage: (req: Request) => boolean;
  requireJson: (req: Request) => Response | null;
  boardVersion: string;
  /** For one person, or the host now. */
  hostDm: (username?: string) => string | null;
  availability: () => Promise<RtResponse<SupportAvailability>>;
  mine: () => Promise<RtResponse<{ requests: SupportSent[] }>>;
  context: (
    a: Commands['support:context']['payload']
  ) => Promise<RtResponse<{ parts: SupportPart[] }>>;
  send: (
    a: Commands['support:send']['payload']
  ) => Promise<RtResponse<Commands['support:send']['data']>>;
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Only a refusal rt made itself says whether anything was sent; a daemon
    that never answered may still have sent it. */
function refusal(res: RtResponse): Response {
  if (res.failure?.code.startsWith('support-'))
    return json({ code: res.failure.code, message: res.failure.message }, 409);
  return json({ code: 'no-answer', message: 'rt did not answer' }, 502);
}

export async function supportRoute(
  req: Request,
  deps: SupportRouteDeps
): Promise<Response> {
  if (!deps.isLocal(req)) return json({ error: 'local only' }, 403);
  const { pathname } = new URL(req.url);
  const shown = (r: SupportSent): SupportSentRequest => ({
    ...r,
    hostDm: deps.hostDm(r.peer),
  });
  if (pathname === '/support/send' && !deps.fromPage(req))
    return json({ error: 'only from the board' }, 403);

  if (pathname === '/support' || pathname === '/support/mine') {
    if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
    if (pathname === '/support/mine') {
      const res = await deps.mine();
      return res.ok && res.data
        ? json({ requests: res.data.requests.map(shown) })
        : refusal(res);
    }
    const res = await deps.availability();
    if (!res.ok || !res.data) return refusal(res);
    return json({
      availability: res.data,
      persona:
        'persona' in res.data && res.data.persona ? res.data.persona : 'Maude',
      hostDm: deps.hostDm(),
    } satisfies SupportRead);
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const notJson = deps.requireJson(req);
  if (notJson) return notJson;
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body || typeof body !== 'object')
    return json({ error: 'expected a JSON object' }, 400);

  if (pathname === '/support/context') {
    const mr = body.mr as { url: string; state: string } | undefined;
    const res = await deps.context({
      ...(mr ? { mr } : {}),
      board: deps.boardVersion,
    });
    return res.ok && res.data ? json({ parts: res.data.parts }) : refusal(res);
  }
  if (pathname === '/support/send') {
    const res = await deps.send(
      body as unknown as Commands['support:send']['payload']
    );
    return res.ok && res.data
      ? json({ request: shown(res.data.request) })
      : refusal(res);
  }
  return json({ error: 'not found' }, 404);
}
