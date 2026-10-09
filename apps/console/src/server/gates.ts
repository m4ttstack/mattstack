import {
  isLocalRequest,
  type LocalServer,
} from '@mattstack/app-server/local-request';
import { panesForOrigin, resolveOriginFocus } from '@mattstack/gate-kit/server';
import {
  gateAnswer,
  gateList,
  listRuns,
  paneFocus,
  paneList,
  type GateAnswer,
  type GateRow,
  type RtResponse,
  type RunSummary,
} from '@mattstack/rt-client';
import { Hono } from 'hono';
import { validator } from 'hono/validator';

import { runIdOfGate } from '../shared/gate-run';
import { countsForConsoleBadge } from '../shared/gate-waiting';
import {
  FIXTURE_READ_ONLY,
  type RunsFixture,
} from './fixtures/design/runsFixture';

/** Read fresh per call, not cached at module scope -- this is the shared
    test seam across every rt-client call site in this file (panes.ts uses
    the same pattern), and a cached snapshot would miss a test that sets it
    after import. */
function rtClientOptions(): { sockPath: string | undefined } {
  return { sockPath: process.env.RT_SOCK_PATH };
}

/** The daemon's cursor is a resume position, not a done-signal -- it stays
    non-zero on the last page too, so a falsy check would loop forever.
    A short page (fewer rows than the limit) or a repeated cursor (no
    forward progress) are the only reliable stop conditions. */
const GATE_LIST_PAGE_LIMIT = 200;

interface GateScope {
  subject?: string;
  run?: string;
  linked?: boolean;
}

/** `run` and `linked` reach gates on `mr:` subjects, so neither is paired
    with a `run:` prefix. A daemon older than those filters ignores the key
    and returns every gate, so the rows are narrowed here too. */
export async function listAllRunGates(
  scope: GateScope = {}
): Promise<{ ok: true; gates: GateRow[] } | { ok: false; error: string }> {
  const gates: GateRow[] = [];
  let cursor: number | undefined;
  // A daemon older than the subject filter ignores the unknown key, so the
  // prefix rides along to keep it from returning every gate in the estate.
  const filter = scope.run
    ? { run: scope.run }
    : scope.linked
      ? { linked: true }
      : scope.subject
        ? { subject: scope.subject, subjectPrefix: 'run:' }
        : { subjectPrefix: 'run:' };
  for (;;) {
    const res = await gateList(
      {
        ...filter,
        limit: GATE_LIST_PAGE_LIMIT,
        cursor,
      },
      rtClientOptions()
    );
    if (!res.ok || !res.data) {
      return {
        ok: false,
        error: res.error ?? 'gate:list failed with no error detail',
      };
    }
    gates.push(...res.data.gates);
    if (
      res.data.gates.length < GATE_LIST_PAGE_LIMIT ||
      res.data.cursor === cursor
    )
      break;
    cursor = res.data.cursor;
  }
  if (scope.run) {
    return { ok: true, gates: gates.filter(g => runIdOfGate(g) === scope.run) };
  }
  if (scope.linked) {
    return { ok: true, gates: gates.filter(g => runIdOfGate(g) !== null) };
  }
  return { ok: true, gates };
}

/** Exact equality, not a substring/regex test: a strict-membership rejection
    can legitimately echo an option value like "closed"
    (e.g. an invalid answer naming a "closed" option), which a substring
    match would misroute to 404. */
function isMissingGateError(message: string): boolean {
  return message === 'not-found' || message === 'closed';
}

/** The rt-client transport's own error-shape prefix (rtCommand's catch) for
    a failed socket connection -- distinct from a daemon-issued validation
    rejection, which never carries this text. */
const UNREACHABLE_PREFIX = 'rt daemon unreachable';

function isUnreachableError(message: string): boolean {
  return message.startsWith(UNREACHABLE_PREFIX);
}

/** With a design `fixture` (`CONSOLE_FIXTURE=design`) the reads answer from
    it, with its clock as `asOf` and as the badge's now, and the writes are
    refused. */
