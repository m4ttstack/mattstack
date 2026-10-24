import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import type { AgentLaunchResult } from '../agent-launch.ts';
import type { LaunchPaneOpts } from '../herdr.ts';
import {
  handleQuestionLaunch,
  type QuestionLaunchIo,
  type QuestionMr,
} from '../question-launch.ts';
import type { QuestionPatch, QuestionState } from '../question-state.ts';

const cfg = (
  over: Partial<QuestionLaunchIo['config']> = {}
): QuestionLaunchIo['config'] => ({
  reviewCwd: '',
  questionsWorkspace: 'questions',
  ...over,
});

const MR_URL = 'https://gitlab.com/acme/webapp/-/merge_requests/812';
const REPORT = JSON.stringify({
  findings: [
    {
      id: 'f2',
      tier: 'Important',
      title: 't',
      body: 'b',
      comment: 'c',
    },
    { id: 'f 1', tier: 'Minor', title: 't', body: 'b', comment: 'c' },
  ],
});
const LAUNCHED: AgentLaunchResult = {
  agentId: 'agent-1',
  sessionId: 'sess-1',
  paneId: 'pane-1',
  tabId: 'tab-1',
  workspaceId: 'ws-1',
  focusedExisting: false,
};

interface Fake {
  io: QuestionLaunchIo;
  writes: QuestionPatch[];
  launches: Array<Parameters<QuestionLaunchIo['launch']>[0]>;
  focused: Array<{ paneId?: string; tabId?: string }>;
  settle: () => Promise<void>;
}

/** A fake io over one in-memory question row. The launch answers on demand
    (`release`), so a test can read what the route had written by the time it
    returned, before the pane came up. */
function fake(
  over: Partial<QuestionLaunchIo> & {
    existing?: QuestionState;
    author?: QuestionMr['author'];
    launch?: QuestionLaunchIo['launch'];
  } = {}
): Fake {
  const writes: QuestionPatch[] = [];
  const launches: Fake['launches'] = [];
  const focused: Fake['focused'] = [];
  const { existing, author, launch, ...rest } = over;
  const io: QuestionLaunchIo = {
    findMr: async url =>
      url === MR_URL
        ? {
            iid: 812,
            author: author ?? { username: 'joel', name: 'Joel' },
            rtRepo: null,
          }
        : undefined,
    readReportJson: () => REPORT,
    reportJsonPath: () => '/state/review/x.json',
    config: cfg({ reviewCwd: '/repo/acme' }),
    readQuestion: () => existing,
    writeQuestion: (_mr, _id, patch) => {
      writes.push(patch);
    },
    launch:
      launch ??
      (async opts => {
        launches.push(opts);
        return LAUNCHED;
      }),
    focusPane: async pane => {
      focused.push(pane);
      return { focused: true };
    },
    resolveRepo: () => 'remote:gitlab.com%2Facme%2Fwebapp',
    agentSettings: () => ({ account: 'a@b.c', model: 'opus' }),
    pack: tab => (tab ? `pack-${tab}` : undefined),
    ...rest,
  };
  return {
    io,
    writes,
    launches,
    focused,
    // The route does not await the launch, so a test lets it finish by
    // yielding to the event loop.
    settle: () => new Promise(r => setTimeout(r, 0)),
  };
}

const BODY = { mrUrl: MR_URL, iid: 812, gateId: 'g1', findingId: 'f2' };

