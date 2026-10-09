import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  setSetting,
  type Commands,
  type IntegrationSummary,
} from '@mattstack/rt-client';
import {
  agentHarness,
  SwitchedOffRefusal,
  type AgentIo,
  type HarnessIo,
} from '../agent-launch.ts';
import { callerSession, resolveCallerSession } from '../caller-session.ts';
import { migrateLegacySessions } from '../gates/legacy-session-migration.ts';
import { resumeParkedGate, type KindResumeIo } from '../gates/resume.ts';
import type { GateState } from '../gates/store.ts';
import { gateOpen, type GateVerbIo } from '../gates/verbs.ts';
import {
  BOARD_STATUS_BIN_ENV,
  dispatchPrompt,
  launchLegacyResume,
  launchRespond,
  launchReview,
  statusBinPath,
  type LaunchPaneOpts,
} from '../herdr.ts';
import { readReviewStates } from '../review-state.ts';
import { agentSkillResolver, resolveAgentSkill } from '../skill-path.ts';
import { insertAgentState, mintHandle } from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';

const MR = 'https://gitlab.example.com/acme/webapp/-/merge_requests/4821';

function summary(id: string, enabled: boolean): IntegrationSummary {
  return {
    id,
    label: id,
    enabled,
    readiness: { ready: enabled },
    capabilities: [],
    options: [],
  };
}

