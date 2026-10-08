// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `subscribe`, `getSetting`, `paneFocus`, `gateList` and `gateAnswer` must be
// in this factory even though these tests never call them: the websocket
// relay, the settings sub-app, the panes sub-app, and the gates sub-app all
// share `@mattstack/rt-client`, and every named export any of them uses must
// be present here or vitest throws "No `X` export is defined on the mock".
vi.mock('@mattstack/rt-client', () => ({
  agentAdopt: vi.fn(async () => ({ ok: false, error: 'not stubbed' })),
  agentResume: vi.fn(async () => ({ ok: false, error: 'not stubbed' })),
  paneList: vi.fn(async () => ({ ok: true, data: { panes: [] } })),
  listRuns: vi.fn(async () => ({ ok: true, data: { runs: [] } })),
  getRun: vi.fn(async () => ({ ok: false, error: 'no such run' })),
  abandonRun: vi.fn(async () => ({ ok: true, data: { ok: true } })),
  subscribe: vi.fn(() => () => {}),
  getSetting: vi.fn(() => ({ value: 30, provenance: [] })),
  paneFocus: vi.fn(async () => ({
    ok: true,
    data: { paneId: '', focused: true },
  })),
  gateList: vi.fn(async () => ({ ok: true, data: { gates: [], cursor: 0 } })),
  gateAnswer: vi.fn(async () => ({ ok: false, error: 'not-found' })),
  // Real implementation, not a stub: runs.ts's canonicalRepo re-serializes
  // the identity Hono's param() decode corrupted, and the test asserts the
  // exact round-tripped wire form.
  serializeIdentity: (id: { kind: string; id: string }) =>
    `${id.kind}:${encodeURIComponent(id.id)}`,
}));

const { routes } = await import('./routes');
const rt = await import('@mattstack/rt-client');

describe('runs api', () => {
  it('a serialized identity with an internal slash survives the :repo/:runId round trip', async () => {
    const wire = 'remote:gitlab.com%2Fgroup%2Frepo';
    await routes.fetch(new Request(`http://localhost/api/runs/${wire}/run-1`));
    expect(rt.getRun).toHaveBeenCalledWith('run-1', wire);
  });

  it('lists runs and passes repo through', async () => {
    const res = await routes.fetch(
      new Request('http://localhost/api/runs?repo=repo-tools')
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ runs: [] });
    expect(rt.listRuns).toHaveBeenCalledWith('repo-tools');
  });

  it('translates a genuine daemon failure into 502, not a thrown 500', async () => {
    const res = await routes.fetch(
      new Request('http://localhost/api/runs/repo-tools/run-1')
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: 'no such run' });
  });

  // Distinct from the 502 above: "run not found" is the daemon's exact,
  // literal string for a missing id (lib/daemon/handlers/runs.ts), never a
  // caught-exception message -- this is the one ok:false shape that means
  // "not there", not "upstream broke".
  it('translates a missing run into 404, not 502', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce({
      ok: false,
      error: 'run not found',
    });

    const res = await routes.fetch(
      new Request('http://localhost/api/runs/repo-tools/does-not-exist')
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'run not found' });
  });

  it('abandons a run with the reason from the body', async () => {
    const res = await routes.fetch(
      new Request('http://localhost/api/runs/repo-tools/run-1/abandon', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'wedged overnight' }),
      })
    );

    expect(res.status).toBe(200);
    expect(rt.abandonRun).toHaveBeenCalledWith(
      'run-1',
      'repo-tools',
      'wedged overnight'
    );
  });

  it('renders a DOWNED daemon as JSON 502, not a thrown 500', async () => {
    // rt-client cannot throw: rtCommand wraps its fetch in try/catch and
    // returns { ok: false, error: 'rt daemon unreachable at <sock>: ...' } for
    // connection-refused exactly as for a refusal (MAT-392). A stopped daemon
    // therefore lands in the SAME ok:false/502 branch as a refusal, not in
    // the server's onError floor. Do not mockRejectedValue against rt-client
    // -- that is a rejection the real client never produces.
    vi.mocked(rt.listRuns).mockResolvedValueOnce({
      ok: false,
      error:
        'rt daemon unreachable at /Users/x/.mattstack/rt/rt.sock: ECONNREFUSED',
    });

    const res = await routes.fetch(new Request('http://localhost/api/runs'));

    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('rt daemon unreachable'),
    });
  });

  it('survives a POST with no body at all', async () => {
    // An ABSENT body: the validator sees `undefined` and still returns a
    // valid `{ reason: undefined }`, so the handler runs. A MALFORMED body is
    // deliberately different -- 400, handler skipped.
    const res = await routes.fetch(
      new Request('http://localhost/api/runs/repo-tools/run-2/abandon', {
        method: 'POST',
      })
    );

    expect(res.status).toBe(200);
    expect(rt.abandonRun).toHaveBeenCalledWith(
      'run-2',
      'repo-tools',
      undefined
    );
  });
});

