// Runs only in the test's isolated child, like agent-action-lifecycle.ts:
// module replacements cannot leak into other gitq tests, and Bun.serve
// captures the real route without binding a socket. Only the harness
// selection and the launch IO are stubbed; the route, launchAction and the
// job-state writes are the real ones.
import { mock, spyOn } from 'bun:test';
import { join, resolve } from 'node:path';

const root = process.argv[2]!;
const source = resolve(import.meta.dir, '../../src');
const repoPath = join(root, 'repo');
const data = await import(join(source, 'server/data.ts'));
const herdr = await import(join(source, 'server/herdr.ts'));
const jobs: typeof import('../../src/server/job-state.ts') = await import(join(source, 'server/job-state.ts'));
mock.module(join(source, 'server/config.ts'), () => ({
  loadConfig: () => ({ repos: [{ path: repoPath, name: 'fixture' }], port: 0, herdrWorkspace: 'fixture-jobs' }),
}));
mock.module(join(source, 'server/client-assets.ts'), () => ({ getClientAssets: async () => ({ appJs: '' }) }));
mock.module(join(source, 'server/data.ts'), () => ({
  ...data,
  collectAllRepos: async () => [],
  isTrackedStack: async () => true,
}));

const STALE = { harness: 'codex', agentId: 'agent-0', sessionId: 'thread-0' };
let selection: () => Promise<string | undefined> = async () => 'codex';
let startAnswer: { ok: boolean; error?: string } = { ok: true };
const seenAtStart: unknown[] = [];
mock.module(join(source, 'server/herdr.ts'), () => ({
  ...herdr,
  selectActionHarness: () => selection(),
  defaultActionLaunchIo: {
    codexSkillsDir: () => '/codex/skills',
    exists: () => true,
    rtRepo: () => 'remote:host/repo',
    agentStart: async (payload: { tab?: string }) => {
      const action = payload.tab!.split(' ').at(-1)!;
      seenAtStart.push({ action, launch: jobs.readJobStates().find((j) => j.action === action)?.launch ?? null });
      if (!startAnswer.ok) return startAnswer;
      return {
        ok: true,
        data: { id: 'agent-1', repo: 'remote:host/repo', cwd: repoPath, provider: 'codex', surface: 'herdr', sessionId: 'thread-1', tabId: 'tab-1', workspaceId: 'ws-1', createdAt: 1 },
      };
    },
  },
  launchInWorkspace: async () => {
    throw new Error('a harness launch must not run a herdr pane command');
  },
}));
let fetchRoute: (request: Request) => Promise<Response>;
spyOn(Bun, 'serve').mockImplementation((options: any) => {
  fetchRoute = options.fetch;
  return { stop() {} } as any;
});
await import(join(source, 'server/server.ts'));

function stale(action: 'sync' | 'publish' | 'absorb') {
  jobs.writeJobState(jobs.jobFilePath(repoPath, 'fixture-stack', action), {
    status: 'done', repoPath, stack: 'fixture-stack', action, launch: STALE,
  });
}
async function action(action: string) {
  const response = await fetchRoute(new Request('http://localhost/action', {
    method: 'POST',
    headers: { host: 'localhost', 'content-type': 'application/json' },
    body: JSON.stringify({ repoPath, stack: 'fixture-stack', action }),
  }));
  return { status: response.status, body: await response.text() };
}
const job = (action: string) => jobs.readJobStates().find((j) => j.action === action);

stale('sync');
const started = await action('sync');
const startedJob = job('sync');

stale('publish');
startAnswer = { ok: false, error: 'tab fixture:fixture-stack publish already open; focused it' };
const focused = await action('publish');
const focusedJob = job('publish');

stale('absorb');
selection = async () => {
  throw new Error('No agent is turned on, so gitq cannot start one. Turn one on in setup.');
};
const refused = await action('absorb');
const refusedJob = job('absorb');

console.log(JSON.stringify({ started, startedJob, focused, focusedJob, refused, refusedJob, seenAtStart }));
