import { describe, expect, test } from 'bun:test';
import type { ChatPane } from '@mattstack/rt-client';
import { attachPlanFor, loadAgentRows, paneForResume, type AgentsDeps } from '../agentsLoad';

const WT = '/r/wt';
const CTX = { worktreePath: WT, worktreeRoots: ['/r', WT], branch: 'feat' };
const livePane: ChatPane = { paneId: 'w1-2', workspace: 'w1', agentStatus: 'working', cwd: WT, sessionId: 's1' };

function deps(over: Partial<Record<keyof AgentsDeps, unknown>>): AgentsDeps {
  const fail = async () => { throw new Error('not stubbed'); };
  return {
    paneList: async () => ({ ok: true, data: { panes: [] } }),
    agentList: async () => ({ ok: true, data: { agents: [] } }),
    listRuns: async () => ({ ok: true, data: { runs: [] } }),
    agentResume: fail,
    paneAttachPlan: fail,
    ...over,
  } as unknown as AgentsDeps;
}

describe('loadAgentRows', () => {
  test('daemon down: loadAgentRows returns the pane:list error', async () => {
    const res = await loadAgentRows(CTX, deps({
      paneList: async () => ({ ok: false, error: 'rt daemon unreachable at /s: connect ENOENT' }),
    }));
    expect(res).toEqual({ error: 'rt daemon unreachable at /s: connect ENOENT' });
  });

  test('a throwing paneList becomes an error, never a rejection', async () => {
    const res = await loadAgentRows(CTX, deps({ paneList: async () => { throw new Error('boom'); } }));
    expect(res).toEqual({ error: 'boom' });
  });

  test('agent:list failing still shows live panes', async () => {
    const res = await loadAgentRows(CTX, deps({
      paneList: async () => ({ ok: true, data: { panes: [livePane] } }),
      agentList: async () => ({ ok: false, error: 'nope' }),
      listRuns: async () => { throw new Error('runs down'); },
    }));
    expect('rows' in res && res.rows.map((r) => r.key)).toEqual(['s1']);
  });
});

describe('paneForResume', () => {
  test('paneForResume returns the resumed pane', async () => {
    let asked: unknown;
    const res = await paneForResume('ag1', deps({
      agentResume: async (a: unknown) => { asked = a; return { ok: true, data: { id: 'ag1', paneId: 'w1-3' } }; },
    }));
    expect(res).toEqual({ paneId: 'w1-3' });
    expect(asked).toEqual({ id: 'ag1' });
  });

  test('paneForResume on a headless record says so', async () => {
    const res = await paneForResume('ag1', deps({ agentResume: async () => ({ ok: true, data: { id: 'ag1' } }) }));
    expect(res).toEqual({ error: 'This session runs headless, so there is no pane to attach to' });
  });

  test('paneForResume passes the daemon error through', async () => {
    const res = await paneForResume('ag1', deps({
      agentResume: async () => ({ ok: false, error: 'no agent record for "ag1"' }),
    }));
    expect(res).toEqual({ error: 'no agent record for "ag1"' });
  });
});

describe('attachPlanFor', () => {
  test('attachPlanFor returns argv and env', async () => {
    let asked: unknown;
    const res = await attachPlanFor('w1-3', deps({
      paneAttachPlan: async (a: unknown) => {
        asked = a;
        return { ok: true, data: { argv: ['/bin/herdr', 'agent', 'attach', 'w1-3'], env: { HERDR_X: '1' } } };
      },
    }));
    expect(res).toEqual({ argv: ['/bin/herdr', 'agent', 'attach', 'w1-3'], env: { HERDR_X: '1' } });
    expect(asked).toEqual({ paneId: 'w1-3' });
  });

  test('attachPlanFor passes the daemon error through', async () => {
    const res = await attachPlanFor('w1-3', deps({ paneAttachPlan: async () => ({ ok: false, error: 'herdr not found' }) }));
    expect(res).toEqual({ error: 'herdr not found' });
  });
});
