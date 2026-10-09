import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  abandonRun,
  agentAdopt,
  agentResume,
  getRun,
  listRuns,
  paneList,
  runEvidence,
  serializeIdentity,
  type ChatPane,
  type EvidenceImageKey,
  type EvidenceTextKey,
  type RunFieldRow,
} from '@mattstack/rt-client';
import { Hono } from 'hono';
import { validator } from 'hono/validator';

import { readExcerpt } from './artifact';
import { boardLinkResolver, liveBoardLinkDeps } from './boardLink';
import {
  FIXTURE_READ_ONLY,
  type RunsFixture,
} from './fixtures/design/runsFixture';
import { listAllRunGates } from './gates';
import { markSeen, readSeen } from './seen';

/** Hono's c.req.param() always URI-decodes a captured segment; a repo
    identity is itself percent-encoded (its internal slash is %2F), so that
    decode restores a literal slash the daemon's isPathComponent() guard
    rejects outright. Re-serialize before using repo for anything.
    parseIdentity can't do it: it is strict-canonical and rejects the decoded
    slash-bearing form on purpose. Legacy bare names pass through unchanged. */
function canonicalRepo(raw: string): string {
  const m = /^(remote|path):(.*)$/.exec(raw);
  return m
    ? serializeIdentity({ kind: m[1] as 'remote' | 'path', id: m[2]! })
    : raw;
}

function cwdInside(cwd: string, worktree: string): boolean {
  const root = worktree.endsWith('/') ? worktree : `${worktree}/`;
  return cwd === worktree || cwd.startsWith(root);
}

/** Matches the way the daemon's liveness mirror attributes a pane to a run:
    by the recorded Claude session, else by a cwd inside the run's worktree.
    pane:list returns only panes herdr runs Claude in, so a plain shell never
    matches; an agent whose status reads `unknown` still does, as in liveness. */
function runHasPane(
  panes: ChatPane[],
  session: string,
  worktree: string | undefined
): boolean {
  return panes.some(
    p =>
      p.sessionId === session ||
      (worktree !== undefined &&
        p.cwd !== undefined &&
        cwdInside(p.cwd, worktree))
  );
}

export function resumePrompt(runId: string, fields: RunFieldRow[]): string {
  const value = (key: string) => fields.find(f => f.key === key)?.value;
  const hold = value('hold');
  const worktree = value('worktree');
  const held = `Run \`${runId}\` is no longer held${hold ? ` (${hold})` : ''}.`;
  const next = worktree
    ? `Re-enter the worktree \`${worktree}\` and pick the run back up.`
    : 'Pick the run back up.';
  return `${held} ${next}`;
}

/**
 * 502 for every `ok: false` from rt-client. The client CANNOT throw: rtCommand
 * wraps its fetch in try/catch and returns `{ ok: false, error }` for a downed
 * daemon (`rt daemon unreachable at <sock>: ...`) exactly as for a refusal
 * (MAT-392). So daemon-down and daemon-refused are indistinguishable by shape
 * and both land here -- app.onError is never reached for this class. To tell a
 * stopped daemon from a refusal, match the `rt daemon unreachable at ` prefix
 * on the error string.
 *
 * With a design `fixture` (`CONSOLE_FIXTURE=design`) every read answers from
 * it, with its clock as `asOf`, every write is refused, and the daemon is
 * never called.
 */
/** The board's address in the design fixture, which has no deck to ask. */
const FIXTURE_BOARD_ORIGIN = 'http://localhost:11006';