describe('handleQuestionLaunch', () => {
  // The route logs launch and focus failures; the tests that cause them
  // read the row, not the log.
  let errorLog: ReturnType<typeof spyOn>;
  beforeEach(() => {
    errorLog = spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorLog.mockRestore());

  test.each([
    ['null', null],
    ['no gateId', { mrUrl: MR_URL, iid: 812, findingId: 'f2' }],
    ['a non-number iid', { ...BODY, iid: '812' }],
    ['an empty findingId', { ...BODY, findingId: '' }],
    ['a non-string mrUrl', { ...BODY, mrUrl: 5 }],
  ])('rejects a body with %s', async (_name, body) => {
    const f = fake();
    expect(await handleQuestionLaunch(body, f.io)).toEqual({
      status: 400,
      body: 'expected { mrUrl, iid, gateId, findingId }',
    });
    expect(f.writes).toEqual([]);
  });

  test('an unknown MR is a 400', async () => {
    const f = fake();
    const res = await handleQuestionLaunch(
      { ...BODY, mrUrl: 'https://gitlab.com/other/-/merge_requests/1' },
      f.io
    );
    expect(res.status).toBe(400);
    expect(f.writes).toEqual([]);
  });

  test('an iid that does not match the MR is a 400', async () => {
    const f = fake();
    const res = await handleQuestionLaunch({ ...BODY, iid: 9 }, f.io);
    expect(res.status).toBe(400);
    expect(f.writes).toEqual([]);
  });

  test('no reviewCwd is a 400', async () => {
    const f = fake({ config: cfg({}) });
    expect(await handleQuestionLaunch(BODY, f.io)).toEqual({
      status: 400,
      body: 'reviewCwd not configured',
    });
    expect(f.writes).toEqual([]);
  });

  test('no report json is a 409', async () => {
    const f = fake({ readReportJson: () => null });
    expect(await handleQuestionLaunch(BODY, f.io)).toEqual({
      status: 409,
      body: 'this review has no findings report to ask about',
    });
    expect(f.writes).toEqual([]);
  });

  test.each([
    ['unparseable json', '{nope'],
    ['no findings array', JSON.stringify({ findings: 'x' })],
    ['a report without that finding id', JSON.stringify({ findings: [] })],
  ])('%s is a 409', async (_name, json) => {
    const f = fake({ readReportJson: () => json });
    const res = await handleQuestionLaunch(BODY, f.io);
    expect(res.status).toBe(409);
    expect(f.writes).toEqual([]);
  });

  test('a live question with a tab is focused, not relaunched', async () => {
    const f = fake({
      existing: {
        mrUrl: MR_URL,
        iid: 812,
        findingId: 'f2',
        gateId: 'g1',
        status: 'live',
        paneId: 'p9',
        tabId: 't9',
      },
    });
    expect(await handleQuestionLaunch(BODY, f.io)).toEqual({
      status: 200,
      body: { ok: true, focused: true },
    });
    expect(f.focused).toEqual([
      expect.objectContaining({ paneId: 'p9', tabId: 't9' }),
    ]);
    expect(f.launches).toEqual([]);
    expect(f.writes).toEqual([]);
  });

  test('a focus click with nothing live is a 409', async () => {
    const f = fake();
    const res = await handleQuestionLaunch({ ...BODY, focus: true }, f.io);
    expect(res.status).toBe(409);
    expect(f.launches).toEqual([]);
    expect(f.writes).toEqual([]);
  });

  test('a done question launches fresh', async () => {
    const f = fake({
      existing: {
        mrUrl: MR_URL,
        iid: 812,
        findingId: 'f2',
        gateId: 'g1',
        status: 'done',
        paneId: 'p9',
        tabId: 't9',
      },
    });
    expect(await handleQuestionLaunch(BODY, f.io)).toEqual({
      status: 200,
      body: { ok: true },
    });
    await f.settle();
    expect(f.launches).toHaveLength(1);
  });

  test('queues the row, returns before the launch resolves, then records the live pane and brings it forward', async () => {
    let release!: (r: AgentLaunchResult) => void;
    const f = fake({
      launch: () => new Promise<AgentLaunchResult>(r => (release = r)),
    });
    const res = await handleQuestionLaunch(
      { ...BODY, boardTabId: 'mine' },
      f.io
    );
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(f.writes).toEqual([{ status: 'queued', iid: 812, gateId: 'g1' }]);
    expect(f.focused).toEqual([]);
    release(LAUNCHED);
    await f.settle();
    expect(f.writes[1]).toEqual({
      status: 'live',
      agentId: 'agent-1',
      paneId: 'pane-1',
      tabId: 'tab-1',
      workspaceId: 'ws-1',
    });
    expect(f.focused).toEqual([{ paneId: 'pane-1', tabId: 'tab-1' }]);
  });

  test('launches into the questions workspace in reviewCwd with the finding, gate and report json', async () => {
    const f = fake({
      config: cfg({ reviewCwd: '/repo/acme', questionsWorkspace: 'ask' }),
    });
    await handleQuestionLaunch({ ...BODY, boardTabId: 'mine' }, f.io);
    await f.settle();
    const opts = f.launches[0] as LaunchPaneOpts & {
      findingId: string;
      gateId: string;
      reportJsonPath: string;
    };
    expect(opts).toMatchObject({
      mrUrl: MR_URL,
      iid: 812,
      cwd: '/repo/acme',
      repo: 'remote:gitlab.com%2Facme%2Fwebapp',
      workspaceLabel: 'ask',
      author: 'Joel',
      findingId: 'f2',
      gateId: 'g1',
      reportJsonPath: '/state/review/x.json',
      pack: 'pack-mine',
      account: 'a@b.c',
      model: 'opus',
    });
    expect(opts.skill).toBeUndefined();
  });

  test('a finding id and author with spaces and slashes still get a plain handle', async () => {
    const f = fake({ author: { username: 'ob', name: "O'Brien / QA" } });
    await handleQuestionLaunch({ ...BODY, findingId: 'f 1' }, f.io);
    await f.settle();
    const opts = f.launches[0]!;
    expect(opts.findingId).toBe('f 1');
    expect(opts.author).toBe("O'Brien / QA");
    const tail = opts.statePath.split('/questions/')[1]!;
    expect(tail).toMatch(/^[^/\s]+--f-1-[0-9a-f]{8}\.json$/);
  });

  test('a launch that reuses an existing pane records nothing further', async () => {
    const f = fake({
      launch: async () => ({ ...LAUNCHED, focusedExisting: true }),
    });
    await handleQuestionLaunch(BODY, f.io);
    await f.settle();
    expect(f.writes).toEqual([{ status: 'queued', iid: 812, gateId: 'g1' }]);
    expect(f.focused).toEqual([]);
  });

  test('a launch that rejects writes an error row with the cause', async () => {
    const f = fake({
      launch: async () => {
        throw new Error('herdr tab create failed (1): no such workspace');
      },
    });
    expect(await handleQuestionLaunch(BODY, f.io)).toEqual({
      status: 200,
      body: { ok: true },
    });
    await f.settle();
    expect(f.writes[1]).toEqual({
      status: 'error',
      message: 'herdr tab create failed (1): no such workspace',
    });
    expect(f.focused).toEqual([]);
  });

  test('a focus failure after a good launch does not turn the row into an error', async () => {
    const f = fake({
      focusPane: async () => {
        throw new Error('tray down');
      },
    });
    await handleQuestionLaunch(BODY, f.io);
    await f.settle();
    expect(f.writes.map(w => w.status)).toEqual(['queued', 'live']);
  });
});
