import {
  isLocalRequest,
  type LocalServer,
} from '@mattstack/app-server/local-request';
import {
  getSetting,
  parseIdentity,
  rtCommand,
  supportEnable,
} from '@mattstack/rt-client';
import {
  settingsHandler,
  type SettingsHandlerOptions,
} from '@mattstack/settings-kit/server';
import { Hono } from 'hono';

import { rolesInfo } from './boxscore-roles';
import { fixtureMode } from './fixtures/design/fixtureRt';
import { FIXTURE_READ_ONLY } from './fixtures/design/runsFixture';
import { sharedRead } from './sharedRead';
import { suggestValues } from './suggest';

const REPOS_TTL_MS = 5 * 60_000;

/** Settings sections key on the raw `host/path` form, so only remote
    identities can name one; a path-only repo has no section to write. */
export function settingsRepoKeys(registered: readonly string[]): string[] {
  const out: string[] = [];
  for (const wire of registered) {
    const identity = parseIdentity(wire);
    if (identity?.kind === 'remote') out.push(identity.id);
  }
  return out;
}

/** The repos rt has registered, offered by the settings repo picker beside
    the ones some store already has a section for. */
function registeredRepos(): () => Promise<string[]> {
  const read = sharedRead(() => rtCommand('repos', {}), REPOS_TTL_MS);
  return async () => {
    const res = await read('');
    if (!res.ok) return [];
    const repos = (res.data as { repos?: Record<string, unknown> }).repos;
    return settingsRepoKeys(Object.keys(repos ?? {}));
  };
}

export interface SettingsDeps {
  enableSupport: (
    payload: Parameters<typeof supportEnable>[0]
  ) => ReturnType<typeof supportEnable>;
}

/** The org's support switch going on, as settings-kit would accept it. */
async function turnsSupportOn(req: Request): Promise<boolean> {
  if (req.method !== 'POST') return false;
  const type = req.headers.get('content-type')?.split(';', 1)[0];
  if (type?.trim().toLowerCase() !== 'application/json') return false;
  const body = (await req
    .clone()
    .json()
    .catch(() => null)) as Record<string, unknown> | null;
  return (
    body?.key === 'support.enabled' &&
    body.scope === 'org' &&
    body.value === true
  );
}

/**
 * Console's typed reads and suggestion lists, then settings-kit for defs/explain/set/unset.
 * The typed routes must be registered first: Hono matches in order, and the
 * catch-all would otherwise answer them with a 404.
 */
export function createSettingsRoutes(
  kit: Omit<SettingsHandlerOptions, 'allowWrite'> = {},
  deps: SettingsDeps = { enableSupport: payload => supportEnable(payload) }
) {
  const listRepos = registeredRepos();
  return (
    new Hono()
      .get('/api/settings/runs-prune-days', c => {
        const { value } = getSetting<number>('rt.runsPruneDays');
        return c.json({ days: value }, 200);
      })
      /** The suite-wide editor id (rt.workspacePrefs.defaultEditor, shared with
          `rt code`), for building open-in-editor hrefs. A resolver throw (an
          unexpandable ${...} in some other pref field) degrades to null, the
          same "no preference" the client falls back from. */
      .get('/api/settings/default-editor', c => {
        let editor: string | null;
        try {
          const { value } = getSetting<{ defaultEditor?: unknown } | undefined>(
            'rt.workspacePrefs'
          );
          // The registry validates rt.workspacePrefs only as a top-level object,
          // so a non-string defaultEditor can be stored; forward only strings.
          editor =
            typeof value?.defaultEditor === 'string'
              ? value.defaultEditor
              : null;
        } catch {
          editor = null;
        }
        return c.json({ editor }, 200);
      })
      /** The Linear workspace slug, so the client can build an issue url for a
          ticket the branch cache never enriched. Team-scoped and nested, so it
          is read off the integrations object rather than given its own key. */
      .get('/api/settings/linear-workspace', c => {
        const { value } = getSetting<{ linear?: { workspace?: string } }>(
          'mattstack.integrations'
        );
        return c.json({ workspace: value?.linear?.workspace ?? null }, 200);
      })
      /** The roster and whether this Mac may set boxscore.roles (owner only). */
      .get('/api/settings/boxscore-roles', async c =>
        c.json(await rolesInfo(), 200)
      )
      /** A named suggestion list a form field asks for with `suggest`;
          `values: null` when its source has nothing to say yet. */
      .get('/api/settings/suggest/:source', async c => {
        const values = await suggestValues(c.req.param('source'));
        if (values === undefined)
          return c.json({ error: 'unknown suggestion list' }, 404);
        return c.json({ values }, 200);
      })
      /** Support is on only once the org has a key, which the daemon makes.
          What it refuses leaves the switch off with its reason. */
      .post('/api/settings/set', async (c, next) => {
        const local = isLocalRequest(
          c.req.raw,
          c.env as LocalServer | undefined
        );
        if (local && (await turnsSupportOn(c.req.raw))) {
          const res = await deps.enableSupport({ on: true });
          if (!res.ok) {
            const said = res.failure?.code.startsWith('support-')
              ? res.failure.message
              : 'rt did not answer, so support is still off. Try again.';
            return c.json({ error: said }, 400);
          }
        }
        await next();
      })
      .all('/api/settings/*', async c => {
        // Under Bun.serve, Hono's `c.env` is the Bun server, which lets the
        // locality gate check the socket peer, not just the forgeable Host.
        const res = await settingsHandler(c.req.raw, {
          allowComposite: 'shaped',
          ...kit,
          rt: { listRepos, ...kit.rt },
          allowWrite: req =>
            isLocalRequest(req, c.env as LocalServer | undefined),
        });
        return res ?? c.json({ error: 'not found' }, 404);
      })
  );
}

export const settings = createSettingsRoutes(
  {},
  fixtureMode(process.env)
    ? {
        enableSupport: async () => ({
          ok: false,
          error: FIXTURE_READ_ONLY,
          failure: { code: 'support-fixture', message: FIXTURE_READ_ONLY },
        }),
      }
    : undefined
);
