import {
  existsSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import type {
  GateRow as FacilityGateRow,
  PaneSendResult,
} from '@mattstack/rt-client';
import {
  ESCAPE_SETTLE_MS,
  findingQuestionText,
  handleFindingQuestion,
  NO_REVIEW_PANE,
  PANE_AT_OTHER_PROMPT,
  REVIEW_RESUMING,
  writeQuestionFile,
  type FindingQuestionIo,
} from '../finding-question.ts';

const MR = 'https://gitlab.example.com/acme/widgets/-/merge_requests/31';

// Screens captured from real panes, shared with the daemon's detector tests.
const daemonFixture = (name: string) =>
  readFileSync(
    join(
      import.meta.dir,
      '..',
      '..',
      '..',
      '..',
      'lib',
      'daemon',
      '__tests__',
      'fixtures',
      name
    ),
    'utf8'
  );
const FORM_SCREEN = daemonFixture('question-form-single.txt');
const PERMISSION_SCREEN = [
  '⏺ Bash(rm -rf build)',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No, and tell Claude what to do differently (esc)',
  '',
].join('\n');

function gateRow(over: Partial<FacilityGateRow> = {}): FacilityGateRow {
  return {
    id: 'g-review',
    subject: `mr:${MR}`,
    kind: 'review-post',
    questions: [
      {
        id: 'findings-1',
        label: 'Post which findings?',
        multi: true,
        options: [
          { value: 'f1', label: 'one' },
          { value: 'f2', label: 'two' },
        ],
      },
      {
        id: 'outcome',
        label: 'Verdict',
        multi: false,
        options: ['approve', 'comment'],
      },
    ],
    meta: null,
    status: 'open',
    answer: null,
    openedAt: 1,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    supersededBy: null,
    owner: null,
    escalatedAt: null,
    consumedAt: null,
    ...over,
  } as FacilityGateRow;
}

const sent = (
  delivered: PaneSendResult['delivered'],
  reason?: string,
  paneId = 'w1:p1'
): { ok: true; data: PaneSendResult } => ({
  ok: true,
  data: { paneId, delivered, ...(reason ? { reason } : {}) },
});

/** A recording io: `replies` answers each paneSend in turn. */
function io(
  over: Partial<FindingQuestionIo> = {},
  replies: Array<Awaited<ReturnType<FindingQuestionIo['paneSend']>>> = [
    sent('accepted'),
  ]
) {
  const calls: string[] = [];
  const texts: string[] = [];
  const sessions: Array<string | undefined> = [];
  const focused: Array<{ paneId: string; tabId?: string }> = [];
  const resumed: Array<{ mrUrl: string; prompt: string }> = [];
  const value: FindingQuestionIo = {
    reviewGate: () => gateRow(),
    reviewPane: () => ({
      tabId: 'w1:t1',
      sessionId: 'sess-1',
      agentId: 'agent-1',
    }),
    sessionPane: async () => 'w1:p1',
    resumeReview: async (mrUrl, prompt) => {
      calls.push('resume');
      resumed.push({ mrUrl, prompt });
      return { focusedExisting: false, paneId: 'w5:p2', tabId: 'w5:t2' };
    },
    paneSend: async ({ paneId, text, selfSession }) => {
      calls.push(`send:${paneId}`);
      texts.push(text);
      sessions.push(selfSession);
      return replies.shift() ?? sent('refused', 'no more replies');
    },
    readScreen: async paneId => {
      calls.push(`read:${paneId}`);
      return FORM_SCREEN;
    },
    sendEscape: async paneId => {
      calls.push(`escape:${paneId}`);
    },
    sleep: async ms => {
      calls.push(`sleep:${ms}`);
    },
    writeQuestion: () => '/q/q.md',
    focusPane: async pane => {
      calls.push('focus');
      focused.push(pane);
    },
    ...over,
  };
  return { io: value, calls, texts, sessions, focused, resumed };
}

const body = (over: Record<string, unknown> = {}) => ({
  mrUrl: MR,
  iid: 31,
  gateId: 'g-review',
  findingId: 'f2',
  question: 'Is this really Important?',
  ...over,
});

describe('the question file', () => {
  test('the pane line names the skill, the gate, the finding and the file', () => {
    expect(findingQuestionText('g-review', 'f2', '/q/q.md')).toBe(
      '/board:review-finding-question g-review f2 "/q/q.md"'
    );
  });

  test('keeps the question as typed, newlines included', () => {
    const dir = mkdtempSync(join(tmpdir(), 'finding-question-'));
    const path = writeQuestionFile(dir, 'g1', 'f2', 'line one\n\n"line two"');
    expect(readFileSync(path, 'utf8')).toBe('line one\n\n"line two"\n');
  });

  test('prunes files older than a week and keeps newer ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'finding-question-'));
    const now = Date.now();
    const old = join(dir, 'old.md');
    const fresh = join(dir, 'fresh.md');
    writeFileSync(old, 'x');
    writeFileSync(fresh, 'x');
    const eightDays = (now - 8 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(old, eightDays, eightDays);
    writeQuestionFile(dir, 'g1', 'f2', 'q', now);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});

describe('handleFindingQuestion refusals', () => {
  test.each([
    ['a finding id with a space', { findingId: 'f 2' }],
    ['a finding id with a quote', { findingId: 'f"2' }],
    ['an empty question', { question: '  \n ' }],
    ['a question over 2000 characters', { question: 'x'.repeat(2001) }],
    ['a body missing the gate', { gateId: undefined }],
  ])('400 for %s', async (_name, over) => {
    const { io: deps, calls } = io();
    const res = await handleFindingQuestion(body(over), deps);
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  test("409 when the gate is not this MR's open review gate", async () => {
    for (const reviewGate of [
      () => undefined,
      () => gateRow({ id: 'g-other' }),
      () => gateRow({ status: 'answered' }),
      () => gateRow({ status: 'closed' }),
    ]) {
      const { io: deps, calls } = io({ reviewGate });
      const res = await handleFindingQuestion(body(), deps);
      expect(res.status).toBe(409);
      expect(calls).toEqual([]);
    }
  });

  test("409 when the gate's findings do not list the finding", async () => {
    const { io: deps, calls } = io();
    const res = await handleFindingQuestion(body({ findingId: 'f9' }), deps);
    expect(res.status).toBe(409);
    expect(calls).toEqual([]);
  });

  test('409 with the resume hint when the review has no session on file', async () => {
    const { io: deps, calls } = io({ reviewPane: () => ({ tabId: 'w1:t1' }) });
    const res = await handleFindingQuestion(body(), deps);
    expect(res).toEqual({ status: 409, body: NO_REVIEW_PANE });
    expect(NO_REVIEW_PANE).toBe('Resume the review from its row first');
    expect(calls).toEqual([]);
  });

  test('409 with the resume hint, typing nothing, when no pane runs the session', async () => {
    const { io: deps, calls } = io({ sessionPane: async () => null });
    const res = await handleFindingQuestion(body(), deps);
    expect(res).toEqual({ status: 409, body: NO_REVIEW_PANE });
    expect(calls).toEqual([]);
  });

  test('409, typing nothing, when rt cannot say where the session runs', async () => {
    const { io: deps, calls } = io({
      sessionPane: async () => {
        throw new Error('daemon unreachable');
      },
    });
    const res = await handleFindingQuestion(body(), deps);
    expect(res.status).toBe(409);
    expect(res.body).toContain('daemon unreachable');
    expect(calls).toEqual([]);
  });

  test('409 carrying the reason when the pane refuses for anything else', async () => {
    const { io: deps, calls } = io({}, [sent('refused', 'pane is gone')]);
    const res = await handleFindingQuestion(body(), deps);
    expect(res.status).toBe(409);
    expect(res.body).toContain('pane is gone');
    expect(calls).toEqual(['send:w1:p1']);
  });

  test('409 when rt cannot deliver at all', async () => {
    const { io: deps } = io({}, [{ ok: false, error: 'daemon unreachable' }]);
    const res = await handleFindingQuestion(body(), deps);
    expect(res.status).toBe(409);
    expect(res.body).toContain('daemon unreachable');
  });
});

describe('handleFindingQuestion delivery', () => {
  test('types the line into the review pane and focuses it', async () => {
    const written: string[] = [];
    const {
      io: deps,
      calls,
      texts,
      focused,
    } = io({
      writeQuestion: (_gate, _finding, text) => {
        written.push(text);
        return '/q/q.md';
      },
    });
    const res = await handleFindingQuestion(
      body({ question: 'Is "this"\nreally Important?' }),
      deps
    );
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(written).toEqual(['Is "this"\nreally Important?']);
    expect(texts).toEqual([
      '/board:review-finding-question g-review f2 "/q/q.md"',
    ]);
    expect(calls).toEqual(['send:w1:p1', 'focus']);
    expect(focused).toEqual([{ paneId: 'w1:p1', tabId: 'w1:t1' }]);
  });

  test('a queued delivery is success too', async () => {
    const { io: deps } = io({}, [sent('queued')]);
    expect((await handleFindingQuestion(body(), deps)).status).toBe(200);
  });

  test("the body's tabId wins over the review state's", async () => {
    const { io: deps, focused } = io();
    await handleFindingQuestion(body({ tabId: 'w2:t9' }), deps);
    expect(focused).toEqual([{ paneId: 'w1:p1', tabId: 'w2:t9' }]);
  });

  test('a pane at the gate form gets one Escape, a pause, then the line again', async () => {
    const {
      io: deps,
      calls,
      texts,
    } = io({}, [sent('refused', 'at a prompt'), sent('accepted')]);
    const res = await handleFindingQuestion(body(), deps);
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      'send:w1:p1',
      'read:w1:p1',
      'escape:w1:p1',
      `sleep:${ESCAPE_SETTLE_MS}`,
      'send:w1:p1',
      'focus',
    ]);
    expect(texts[0]).toBe(texts[1]);
    expect(ESCAPE_SETTLE_MS).toBe(600);
  });

  test('a pane blocked on any other prompt gets no Escape and a 409', async () => {
    const { io: deps, calls } = io(
      { readScreen: async () => PERMISSION_SCREEN },
      [sent('refused', 'at a prompt')]
    );
    const res = await handleFindingQuestion(body(), deps);
    expect(res).toEqual({ status: 409, body: PANE_AT_OTHER_PROMPT });
    expect(PANE_AT_OTHER_PROMPT).toBe(
      'Review pane is at a prompt. Answer it there first'
    );
    expect(calls).toEqual(['send:w1:p1']);
  });

  test.each(['What should happen to f2?', 'Apply this revision to f2?'])(
    "the skill's own form (%s) gets no Escape",
    async formLine => {
      const { io: deps, calls } = io(
        { readScreen: async () => `${formLine}\n${FORM_SCREEN}` },
        [sent('refused', 'at a prompt')]
      );
      const res = await handleFindingQuestion(body(), deps);
      expect(res).toEqual({ status: 409, body: PANE_AT_OTHER_PROMPT });
      expect(calls).toEqual(['send:w1:p1']);
    }
  );

  test('a question past the paste limit still types a short line', async () => {
    const written: string[] = [];
    const question = 'why is this critical? '.repeat(90).trim();
    const { io: deps, texts } = io({
      writeQuestion: (_gate, _finding, text) => {
        written.push(text);
        return '/q/q.md';
      },
    });
    const res = await handleFindingQuestion(body({ question }), deps);
    expect(res.status).toBe(200);
    expect(written).toEqual([question]);
    expect(texts[0]!.length).toBeLessThan(800);
  });

  test('a question that cannot be saved types nothing', async () => {
    const { io: deps, calls } = io({
      writeQuestion: () => {
        throw new Error('disk full');
      },
    });
    const res = await handleFindingQuestion(body(), deps);
    expect(res.status).toBe(409);
    expect(res.body).toContain('disk full');
    expect(calls).toEqual([]);
  });

  test('a blocked pane whose screen cannot be read gets no Escape either', async () => {
    const errors: string[] = [];
    const { io: deps, calls } = io(
      {
        readScreen: async () => {
          throw new Error('herdr down');
        },
        logError: m => errors.push(m),
      },
      [sent('refused', 'at a prompt')]
    );
    const res = await handleFindingQuestion(body(), deps);
    expect(res).toEqual({ status: 409, body: PANE_AT_OTHER_PROMPT });
    expect(calls).toEqual(['send:w1:p1']);
    expect(errors[0]).toContain('herdr down');
  });

  test('only one retry: a pane still at a prompt is a 409', async () => {
    const { io: deps, calls } = io({}, [
      sent('refused', 'at a prompt'),
      sent('refused', 'at a prompt'),
    ]);
    const res = await handleFindingQuestion(body(), deps);
    expect(res.status).toBe(409);
    expect(res.body).toContain('at a prompt');
    expect(calls.filter(c => c.startsWith('send:')).length).toBe(2);
    expect(calls).not.toContain('focus');
  });

  test("the send names the review's session, and the pane it resolved gets the Escape and the focus", async () => {
    const {
      io: deps,
      calls,
      sessions,
      focused,
    } = io({}, [
      sent('refused', 'at a prompt', 'w3:p7'),
      sent('accepted', undefined, 'w3:p7'),
    ]);
    const res = await handleFindingQuestion(body(), deps);
    expect(res.status).toBe(200);
    expect(sessions).toEqual(['sess-1', 'sess-1']);
    expect(calls).toEqual([
      'send:w1:p1',
      'read:w3:p7',
      'escape:w3:p7',
      `sleep:${ESCAPE_SETTLE_MS}`,
      'send:w3:p7',
      'focus',
    ]);
    expect(focused).toEqual([{ paneId: 'w3:p7', tabId: 'w1:t1' }]);
  });

  test('an Escape herdr fails to send is a 409, and the line is not sent again', async () => {
    const { io: deps, calls } = io(
      {
        sendEscape: async () => {
          throw new Error('herdr down');
        },
      },
      [sent('refused', 'at a prompt')]
    );
    const res = await handleFindingQuestion(body(), deps);
    expect(res.status).toBe(409);
    expect(res.body).toContain('herdr down');
    expect(calls).toEqual(['send:w1:p1', 'read:w1:p1']);
  });

  test('a pane that is gone is the resume hint', async () => {
    const { io: deps, calls } = io({}, [sent('refused', 'not a claude pane')]);
    const res = await handleFindingQuestion(body(), deps);
    expect(res).toEqual({ status: 409, body: NO_REVIEW_PANE });
    expect(calls).toEqual(['send:w1:p1']);
  });

  test('a focus that fails does not lose the delivered question', async () => {
    const { io: deps } = io({
      focusPane: async () => {
        throw new Error('herdr down');
      },
    });
    expect(await handleFindingQuestion(body(), deps)).toEqual({
      status: 200,
      body: { ok: true },
    });
  });
});

describe('handleFindingQuestion on a parked gate', () => {
  const parked = () => gateRow({ status: 'parked' });

  test('resumes the session with the line as its prompt and focuses the new pane', async () => {
    const {
      io: deps,
      calls,
      resumed,
      focused,
    } = io({
      reviewGate: parked,
      sessionPane: async () => null,
    });
    const res = await handleFindingQuestion(body(), deps);
    expect(res).toEqual({ status: 200, body: { ok: true, resumed: true } });
    expect(resumed).toEqual([
      {
        mrUrl: MR,
        prompt: '/board:review-finding-question g-review f2 "/q/q.md"',
      },
    ]);
    expect(calls).toEqual(['resume', 'focus']);
    expect(focused).toEqual([{ paneId: 'w5:p2', tabId: 'w5:t2' }]);
  });

  test('a resume tab already open is only focused, so the question is a 409', async () => {
    const { io: deps, calls } = io({
      reviewGate: parked,
      sessionPane: async () => null,
      resumeReview: async () => ({
        focusedExisting: true,
        paneId: '',
        tabId: '',
      }),
    });
    const res = await handleFindingQuestion(body(), deps);
    expect(res).toEqual({ status: 409, body: REVIEW_RESUMING });
    expect(calls).toEqual([]);
  });

  test('a resume that fails is a 409 carrying why', async () => {
    const { io: deps } = io({
      reviewGate: parked,
      sessionPane: async () => null,
      resumeReview: async () => {
        throw new Error('agent not found');
      },
    });
    const res = await handleFindingQuestion(body(), deps);
    expect(res.status).toBe(409);
    expect(res.body).toContain('agent not found');
  });

  test('no agent on file to resume is the resume hint', async () => {
    const { io: deps, calls } = io({
      reviewGate: parked,
      reviewPane: () => ({ sessionId: 'sess-1' }),
      sessionPane: async () => null,
    });
    const res = await handleFindingQuestion(body(), deps);
    expect(res).toEqual({ status: 409, body: NO_REVIEW_PANE });
    expect(calls).toEqual([]);
  });

  test('a session already running again takes the line in its pane', async () => {
    const { io: deps, calls } = io({ reviewGate: parked });
    const res = await handleFindingQuestion(body(), deps);
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(calls).toEqual(['send:w1:p1', 'focus']);
  });
});