describe('runs api artifact route', () => {
  const originalRoot = process.env.RT_RUNS_ROOT;
  let runsRoot: string;

  beforeEach(() => {
    runsRoot = mkdtempSync(join(tmpdir(), 'console-runs-root-'));
    process.env.RT_RUNS_ROOT = runsRoot;
    mkdirSync(join(runsRoot, 'repo-tools', 'run-1'), { recursive: true });
    writeFileSync(
      join(runsRoot, 'repo-tools', 'run-1', 'detail.log'),
      'boom\ntrace line'
    );
  });

  afterEach(() => {
    process.env.RT_RUNS_ROOT = originalRoot;
  });

  it('reads an artifact under the run directory it derives from repo/runId', async () => {
    const res = await routes.fetch(
      new Request(
        'http://localhost/api/runs/repo-tools/run-1/artifact?path=' +
          encodeURIComponent(
            join(runsRoot, 'repo-tools', 'run-1', 'detail.log')
          )
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      lines: ['boom', 'trace line'],
      truncated: false,
    });
  });

  // Proves the route wires readExcerpt's own root, not just the caller's
  // path: a sibling run's file passes the traversal guard's string check
  // only if the guard is bypassed entirely, so this fails if the route ever
  // stopped scoping `root` to repo/runId.
  it('refuses an artifact path from a different run as 403, not 200', async () => {
    mkdirSync(join(runsRoot, 'repo-tools', 'run-2'), { recursive: true });
    const otherRunFile = join(runsRoot, 'repo-tools', 'run-2', 'secret.log');
    writeFileSync(otherRunFile, 'not yours');

    const res = await routes.fetch(
      new Request(
        'http://localhost/api/runs/repo-tools/run-1/artifact?path=' +
          encodeURIComponent(otherRunFile)
      )
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/outside/i),
    });
  });

  it('requires a path query param', async () => {
    const res = await routes.fetch(
      new Request('http://localhost/api/runs/repo-tools/run-1/artifact')
    );

    expect(res.status).toBe(400);
  });

  it('reads an artifact under the recorded worktree, not just the run directory', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'console-worktree-'));
    const detailPath = join(worktree, 'triage.md');
    writeFileSync(detailPath, 'triage notes');
    vi.mocked(rt.getRun).mockResolvedValueOnce({
      ok: true,
      data: {
        run: {} as never,
        stages: [],
        fields: [
          { key: 'worktree', value: worktree, produced_by: 'provision', at: 0 },
        ],
        decisions: [],
        schemaAhead: false,
      },
    });

    const res = await routes.fetch(
      new Request(
        'http://localhost/api/runs/repo-tools/run-1/artifact?path=' +
          encodeURIComponent(detailPath)
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      lines: ['triage notes'],
      truncated: false,
    });
  });

  it('still refuses an unrelated absolute path once the worktree root is allowed', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'console-worktree-'));
    const elsewhere = mkdtempSync(join(tmpdir(), 'console-elsewhere-'));
    const strayPath = join(elsewhere, 'secret.log');
    writeFileSync(strayPath, 'not yours');
    vi.mocked(rt.getRun).mockResolvedValueOnce({
      ok: true,
      data: {
        run: {} as never,
        stages: [],
        fields: [
          { key: 'worktree', value: worktree, produced_by: 'provision', at: 0 },
        ],
        decisions: [],
        schemaAhead: false,
      },
    });

    const res = await routes.fetch(
      new Request(
        'http://localhost/api/runs/repo-tools/run-1/artifact?path=' +
          encodeURIComponent(strayPath)
      )
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/outside/i),
    });
  });
});

