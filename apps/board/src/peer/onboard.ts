/** The board's local-only peer read: which boards the switchboard knows.
    Pure over an injected fetch so it is testable without a server. */
export interface InviteCtx {
  url: string;
  adminToken: string;
  fetchFn?: typeof fetch;
}

export async function listPeerBoards(
  ctx: InviteCtx
): Promise<{ status: number; body: string }> {
  const fetchFn = ctx.fetchFn ?? fetch;
  try {
    const res = await fetchFn(`${ctx.url}/boards`, {
      headers: { authorization: `Bearer ${ctx.adminToken}` },
    });
    return { status: res.ok ? 200 : res.status, body: await res.text() };
  } catch {
    return { status: 502, body: 'could not reach the switchboard' };
  }
}
