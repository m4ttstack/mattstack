/** One shared redemption code path for both onboarding entry points (setup and
    the board UI join), so the relay-side identity guard covers both. */
const INVITE_RE =
  /^(https?:\/\/[^\s\/]+(?:\/[^\s\/]+)*?)\/invite\/([0-9a-f]{32})\/?$/i;

/** Board tokens only ever go to the one switchboard, so an invite minted on
    any other origin is refused before anything is redeemed. */
export function parseInvite(
  s: string,
  relayUrl: string
): { ok: true; url: string; code: string } | { ok: false; message: string } {
  const m = s.trim().match(INVITE_RE);
  if (!m)
    return {
      ok: false,
      message:
        "that doesn't look like a board invite (expected .../invite/<code>)",
    };
  const url = m[1]!.replace(/\/+$/, '');
  if (!sameOrigin(url, relayUrl))
    return {
      ok: false,
      message: `that invite is for another switchboard; mattstack only uses ${relayUrl.replace(/\/+$/, '')}`,
    };
  return { ok: true, url, code: m[2]!.toLowerCase() };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Setup's prompt accepts blank (keep current settings) or a full invite
    link; anything else is a typo worth re-prompting on rather than silently
    treating as "skip". */
export function classifySetupAnswer(
  s: string,
  relayUrl: string
):
  | { kind: 'skip' }
  | { kind: 'invite'; url: string; code: string }
  | { kind: 'invalid'; message: string } {
  const trimmed = s.trim();
  if (!trimmed) return { kind: 'skip' };
  const inv = parseInvite(trimmed, relayUrl);
  if (inv.ok) return { kind: 'invite', url: inv.url, code: inv.code };
  return { kind: 'invalid', message: inv.message };
}

export async function redeemInvite(
  url: string,
  code: string,
  username: string,
  fetchFn: typeof fetch = fetch
): Promise<
  | { ok: true; username: string; token: string }
  | {
      ok: false;
      error: 'network' | 'unknown' | 'expired' | 'mismatch';
      message: string;
    }
> {
  let res: Response;
  try {
    res = await fetchFn(`${url.replace(/\/+$/, '')}/invites/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, username }),
    });
  } catch {
    return {
      ok: false,
      error: 'network',
      message:
        'could not reach the switchboard; check the address and try again',
    };
  }
  if (res.ok) {
    try {
      const body = (await res.json()) as {
        username?: unknown;
        token?: unknown;
      };
      if (typeof body.username === 'string' && typeof body.token === 'string')
        return { ok: true, username: body.username, token: body.token };
    } catch {
      // fall through: malformed body maps to the same "unexpected response" error below
    }
    return {
      ok: false,
      error: 'network',
      message: 'unexpected response from the switchboard',
    };
  }
  let message: string;
  try {
    message = await res.text();
  } catch {
    message = `switchboard answered ${res.status}`;
  }
  if (res.status === 404) return { ok: false, error: 'unknown', message };
  if (res.status === 410) return { ok: false, error: 'expired', message };
  if (res.status === 409) return { ok: false, error: 'mismatch', message };
  return {
    ok: false,
    error: 'network',
    message: message || `switchboard answered ${res.status}`,
  };
}