export function gatesRoutes(fixture: RunsFixture | null = null) {
  const allGates = async (
    scope: GateScope = {}
  ): ReturnType<typeof listAllRunGates> =>
    fixture
      ? { ok: true, gates: await fixture.gates(scope) }
      : listAllRunGates(scope);
  const allRuns = async (): Promise<RtResponse<{ runs: RunSummary[] }>> =>
    fixture
      ? { ok: true, data: { runs: await fixture.listRuns() } }
      : listRuns(undefined, rtClientOptions());

  return (
    new Hono()
      // A `query` validator is required: without one Hono infers the client
      // input as empty and a caller passing `query` fails to compile.
      .get(
        '/api/gates',
        validator('query', (value): GateScope => {
          const v = value as {
            subject?: unknown;
            run?: unknown;
            linked?: unknown;
          };
          return {
            subject:
              typeof v?.subject === 'string' && v.subject.startsWith('run:')
                ? v.subject
                : undefined,
            run: typeof v?.run === 'string' && v.run ? v.run : undefined,
            linked: v?.linked === '1' ? true : undefined,
          };
        }),
        async c => {
          const scope = c.req.valid('query');
          const res = await allGates(scope);
          if (!res.ok) return c.json({ error: res.error }, 502);
          if (fixture) {
            return c.json(
              { gates: res.gates, asOf: await fixture.asOf(scope.run) },
              200
            );
          }
          return c.json({ gates: res.gates }, 200);
        }
      )
      .get('/api/badge', async c => {
        const [gatesRes, runsRes] = await Promise.all([allGates(), allRuns()]);
        if (!gatesRes.ok) return c.json({ error: gatesRes.error }, 502);
        if (!runsRes.ok)
          return c.json({ error: runsRes.error ?? 'run:list failed' }, 502);
        const repoByRun = new Map(
          (runsRes.data?.runs ?? []).map(r => [r.id, r.repo])
        );
        const now = fixture ? await fixture.asOf() : Date.now();
        const counted = gatesRes.gates
          .filter(
            g =>
              countsForConsoleBadge(g, now) &&
              repoByRun.has(g.subject.slice('run:'.length))
          )
          .sort((a, b) => a.openedAt - b.openedAt);
        const oldest = counted[0];
        if (!oldest) return c.json({ count: 0 }, 200);
        const runId = oldest.subject.slice('run:'.length);
        return c.json(
          {
            count: counted.length,
            path: `/runs/${repoByRun.get(runId)}/${runId}`,
            ids: counted.map(g => g.id),
          },
          200
        );
      })
      .post(
        '/api/gates/:id/answer',
        validator('json', (value): { answers: unknown } => {
          const v = value as { answers?: unknown };
          return { answers: v?.answers };
        }),
        async c => {
          if (fixture) return c.json({ error: FIXTURE_READ_ONLY }, 409);
          if (!isLocalRequest(c.req.raw, c.env as LocalServer | undefined)) {
            return c.json({ error: 'forbidden' }, 403);
          }
          const { id } = c.req.param();
          const { answers } = c.req.valid('json');
          if (!answers || typeof answers !== 'object') {
            return c.json({ error: 'answers is required' }, 400);
          }

          let res: Awaited<ReturnType<typeof gateAnswer>>;
          try {
            res = await gateAnswer(
              {
                id,
                answers: answers as GateAnswer['answers'],
                by: 'console',
                // A human surface: the daemon's owner guard refuses a herd-owned
                // gate unless the answer is marked as a human override.
                override: true,
              },
              rtClientOptions()
            );
          } catch (err) {
            return c.json(
              { error: err instanceof Error ? err.message : String(err) },
              502
            );
          }

          if (!res.ok || !res.data) {
            const message =
              res.error ?? 'gate:answer failed with no error detail';
            if (isMissingGateError(message))
              return c.json({ error: message }, 404);
            if (isUnreachableError(message))
              return c.json({ error: message }, 502);
            return c.json({ error: message }, 400);
          }

          if (res.data.conflict) return c.json({ row: res.data.row }, 409);
          return c.json({ row: res.data.row }, 200);
        }
      )
      .post('/api/gates/:id/focus', async c => {
        if (fixture) return c.json({ error: FIXTURE_READ_ONLY }, 409);
        const { id } = c.req.param();
        const all = await listAllRunGates();
        if (!all.ok) return c.json({ error: all.error }, 502);
        const row = all.gates.find(g => g.id === id);
        if (!row) return c.json({ error: 'not-found' }, 404);
        const { panes, fetchFailed } = await panesForOrigin(
          row.origin ?? undefined,
          () => paneList(rtClientOptions())
        );
        const resolved = resolveOriginFocus(row.origin ?? undefined, panes, {
          panesUnavailable: fetchFailed,
        });
        if (!resolved.ok) return c.json({ error: resolved.reason }, 400);
        const focusRes = await paneFocus(
          { paneId: resolved.paneId },
          rtClientOptions()
        );
        if (!focusRes.ok) return c.json({ error: focusRes.error }, 502);
        return c.json({ focused: true }, 200);
      })
      .get('/api/gates/:id/locate', async c => {
        const { id } = c.req.param();
        const all = await allGates();
        if (!all.ok) return c.json({ error: all.error }, 502);
        const row = all.gates.find(g => g.id === id);
        if (!row) return c.json({ error: 'not-found' }, 404);
        // listAllRunGates already scoped the list to subjectPrefix: 'run:' -- this
        // re-check guards the daemon contract rather than filtering anything here.
        if (!row.subject.startsWith('run:')) {
          return c.json({ error: 'gate is not a run gate' }, 404);
        }
        const runId = row.subject.slice('run:'.length);

        // No repo in hand yet -- the gate names only the run id, so every repo's
        // runs must be searched, same as GET /api/runs does with no `repo` query.
        const runsRes = await allRuns();
        if (!runsRes.ok) return c.json({ error: runsRes.error }, 502);
        const run = runsRes.data?.runs.find(r => r.id === runId);
        if (!run) return c.json({ error: 'run not found' }, 404);
        return c.json({ repo: run.repo, runId: run.id }, 200);
      })
  );
}

export const gates = gatesRoutes();
