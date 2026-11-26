import { ORG_TOKEN_RE } from './orgs.ts';

const DEFAULT_URL = 'https://switchboard.mattstack.dev';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const USAGE = 'usage: operator <orgs | mint | token <org id>>';

type Result = { code: number; stdout: string; stderr: string };

/** Same rule as `acceptedOverride` in rt-client; the relay cannot import it. */
function acceptedUrl(raw: string): string | null {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.username !== '' || parsed.password !== '') return null;
  const local =
    parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !local) return null;
  return trimmed.replace(/\/+$/, '');
}

const fail = (stderr: string): Result => ({
  code: 1,
  stdout: '',
  stderr: `${stderr}\n`,
});

export async function runOperator(
  argv: string[],
  env: Record<string, string | undefined>,
  fetchFn: typeof fetch
): Promise<Result> {
  const [verb, id] = argv;
  const valid =
    (verb === 'orgs' || verb === 'mint') && id === undefined
      ? true
      : verb === 'token' && id !== undefined && /^[0-9a-f]{32}$/.test(id);
  if (!valid) return fail(USAGE);

  const master = env.SWITCHBOARD_OPERATOR_TOKEN;
  if (!master)
    return fail("set SWITCHBOARD_OPERATOR_TOKEN to the relay operator's token");
  const base = acceptedUrl(env.SWITCHBOARD_URL ?? DEFAULT_URL);
  if (base === null)
    return fail(
      'SWITCHBOARD_URL must be https, or http to localhost, 127.0.0.1 or [::1]'
    );

  const [method, path] =
    verb === 'orgs'
      ? ['GET', '/orgs']
      : verb === 'mint'
        ? ['POST', '/orgs']
        : ['POST', `/orgs/${id}/token`];
  let res: Response;
  try {
    res = await fetchFn(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${master}` },
    });
  } catch (err) {
    return fail(
      `could not reach ${base}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    // a non-JSON answer is reported below
  }
  if (!res.ok) {
    const reason = typeof body?.error === 'string' ? body.error : text.trim();
    return fail(`the relay answered ${res.status}: ${reason}`);
  }

  if (verb === 'orgs') {
    if (!Array.isArray(body?.orgs))
      return fail('the relay sent an answer this script does not understand');
    const lines = body.orgs.map(
      (o: any) =>
        `${o.id}  boards=${o.boards}  token=${o.hasToken ? 'yes' : 'no'}${o.legacy ? '  legacy' : ''}`
    );
    return {
      code: 0,
      stdout: lines.length ? `${lines.join('\n')}\n` : 'no orgs\n',
      stderr: '',
    };
  }
  if (typeof body?.id !== 'string' || !ORG_TOKEN_RE.test(String(body?.token)))
    return fail('the relay sent an answer this script does not understand');
  return {
    code: 0,
    stdout: `org ${body.id}\ntoken ${body.token}\n`,
    stderr: '',
  };
}

if (import.meta.main) {
  const r = await runOperator(process.argv.slice(2), process.env, fetch);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exit(r.code);
}