describe('POST /api/runs/:repo/:runId/resume', () => {
  const field = (key: string, value: string) => ({
    key,
    value,
    produced_by: 'run',
    at: 1,
  });
  const detail = (
    over: {
      status?: string;
      agent?: unknown;
      fields?: ReturnType<typeof field>[];
    } = {}
  ) => ({
    ok: true as const,
    data: {
      run: {
        id: 'run-1',
        repo: 'demo',
        status: over.status ?? 'running',
        agent: over.agent ?? null,
      },
      stages: [],
      decisions: [],
      schemaAhead: false,
      fields: over.fields ?? [
        field('claude-session', 'sess-1'),
        field('worktree', '/wt/ron'),
        field('hold', 'held until the rollout soaks'),
        field('agent', 'ag-1'),
      ],
    },
  });
  const post = () =>
    routes.fetch(
      new Request('http://localhost/api/runs/demo/run-1/resume', {
        method: 'POST',
      })
    );

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resumes the recorded agent with a prompt naming the run, worktree and hold', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail() as never);
    vi.mocked(rt.agentResume).mockResolvedValueOnce({
      ok: true,
      data: { id: 'ag-1' },
    } as never);
    const res = await post();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      resumed: true,
      agentId: 'ag-1',
    });
    expect(rt.agentAdopt).not.toHaveBeenCalled();
    expect(rt.agentResume).toHaveBeenCalledWith({
      id: 'ag-1',
      prompt:
        'Run `run-1` is no longer held (held until the rollout soaks). Re-enter the worktree `/wt/ron` and pick the run back up.',
    });
  });

  it('adopts the session when the run predates agent registration', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(
      detail({
        fields: [
          field('claude-session', 'sess-1'),
          field('worktree', '/wt/ron'),
          field('ticket', 'ABC-1'),
        ],
      }) as never
    );
    vi.mocked(rt.agentAdopt).mockResolvedValueOnce({
      ok: true,
      data: { id: 'ag-9' },
    } as never);
    vi.mocked(rt.agentResume).mockResolvedValueOnce({
      ok: true,
      data: { id: 'ag-9' },
    } as never);
    const res = await post();
    expect(res.status).toBe(200);
    expect(rt.agentAdopt).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      repo: 'demo',
      subject: 'run:run-1',
      label: 'ABC-1',
    });
    expect(vi.mocked(rt.agentResume).mock.calls.at(-1)?.[0]).toEqual({
      id: 'ag-9',
      prompt:
        'Run `run-1` is no longer held. Re-enter the worktree `/wt/ron` and pick the run back up.',
    });
  });

  it('404 when the run recorded no session', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail({ fields: [] }) as never);
    expect((await post()).status).toBe(404);
  });

  it('409 when the run has finished', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(
      detail({ status: 'done' }) as never
    );
    expect((await post()).status).toBe(409);
  });

  it('409 when a live agent already has a pane', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(
      detail({ agent: { status: 'idle', pane: 'w1:p1' } }) as never
    );
    expect((await post()).status).toBe(409);
  });

  it('409 when a pane still exists after its turn finished', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(
      detail({ agent: { status: 'done', pane: 'w1:p1' } }) as never
    );
    expect((await post()).status).toBe(409);
  });

  const pane = (over: { sessionId?: string; cwd?: string }) => ({
    paneId: 'w1:p2',
    workspace: 'w1',
    agentStatus: 'idle',
    ...over,
  });

  it('409 when a fresh pane read finds the session the cached mirror missed', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail() as never);
    vi.mocked(rt.paneList).mockResolvedValueOnce({
      ok: true,
      data: { panes: [pane({ sessionId: 'sess-1', cwd: '/elsewhere' })] },
    } as never);
    const res = await post();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'this run already has a live pane',
    });
    expect(rt.agentResume).not.toHaveBeenCalled();
    expect(rt.agentAdopt).not.toHaveBeenCalled();
  });

  it('409 when a fresh pane read finds a pane inside the run worktree', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail() as never);
    vi.mocked(rt.paneList).mockResolvedValueOnce({
      ok: true,
      data: { panes: [pane({ cwd: '/wt/ron/apps/console' })] },
    } as never);
    expect((await post()).status).toBe(409);
    expect(rt.agentResume).not.toHaveBeenCalled();
  });

  it('an agent pane in the worktree whose status reads unknown still gets 409', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail() as never);
    vi.mocked(rt.paneList).mockResolvedValueOnce({
      ok: true,
      data: {
        panes: [{ ...pane({ cwd: '/wt/ron' }), agentStatus: 'unknown' }],
      },
    } as never);
    expect((await post()).status).toBe(409);
    expect(rt.agentResume).not.toHaveBeenCalled();
  });

  it('a pane in a sibling folder that shares the worktree prefix does not block', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail() as never);
    vi.mocked(rt.paneList).mockResolvedValueOnce({
      ok: true,
      data: { panes: [pane({ sessionId: 'sess-other', cwd: '/wt/ronald' })] },
    } as never);
    vi.mocked(rt.agentResume).mockResolvedValueOnce({
      ok: true,
      data: { id: 'ag-1' },
    } as never);
    expect((await post()).status).toBe(200);
  });

  it('refuses without launching when the pane read fails', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail() as never);
    vi.mocked(rt.paneList).mockResolvedValueOnce({
      ok: false,
      error: 'herdr unavailable',
    } as never);
    const res = await post();
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/live pane/),
    });
    expect(rt.agentResume).not.toHaveBeenCalled();
    expect(rt.agentAdopt).not.toHaveBeenCalled();
  });

  it('resumes when the fresh pane read finds nothing for this run', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail() as never);
    vi.mocked(rt.paneList).mockResolvedValueOnce({
      ok: true,
      data: { panes: [] },
    } as never);
    vi.mocked(rt.agentResume).mockResolvedValueOnce({
      ok: true,
      data: { id: 'ag-1' },
    } as never);
    expect((await post()).status).toBe(200);
    expect(rt.paneList).toHaveBeenCalledTimes(1);
  });

  it('adopts afresh and retries once when the recorded agent record was pruned', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail() as never);
    vi.mocked(rt.agentResume)
      .mockResolvedValueOnce({
        ok: false,
        error: 'no agent record for "ag-1"',
      } as never)
      .mockResolvedValueOnce({ ok: true, data: { id: 'ag-9' } } as never);
    vi.mocked(rt.agentAdopt).mockResolvedValueOnce({
      ok: true,
      data: { id: 'ag-9' },
    } as never);
    const res = await post();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      resumed: true,
      agentId: 'ag-9',
    });
    expect(rt.agentAdopt).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      repo: 'demo',
      subject: 'run:run-1',
      label: 'run-1',
    });
    expect(vi.mocked(rt.agentResume).mock.calls.at(-1)?.[0]).toMatchObject({
      id: 'ag-9',
    });
  });

  it('502 with the daemon message when adopt or resume fails', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail() as never);
    vi.mocked(rt.agentResume).mockResolvedValueOnce({
      ok: false,
      error: 'herdr unavailable',
    } as never);
    const res = await post();
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'herdr unavailable' });
  });
});