export function runsRoutes(fixture: RunsFixture | null = null) {
  const boardLink = boardLinkResolver(
    fixture
      ? {
          boardOrigin: async () => FIXTURE_BOARD_ORIGIN,
          runGates: runId => fixture.gates({ run: runId }),
          now: Date.now,
        }
      : liveBoardLinkDeps(async runId => {
          const res = await listAllRunGates({ run: runId });
          return res.ok ? res.gates : null;
        })
  );
  return (
    new Hono()
      .get('/api/runs', async c => {
        const repo = c.req.query('repo');
        if (fixture) {
          return c.json(
            { runs: await fixture.listRuns(repo), asOf: await fixture.asOf() },
            200
          );
        }
        const res = await listRuns(repo);
        if (!res.ok) return c.json({ error: res.error }, 502);
        return c.json(res.data, 200);
      })
      .get('/api/runs/:repo/:runId', async c => {
        const { repo: rawRepo, runId } = c.req.param();
        const repo = canonicalRepo(rawRepo);
        if (fixture) {
          const detail = await fixture.getRun(repo, runId);
          if (!detail) return c.json({ error: 'run not found' }, 404);
          return c.json(
            {
              ...detail,
              asOf: await fixture.asOf(runId),
              boardUrl: await boardLink(detail.run),
            },
            200
          );
        }
        const res = await getRun(runId, repo);
        if (!res.ok || !res.data) {
          // The daemon's runs:get handler (lib/daemon/handlers/runs.ts) returns
          // this exact string when the run id resolves to nothing -- every other
          // ok:false path there is `String(err)` off a caught exception, never
          // this literal, so the match can't collide with a real upstream error.
          const status: 404 | 502 = res.error === 'run not found' ? 404 : 502;
          return c.json({ error: res.error ?? 'no data' }, status);
        }
        const boardUrl = await boardLink(res.data.run);
        return c.json({ ...res.data, boardUrl }, 200);
      })
      // A `query` validator is required for the same reason the `abandon` POST
      // below needs a `json` one: with path params already in this route,
      // Hono's inferred client input is `{ param }` only, and a caller passing
      // `query` fails to compile despite working at runtime. The root is
      // derived from repo/runId, never trusted from the caller -- only `path`
      // (the file within it) comes off the query string.
      .get(
        '/api/runs/:repo/:runId/artifact',
        validator('query', (value): { path?: string } => {
          const v = value as { path?: unknown };
          return { path: typeof v?.path === 'string' ? v.path : undefined };
        }),
        async c => {
          const { repo: rawRepo, runId } = c.req.param();
          const repo = canonicalRepo(rawRepo);
          const { path } = c.req.valid('query');
          if (!path) return c.json({ error: 'path is required' }, 400);
          if (fixture) {
            try {
              const excerpt = await fixture.artifact(repo, runId, path);
              if (!excerpt) return c.json({ error: 'run not found' }, 404);
              return c.json(excerpt, 200);
            } catch (err) {
              return c.json({ error: (err as Error).message }, 403);
            }
          }

          const runsRoot =
            process.env.RT_RUNS_ROOT ?? join(homedir(), '.mattstack', 'runs');
          const roots = [join(runsRoot, repo, runId)];

          // Stage skills write a triage report into the worktree, not the run
          // directory -- the worktree path comes off the same trusted run row as
          // the run dir itself, never from the caller, so admitting it here
          // doesn't weaken the guard against a caller-supplied path.
          const detail = await getRun(runId, repo);
          if (detail.ok && detail.data) {
            const worktree = detail.data.fields.find(
              f => f.key === 'worktree'
            )?.value;
            if (worktree) roots.push(worktree);
          }

          try {
            return c.json(readExcerpt(path, roots), 200);
          } catch (err) {
            return c.json({ error: (err as Error).message }, 403);
          }
        }
      )
      .get('/api/runs/:repo/:runId/evidence/:key', async c => {
        const { repo: rawRepo, runId, key } = c.req.param();
        if (fixture) {
          const evidence = await fixture.evidence(
            canonicalRepo(rawRepo),
            runId,
            key as EvidenceImageKey | EvidenceTextKey
          );
          if (!evidence) return c.json({ error: 'no evidence' }, 404);
          return new Response(evidence.bytes, {
            status: 200,
            headers: {
              'content-type': evidence.mime.startsWith('text/')
                ? `${evidence.mime}; charset=utf-8`
                : evidence.mime,
              'cache-control': 'private, max-age=3600',
            },
          });
        }
        const res = await runEvidence(
          runId,
          key as EvidenceImageKey | EvidenceTextKey,
          canonicalRepo(rawRepo),
          { sockPath: process.env.RT_SOCK_PATH }
        );
        if (!res.ok || !res.data) {
          return c.json({ error: res.error ?? 'no evidence' }, 404);
        }
        if (res.data.text !== undefined) {
          return new Response(res.data.text, {
            status: 200,
            headers: {
              'content-type': `${res.data.mime}; charset=utf-8`,
              'cache-control': 'private, max-age=3600',
            },
          });
        }
        if (res.data.base64 === undefined) {
          return c.json({ error: 'no evidence' }, 404);
        }
        return new Response(Buffer.from(res.data.base64, 'base64'), {
          status: 200,
          headers: {
            'content-type': res.data.mime,
            'cache-control': 'private, max-age=3600',
          },
        });
      })
      // A validator is required for any route whose body the RPC client sends --
      // without one Hono infers client input as `{ param }` only and a caller
      // passing `json` fails to compile despite working at runtime. An absent
      // body lands `reason` as undefined and the handler still runs; a malformed
      // body raises before the handler and reaches `app.onError` as JSON.
      .post(
        '/api/runs/:repo/:runId/abandon',
        validator('json', (value): { reason?: string } => {
          const v = value as { reason?: unknown };
          return {
            reason: typeof v?.reason === 'string' ? v.reason : undefined,
          };
        }),
        async c => {
          if (fixture) return c.json({ error: FIXTURE_READ_ONLY }, 409);
          const { repo: rawRepo, runId } = c.req.param();
          const repo = canonicalRepo(rawRepo);
          const { reason } = c.req.valid('json');
          const res = await abandonRun(runId, repo, reason);
          if (!res.ok) return c.json({ error: res.error }, 502);
          return c.json(res.data, 200);
        }
      )
      .post('/api/runs/:repo/:runId/resume', async c => {
        if (fixture) return c.json({ error: FIXTURE_READ_ONLY }, 409);
        const { repo: rawRepo, runId } = c.req.param();
        const repo = canonicalRepo(rawRepo);
        const detail = await getRun(runId, repo);
        if (!detail.ok) {
          const status: 404 | 502 =
            detail.error === 'run not found' ? 404 : 502;
          return c.json({ error: detail.error ?? 'run read failed' }, status);
        }
        const { run, fields } = detail.data!;
        const value = (key: string) => fields.find(f => f.key === key)?.value;
        const session = value('claude-session');
        if (!session) {
          return c.json({ error: 'this run recorded no Claude session' }, 404);
        }
        if (run.status !== 'running') {
          return c.json({ error: 'this run has finished' }, 409);
        }
        // run.agent comes from a cached mirror that also reads null when herdr
        // was unreachable, so a launch needs a fresh read that answered.
        const livePane = { error: 'this run already has a live pane' };
        if (run.agent) return c.json(livePane, 409);
        const panes = await paneList();
        if (!panes.ok || !panes.data) {
          return c.json(
            {
              error:
                "couldn't check whether this run already has a live pane, so it wasn't resumed",
            },
            502
          );
        }
        if (runHasPane(panes.data.panes, session, value('worktree'))) {
          return c.json(livePane, 409);
        }
        const prompt = resumePrompt(runId, fields);
        const adopt = async (): Promise<{ id: string } | { error: string }> => {
          const adopted = await agentAdopt({
            sessionId: session,
            repo,
            subject: `run:${runId}`,
            label: value('ticket') ?? runId,
          });
          return adopted.ok && adopted.data
            ? { id: adopted.data.id }
            : { error: adopted.error ?? 'adopt failed' };
        };
        let agentId = value('agent');
        if (!agentId) {
          const adopted = await adopt();
          if (!('id' in adopted)) return c.json({ error: adopted.error }, 502);
          agentId = adopted.id;
        }
        let resumed = await agentResume({ id: agentId, prompt });
        // The daemon prunes agent records after a long absence. This prefix is the
        // message of agent:resume's missing-record refusal in
        // lib/daemon/handlers/agent.ts; no shared constant exists.
        if (!resumed.ok && resumed.error?.startsWith('no agent record for')) {
          const adopted = await adopt();
          if (!('id' in adopted)) return c.json({ error: adopted.error }, 502);
          agentId = adopted.id;
          resumed = await agentResume({ id: agentId, prompt });
        }
        if (!resumed.ok) {
          return c.json({ error: resumed.error ?? 'resume failed' }, 502);
        }
        return c.json({ resumed: true as const, agentId }, 200);
      })
      .get('/api/seen', async c => c.json(fixture ? {} : readSeen(), 200))
      .post('/api/seen/:runId', async c =>
        c.json(fixture ? {} : markSeen(c.req.param('runId')), 200)
      )
  );
}

export const runs = runsRoutes();
