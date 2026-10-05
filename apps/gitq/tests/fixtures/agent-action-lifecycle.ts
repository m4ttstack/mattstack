// Runs only in the test's isolated child. Module replacements cannot leak
// into the other gitq tests, and Bun.serve captures the real route without
// binding any socket. No route or job-state implementation is replaced.
import { mock, spyOn } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.argv[2]!;
const source = resolve(import.meta.dir, '../../src');
const repoPath = join(root, 'repo');
const data = await import(join(source, 'server/data.ts'));
const herdr = await import(join(source, 'server/herdr.ts'));
const jobs: typeof import('../../src/server/job-state.ts') = await import(join(source, 'server/job-state.ts'));
const { actionPrompt, buildPaneCommand, tabLabel } = herdr;
mock.module(join(source, 'server/config.ts'), () => ({
  loadConfig: () => ({ repos: [{ path: repoPath, name: 'fixture' }], port: 0, herdrWorkspace: 'fixture-jobs' }),
}));
mock.module(join(source, 'server/client-assets.ts'), () => ({ getClientAssets: async () => ({ appJs: '' }) }));
mock.module(join(source, 'server/data.ts'), () => ({
  ...data,
  collectAllRepos: async () => [],
  isTrackedStack: async () => true,
}));
let launches = 0;
let failLaunch = false;
const focused: string[] = [];
const launchesObserved: Array<{ options: { paneCommand: string }; seeded: ReturnType<typeof jobs.readJobStates> }> = [];
mock.module(join(source, 'server/herdr.ts'), () => ({
  ...herdr,
  actionPrompt, buildPaneCommand, tabLabel,
  focusTab: async (tab: string) => { focused.push(tab); },
  launchInWorkspace: async (options: { paneCommand: string }) => {
    launches++;
    launchesObserved.push({ options, seeded: jobs.readJobStates() });
    if (failLaunch) throw new Error('fixture launch refused');
    return { tabId: 'fixture-tab', workspaceId: 'fixture-workspace', focusedExisting: false };
  },
}));
let fetchRoute: (request: Request) => Promise<Response>;
spyOn(Bun, 'serve').mockImplementation((options: any) => {
  fetchRoute = options.fetch;
  return { stop() {} } as any;
});
await import(join(source, 'server/server.ts'));
async function action(action = 'sync') {
  const response = await fetchRoute(new Request('http://localhost/action', {
    method: 'POST',
    headers: { host: 'localhost', 'content-type': 'application/json' },
    body: JSON.stringify({ repoPath, stack: 'fixture-stack', action }),
  }));
  return { status: response.status, body: await response.text() };
}
const started = await action();
// Follow the paths handed to the actual skill rather than independently
// deriving a second path that could hide a broken launch/report contract.
const handoff = /--state ([^ ]+) --status-bin ([^']+)'$/.exec(launchesObserved[0]!.options.paneCommand);
if (!handoff) throw new Error('The action did not hand off state and status command paths');
const [, statePath, statusBin] = handoff;
const initial = JSON.parse(readFileSync(statePath!, 'utf8'));
function report(status: string, detail?: string) {
  const result = spawnSync(process.execPath, [statusBin!, 'job-status', statePath!, status, ...(detail ? [detail] : [])], {
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'fixture-claude-session' }, encoding: 'utf8', timeout: 10_000,
  });
  if (result.status !== 0) throw new Error(`status CLI failed: ${result.stderr}`);
  return JSON.parse(readFileSync(statePath!, 'utf8'));
}
const working = report('working', 'reviewing changes');
const dedup = await action();
const afterDedup = JSON.parse(readFileSync(statePath!, 'utf8'));
const done = report('done');
failLaunch = true;
const failed = await action('publish');
const failedJob = jobs.readJobStates().find((job) => job.action === 'publish');
console.log(JSON.stringify({ started, initial, working, dedup, afterDedup, done, failed, failedJob, launches, focused, launchesObserved }));