function writeSkill(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n\nbody\n`);
  return realpathSync(join(dir, 'SKILL.md'));
}

let root: string;
let codexHome: string;
let home: string;
let claudeCalls: number;
let resolver: ReturnType<typeof agentSkillResolver>;
let reviewWrapper: string;
let respondWrapper: string;
let domainSkill: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-workflows-'));
  home = join(root, 'home');
  codexHome = join(home, '.codex');
  reviewWrapper = writeSkill(
    join(codexHome, 'skills', 'board:review'),
    'board:review'
  );
  respondWrapper = writeSkill(
    join(codexHome, 'skills', 'board:respond'),
    'board:respond'
  );
  const pluginDir = join(
    codexHome,
    'plugins',
    'cache',
    'acme',
    'acme',
    '1.2.0'
  );
  domainSkill = writeSkill(
    join(pluginDir, 'skills', 'board-review'),
    'acme:board-review'
  );
  claudeCalls = 0;
  resolver = agentSkillResolver({
    home,
    codexHome,
    listClaudePlugins: async () => {
      claudeCalls++;
      throw new Error('the Claude inventory ran in a Codex launch');
    },
    listCodexPlugins: async () => ({
      ok: true,
      data: [{ id: 'acme@acme', enabled: true, installPath: pluginDir }],
    }),
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function codexOnly(provider = 'codex'): HarnessIo {
  return {
    switchOn: () => true,
    defaultHarness: () => 'claude',
    agentIntegrations: async () => ({
      ok: true,
      data: {
        integrations: [summary('claude', false), summary('codex', true)],
      },
    }),
    agentGet: async ({ id }) => ({
      ok: true,
      data: {
        id,
        repo: 'remote:x',
        cwd: '/repo',
        provider,
        surface: 'herdr',
        sessionId: 'thread-1',
        createdAt: 0,
      },
    }),
  };
}

function recordingIo(harness: HarnessIo): {
  io: AgentIo;
  starts: Commands['agent:start']['payload'][];
} {
  const starts: Commands['agent:start']['payload'][] = [];
  const io: AgentIo = {
    harness,
    agentStart: async payload => {
      starts.push(payload);
      return {
        ok: true,
        data: {
          id: 'agent-1',
          repo: payload.repo,
          cwd: payload.cwd,
          provider: payload.provider ?? 'claude',
          surface: 'herdr',
          sessionId: 'thread-1',
          paneId: 'w1:p1',
          tabId: 'w1:t1',
          workspaceId: 'w1',
          createdAt: 0,
        },
      };
    },
    agentResume: async () => {
      throw new Error('not used');
    },
  };
  return { io, starts };
}

const launchOpts: LaunchPaneOpts = {
  mrUrl: MR,
  iid: 4821,
  cwd: '/repo',
  repo: 'remote:gitlab.example.com%2Facme%2Fwebapp',
  workspaceLabel: 'reviews',
  statePath: '/board/state/review-4821.json',
  skill: 'acme:board-review',
  account: 'someone@example.com',
  model: 'claude-opus-5',
  effort: 'high',
};

describe('Codex review responds and reports without Claude', () => {
  test('a review launch selects Codex and names its own target artifacts', async () => {
    const { io, starts } = recordingIo(codexOnly());
    const result = await launchReview(launchOpts, io, resolver);

    expect(result.agentId).toBe('agent-1');
    expect(starts).toHaveLength(1);
    const payload = starts[0]!;
    expect(payload.provider).toBe('codex');
    expect(payload.subject).toBe(`mr:${MR}`);
    expect(payload.account).toBeUndefined();
    expect(payload.model).toBeUndefined();
    expect(payload.effort).toBeUndefined();
    expect(payload.prompt!.startsWith('/')).toBe(false);
    expect(payload.prompt).toContain(reviewWrapper);
    expect(payload.prompt).toContain(`--skill-path ${domainSkill}`);
    expect(payload.prompt).toContain(`--state ${launchOpts.statePath}`);
    expect(claudeCalls).toBe(0);
  });

  test('a respond launch resolves the respond wrapper for Codex', async () => {
    const { io, starts } = recordingIo(codexOnly());
    await launchRespond(
      { ...launchOpts, workspaceLabel: 'responses' },
      io,
      resolver
    );
    expect(starts[0]!.provider).toBe('codex');
    expect(starts[0]!.prompt).toContain(respondWrapper);
    expect(claudeCalls).toBe(0);
  });

  test('a launch refuses when the Codex wrapper is not installed', async () => {
    rmSync(join(codexHome, 'skills', 'board:review'), {
      recursive: true,
      force: true,
    });
    const { io, starts } = recordingIo(codexOnly());
    await expect(launchReview(launchOpts, io, resolver)).rejects.toThrow(
      /board:review/
    );
    expect(starts).toHaveLength(0);
  });

  test('with the switch off the launch keeps the slash form and sends no provider', async () => {
    const { io, starts } = recordingIo({
      ...codexOnly(),
      switchOn: () => false,
      agentIntegrations: async () => {
        throw new Error('metadata read with the switch off');
      },
    });
    await launchReview(launchOpts, io, async () => null);
    expect(starts[0]!.provider).toBeUndefined();
    expect(starts[0]!.prompt!.startsWith('/board:review ')).toBe(true);
    expect(starts[0]!.account).toBe('someone@example.com');
  });

  test('a launch refuses when no integration is turned on', async () => {
    const { io, starts } = recordingIo({
      ...codexOnly(),
      agentIntegrations: async () => ({
        ok: true,
        data: {
          integrations: [summary('claude', false), summary('codex', false)],
        },
      }),
    });
    await expect(launchReview(launchOpts, io, resolver)).rejects.toThrow(
      /turned on/
    );
    expect(starts).toHaveLength(0);
  });

  test('resolveAgentSkill returns the selected target artifact', async () => {
    const deps = {
      home,
      codexHome,
      listClaudePlugins: async () => {
        claudeCalls++;
        return [];
      },
      listCodexPlugins: async () => ({ ok: true as const, data: [] }),
    };
    expect(await resolveAgentSkill('codex', 'board:review', deps)).toEqual({
      ok: true,
      data: reviewWrapper,
    });
    const missing = await resolveAgentSkill('codex', 'board:doctor', deps);
    expect(missing.ok).toBe(false);
    const other = await resolveAgentSkill('gemini', 'board:review', deps);
    expect(other.ok ? 'ok' : other.error.code).toBe('unsupported');
    expect(claudeCalls).toBe(0);
  });

  test('a parked gate answered elsewhere resumes the Codex agent with its own prompt', async () => {
    const resumes: Array<{ agentId: string; prompt: string }> = [];
    const kindIo: KindResumeIo = {
      readState: () => undefined,
      writeState: () => {},
      filePath: () => '/board/state/review-4821.json',
      resolveSkill: () => 'acme:board-review',
      resolvePack: () => undefined,
      prompt: (mrUrl, statePath, skill, gate, kind, resolvePath, harness) =>
        dispatchPrompt(
          'board:review',
          {
            mrUrl,
            statePath,
            statusBin: '/board/bin/board',
            skill,
            resumedGate: gate,
            resumedGateKind: kind,
          },
          resolvePath,
          harness
        ),
      resumedStatus: 'reviewing',
      workspaceLabel: 'reviews',
    };
    const gate = {
      gateId: 'g-1',
      kind: 'review-post',
      mrUrl: MR,
      iid: 4821,
      agentId: 'agent-1',
    } as GateState;
    const harness = codexOnly();
    const ok = await resumeParkedGate(
      gate,
      {
        resumers: { 'review-post': kindIo },
        agentHarness: id => agentHarnessOf(harness, id),
        resumeAgentPane: async opts => {
          resumes.push(opts);
          return {
            agentId: opts.agentId,
            sessionId: 'thread-1',
            paneId: 'w1:p2',
            tabId: 'w1:t2',
            workspaceId: 'w1',
            focusedExisting: false,
          };
        },
        notify: () => {},
      },
      resolver
    );
    expect(ok).toBe(true);
    expect(resumes[0]!.prompt).toContain(reviewWrapper);
    expect(resumes[0]!.prompt).toContain('--resumed-gate g-1');
    expect(claudeCalls).toBe(0);
  });

  test('gate open and the status CLI name the Codex thread', async () => {
    expect(callerSession({ CODEX_THREAD_ID: 'thread-1' }, true)).toEqual({
      sessionId: 'thread-1',
      harness: 'codex',
    });
    expect(callerSession({ CODEX_THREAD_ID: 'thread-1' }, false)).toEqual({});
    expect(
      callerSession(
        { CODEX_THREAD_ID: 'thread-1', CLAUDE_CODE_SESSION_ID: 's-1' },
        true
      ).sessionId
    ).toBeUndefined();

    const db: Database = openStateDb(join(root, 'state.db'));
    const handle = mintHandle('review', MR, root);
    insertAgentState(
      'review',
      MR,
      4821,
      {
        mrUrl: MR,
        iid: 4821,
        status: 'reviewing',
        paneId: 'w1:p1',
        startedAt: 0,
        updatedAt: 0,
      },
      handle,
      db
    );
    const asks: Commands['gate:ask']['payload'][] = [];
    const io: GateVerbIo = {
      gateAsk: async payload => {
        asks.push(payload);
        return {
          ok: true,
          data: {
            id: 'g-1',
            presentation: 'wait',
            subject: payload.subject ?? '',
            supersededId: null,
          },
        };
      },
      gateWait: async () => {
        throw new Error('not used');
      },
      gateAnswer: async () => {
        throw new Error('not used');
      },
      now: () => 0,
    };
    await gateOpen(
      handle,
      'review-post',
      JSON.stringify([
        { id: 'q', label: 'Post?', multi: false, options: ['yes'] },
      ]),
      io,
      { sessionId: 'thread-1', harness: 'codex' }
    );
    expect(asks[0]!.subject).toBe(`mr:${MR}`);
    expect(asks[0]!.sessionId).toBe('thread-1');
    expect(asks[0]!.harness).toBe('codex');
    expect(asks[0]!.paneId).toBe('w1:p1');
  });

  test('the review status CLI records the Codex thread with its harness and runs no claude', async () => {
    const fakeBin = join(root, 'bin');
    mkdirSync(fakeBin);
    const marker = join(root, 'claude-ran');
    writeFileSync(
      join(fakeBin, 'claude'),
      `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`
    );
    chmodSync(join(fakeBin, 'claude'), 0o755);

    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      setSetting('agent.integrations.enabled', true, 'machine');
    } finally {
      process.env.HOME = prevHome;
    }

    const statusRoot = join(root, 'status');
    mkdirSync(statusRoot);
    const dbPath = join(statusRoot, 'state.db');
    const db = openStateDb(dbPath);
    const handle = mintHandle('review', MR, statusRoot);
    insertAgentState(
      'review',
      MR,
      4821,
      {
        mrUrl: MR,
        iid: 4821,
        status: 'queued',
        agentId: 'agent-1',
        startedAt: 0,
        updatedAt: 0,
      },
      handle,
      db
    );
    const cli = join(import.meta.dir, '..', '..', 'bin', 'review-status.ts');
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      HOME: home,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      CLAUDE_BIN: join(fakeBin, 'claude'),
      CODEX_THREAD_ID: 'thread-1',
      MR_BOARD_PORT: '1',
    };
    delete env.BOARD_STATE_DB;
    delete env.CLAUDE_CODE_SESSION_ID;
    const proc = Bun.spawn(['bun', 'run', cli, handle, 'reviewing'], {
      env,
      stderr: 'pipe',
    });
    const code = await proc.exited;
    expect(code).toBe(0);
    const state = readReviewStates(db).get(MR);
    expect(state?.status).toBe('reviewing');
    expect(state?.sessionId).toBe('thread-1');
    expect(state?.sessionHarness).toBe('codex');
    expect(state?.agentId).toBe('agent-1');
    expect(() => readFileSync(marker)).toThrow();
  });
});

async function agentHarnessOf(io: HarnessIo, agentId: string) {
  const res = await io.agentGet({ id: agentId });
  return res.ok ? res.data?.provider : undefined;
}

describe('legacy migration preserves explicit native reference', () => {
  test('a session with a recorded harness and no agent is kept; a bare one is cleared', () => {
    const writes: Array<{ path: string; patch: object }> = [];
    const states = new Map([
      [
        'a',
        {
          mrUrl: 'a',
          status: 'done',
          sessionId: 'thread-1',
          sessionHarness: 'codex',
        },
      ],
      ['b', { mrUrl: 'b', status: 'done', sessionId: 'claude-1' }],
    ]);
    migrateLegacySessions(
      'review',
      states,
      url => `/state/${url}`,
      (path, patch) => writes.push({ path, patch }),
      () => {}
    );
    expect(writes).toEqual([
      { path: '/state/b', patch: { status: 'done', sessionId: '' } },
    ]);
  });

  test('a recorded non-Claude session never resumes through claude --resume', async () => {
    const calls: string[][] = [];
    await expect(
      launchLegacyResume(
        {
          ...launchOpts,
          sessionId: 'thread-1',
          sessionHarness: 'codex',
          workspaceKind: 'review',
        },
        async args => {
          calls.push(args);
          return '';
        }
      )
    ).rejects.toThrow(/codex/i);
    expect(calls).toHaveLength(0);
  });
});

describe('harness choice and refusals', () => {
  function bothOn(defaultHarness: string, codexOn = true): HarnessIo {
    return {
      ...codexOnly(),
      defaultHarness: () => defaultHarness,
      agentIntegrations: async () => ({
        ok: true,
        data: {
          integrations: [summary('claude', true), summary('codex', codexOn)],
        },
      }),
    };
  }

  test("both turned on and agent.provider is codex: the user's default wins", async () => {
    const { io, starts } = recordingIo(bothOn('codex'));
    await launchReview(launchOpts, io, resolver);
    expect(starts[0]!.provider).toBe('codex');
    expect(starts[0]!.prompt).toContain(reviewWrapper);
    expect(claudeCalls).toBe(0);
  });

  test('agent.provider not turned on: the first integration turned on', async () => {
    const { io, starts } = recordingIo(bothOn('codex', false));
    await launchReview(launchOpts, io, async () => null);
    expect(starts[0]!.provider).toBe('claude');
    expect(starts[0]!.prompt!.startsWith('/board:review ')).toBe(true);
    expect(starts[0]!.account).toBe('someone@example.com');
  });

  test('a domain skill Codex cannot find refuses the launch instead of dropping --skill-path', async () => {
    const { io, starts } = recordingIo(codexOnly());
    await expect(
      launchReview({ ...launchOpts, skill: 'acme:nowhere' }, io, resolver)
    ).rejects.toThrow(/acme:nowhere/);
    expect(starts).toHaveLength(0);
    expect(claudeCalls).toBe(0);
  });

  test('a Codex listing that fails refuses the launch with its reason', async () => {
    const failing = agentSkillResolver({
      home,
      codexHome,
      listClaudePlugins: async () => {
        claudeCalls++;
        return [];
      },
      listCodexPlugins: async () => ({
        ok: false,
        error: { code: 'not-ready', message: 'codex plugin list exited 3' },
      }),
    });
    const { io, starts } = recordingIo(codexOnly());
    await expect(launchReview(launchOpts, io, failing)).rejects.toThrow(
      /exited 3/
    );
    expect(starts).toHaveLength(0);
    expect(claudeCalls).toBe(0);
  });

  test('an environment naming both sessions keeps the one the agent runs', async () => {
    const env = { CODEX_THREAD_ID: 'thread-1', CLAUDE_CODE_SESSION_ID: 's-1' };
    const of = (h: string | undefined) => async () => h;
    expect(
      await resolveCallerSession(
        env,
        true,
        'gate',
        () => 'agent-1',
        of('codex')
      )
    ).toEqual({ sessionId: 'thread-1', harness: 'codex' });
    expect(
      await resolveCallerSession(
        env,
        true,
        'gate',
        () => 'agent-1',
        of('claude')
      )
    ).toEqual({ sessionId: 's-1', harness: 'claude' });
    const none = await resolveCallerSession(
      env,
      true,
      'gate',
      () => undefined,
      of('codex')
    );
    expect(none.sessionId).toBeUndefined();
    expect(none.problem).toContain('this gate names no session');
  });
});

describe('gate CLI wiring', () => {
  test('gate open names the Codex thread the agent runs, through the daemon', async () => {
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      setSetting('agent.integrations.enabled', true, 'machine');
    } finally {
      process.env.HOME = prevHome;
    }

    const sockDir = mkdtempSync('/tmp/hw-');
    const sock = join(sockDir, 'rt.sock');
    const asks: Array<Record<string, unknown>> = [];
    const daemon = Bun.serve({
      unix: sock,
      async fetch(req) {
        const cmd = new URL(req.url).pathname.slice(1);
        const body = (await req.json()) as Record<string, unknown>;
        if (cmd === 'agent:get')
          return Response.json({
            ok: true,
            data: {
              id: body.id,
              repo: 'remote:x',
              cwd: '/repo',
              provider: 'codex',
              surface: 'herdr',
              sessionId: 'thread-1',
              createdAt: 0,
            },
          });
        if (cmd === 'gate:ask') {
          asks.push(body);
          return Response.json({
            ok: true,
            data: {
              id: 'g-1',
              presentation: 'wait',
              subject: body.subject,
              supersededId: null,
            },
          });
        }
        return Response.json({ ok: false, error: `unexpected ${cmd}` });
      },
    });
    try {
      const gateRoot = join(root, 'gate');
      mkdirSync(gateRoot);
      const db = openStateDb(join(gateRoot, 'state.db'));
      const handle = mintHandle('review', MR, gateRoot);
      insertAgentState(
        'review',
        MR,
        4821,
        {
          mrUrl: MR,
          iid: 4821,
          status: 'reviewing',
          agentId: 'agent-1',
          paneId: 'w1:p1',
          startedAt: 0,
          updatedAt: 0,
        },
        handle,
        db
      );
      const cli = join(import.meta.dir, '..', '..', 'bin', 'gate.ts');
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        HOME: home,
        RT_DAEMON_SOCK: sock,
        CODEX_THREAD_ID: 'thread-1',
        CLAUDE_CODE_SESSION_ID: 'claude-1',
      };
      delete env.BOARD_STATE_DB;
      const proc = Bun.spawn(
        [
          'bun',
          'run',
          cli,
          'open',
          handle,
          '--kind',
          'review-post',
          '--questions',
          JSON.stringify([
            { id: 'q', label: 'Post?', multi: false, options: ['yes'] },
          ]),
        ],
        { env, stdout: 'pipe', stderr: 'pipe' }
      );
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect({ code, err }).toEqual({ code: 0, err: '' });
      expect(JSON.parse(out).gateId).toBe('g-1');
      expect(asks).toHaveLength(1);
      expect(asks[0]!.sessionId).toBe('thread-1');
      expect(asks[0]!.harness).toBe('codex');
      expect(asks[0]!.subject).toBe(`mr:${MR}`);
      expect(asks[0]!.paneId).toBe('w1:p1');
    } finally {
      daemon.stop(true);
      rmSync(sockDir, { recursive: true, force: true });
    }
  });
});

describe('Claude board panes name their status writer for the mod', () => {
  const claudeOn = (): HarnessIo => ({
    ...codexOnly(),
    agentIntegrations: async () => ({
      ok: true,
      data: {
        integrations: [summary('claude', true), summary('codex', false)],
      },
    }),
  });

  test('a Claude launch with the switch on sets the status writer in the pane env', async () => {
    const { io, starts } = recordingIo(claudeOn());
    await launchReview({ ...launchOpts, pack: 'acme' }, io, async () => null);
    expect(starts[0]!.provider).toBe('claude');
    expect(starts[0]!.env).toEqual({
      MATTSTACK_PACK: 'acme',
      [BOARD_STATUS_BIN_ENV]: statusBinPath(),
    });
  });

  test('a Codex launch and a launch with the switch off carry no status writer', async () => {
    const codex = recordingIo(codexOnly());
    await launchReview(launchOpts, codex.io, resolver);
    expect(codex.starts[0]!.env).toBeUndefined();

    const off = recordingIo({ ...claudeOn(), switchOn: () => false });
    await launchReview(
      { ...launchOpts, pack: 'acme' },
      off.io,
      async () => null
    );
    expect(off.starts[0]!.env).toEqual({ MATTSTACK_PACK: 'acme' });
  });
});

describe('the switch turned off after a Codex launch', () => {
  const kindIo: KindResumeIo = {
    readState: () => undefined,
    writeState: () => {},
    filePath: () => '/board/state/review-4821.json',
    resolveSkill: () => 'acme:board-review',
    resolvePack: () => undefined,
    prompt: async (mrUrl, statePath, skill, gate, kind, resolvePath, harness) =>
      dispatchPrompt(
        'board:review',
        {
          mrUrl,
          statePath,
          statusBin: '/board/bin/board',
          skill,
          resumedGate: gate,
          resumedGateKind: kind,
        },
        resolvePath,
        harness
      ),
    resumedStatus: 'reviewing',
    workspaceLabel: 'reviews',
  };
  const gate = {
    gateId: 'g-1',
    kind: 'review-post',
    mrUrl: MR,
    iid: 4821,
    agentId: 'agent-1',
  } as GateState;

  async function resumeWith(harness: HarnessIo) {
    const notes: string[] = [];
    const prompts: string[] = [];
    const ok = await resumeParkedGate(
      gate,
      {
        resumers: { 'review-post': kindIo },
        agentHarness: id => agentHarness(id, harness),
        resumeAgentPane: async opts => {
          prompts.push(opts.prompt);
          return {
            agentId: opts.agentId,
            sessionId: 's',
            paneId: 'w1:p2',
            tabId: 'w1:t2',
            workspaceId: 'w1',
            focusedExisting: false,
          };
        },
        notify: message => notes.push(message),
      },
      async () => null
    );
    return { ok, notes, prompts };
  }

  test('a parked Codex agent is refused in plain words, never sent the Claude slash prompt', async () => {
    const off = { ...codexOnly(), switchOn: () => false };
    await expect(agentHarness('agent-1', off)).rejects.toBeInstanceOf(
      SwitchedOffRefusal
    );
    const { ok, notes, prompts } = await resumeWith(off);
    expect(ok).toBe(false);
    expect(prompts).toEqual([]);
    expect(notes).toEqual([
      'This agent runs in codex, and agent integrations are turned off, so the board can only resume Claude. Turn agent integrations back on to resume it.',
    ]);
  });

  test('a Claude agent, or one the board cannot read, resumes as it always did', async () => {
    const claude = { ...codexOnly('claude'), switchOn: () => false };
    expect(
      (await resumeWith(claude)).prompts[0]!.startsWith('/board:review ')
    ).toBe(true);
    const unreadable: HarnessIo = {
      ...codexOnly(),
      switchOn: () => false,
      agentGet: async () => ({ ok: false, error: 'daemon down' }),
    };
    expect(
      (await resumeWith(unreadable)).prompts[0]!.startsWith('/board:review ')
    ).toBe(true);
  });

  test('a read that does not answer in time resumes as it always did', async () => {
    const hung: HarnessIo = {
      ...codexOnly(),
      switchOn: () => false,
      agentGet: () => new Promise(() => {}),
    };
    const started = Date.now();
    expect(await agentHarness('agent-1', hung, 20)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
