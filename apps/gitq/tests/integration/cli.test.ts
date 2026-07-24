import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSandboxRepo, cleanupRepo, buildLinearStack } from './helpers.ts';
import { setConfigDir } from '../../src/core/config-paths.ts';
import { saveStore } from '../../src/core/persistence.ts';
import { OperationLog } from '../../src/core/operation-log.ts';
import { StackManager } from '../../src/core/stack-manager.ts';
import type { Stack } from '../../src/core/types.ts';

const BIN = join(import.meta.dir, '../../bin/gitq');

export async function runCli(args: string[], cwd: string, configDir: string) {
  const proc = Bun.spawn(['bun', BIN, ...args], {
    cwd,
    env: { ...process.env, GITQ_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

// Dirs created by makeRepo() in the current test, cleaned up in afterEach.
// Tests added later in this file inherit cleanup for free by going through makeRepo().
let dirsToClean: string[] = [];

/** Create a sandbox repo + sibling config dir, registering both for afterEach cleanup. */
async function makeRepo() {
  const repo = await createSandboxRepo();
  const configDir = `${repo.dir}-config`;
  dirsToClean.push(repo.dir, configDir);
  return { repo, configDir };
}

afterEach(async () => {
  await Promise.all(dirsToClean.map((dir) => cleanupRepo(dir)));
  dirsToClean = [];
});

/**
 * Create a sandbox repo + sibling config dir (via makeRepo()), build a real
 * linear stack of `depth` branches in it, and persist that stack to the
 * sibling config dir via saveStore. `setConfigDir` is realpath-safe here
 * because `repo.dir` already comes from createSandboxRepo's realpathSync.
 */
async function makeRepoWithStack(depth = 2): Promise<{ repo: Awaited<ReturnType<typeof createSandboxRepo>>; configDir: string; stack: Stack }> {
  const { repo, configDir } = await makeRepo();
  const { stack } = await buildLinearStack(repo.dir, repo.git, depth);
  setConfigDir(configDir);
  await saveStore(repo.dir, { repoPath: repo.dir, remoteUrl: '', stacks: [stack] });
  return { repo, configDir, stack };
}

describe('gitq CLI', () => {
  test('stacks --json on a repo with no stacks', async () => {
    const { repo, configDir } = await makeRepo();
    const { stdout, exitCode } = await runCli(['stacks', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ stacks: [] });
  });

  test('unknown command exits 1', async () => {
    const { repo, configDir } = await makeRepo();
    const { exitCode, stderr } = await runCli(['nonsense'], repo.dir, configDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown command');
  });

  test('-C <repoDir> resolves context from a different cwd', async () => {
    const { repo, configDir } = await makeRepo();
    // Assumes the temp dir's parent (join(repo.dir, '..')) is not itself inside a git repo,
    // otherwise `-C` context resolution could pick up that outer repo instead.
    const { stdout, exitCode } = await runCli(['-C', repo.dir, 'stacks', '--json'], join(repo.dir, '..'), configDir);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ stacks: [] });
  });

  test('diagnose --json reports situations for a healthy stack', async () => {
    const { repo, configDir, stack } = await makeRepoWithStack(2);
    const { stdout, exitCode } = await runCli(['diagnose', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.stacks).toHaveLength(1);
    expect(parsed.stacks[0].stackName).toBe(stack.stackName);
    const nodes = parsed.stacks[0].diagnostics.nodes;
    expect(nodes.length).toBe(2);

    // Value-level assertions on the flattened node (nodes.length alone doesn't
    // catch a broken/empty NodeDirective surviving the Map -> array flatten).
    const firstNode = nodes[0];
    expect(firstNode.branch).toBe(stack.nodes[0]!.branch);
    expect(typeof firstNode.situation).toBe('string');
    expect(firstNode.situation.length).toBeGreaterThan(0);
    // statusLine is the field NodeDirective guarantees non-null (`badge` is
    // `{ ... } | null`); assert on the one the type actually promises.
    expect(typeof firstNode.statusLine).toBe('string');
    expect(firstNode.statusLine.length).toBeGreaterThan(0);
  });

  test('preflight --json reports a clean report for a healthy stack', async () => {
    const { repo, configDir } = await makeRepoWithStack(2);
    const { stdout, exitCode } = await runCli(['preflight', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.stacks).toHaveLength(1);
    expect(parsed.stacks[0].report.dirty).toBe(false);
    expect(parsed.stacks[0].report.conflictBranches).toEqual([]);
  });

  test('log --json on a fresh config dir returns no entries', async () => {
    const { repo, configDir } = await makeRepo();
    const { stdout, exitCode } = await runCli(['log', '--json'], repo.dir, configDir);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ entries: [] });
  });

  test('log surfaces a populated operation log entry', async () => {
    const { repo, configDir } = await makeRepo();
    // Same construction as tests/operation-log.test.ts: OperationLog.create + save.
    // setConfigDir here (in-process) so the save lands in the sibling config dir
    // that the spawned CLI below reads via GITQ_CONFIG_DIR.
    setConfigDir(configDir);

    let stack = StackManager.createStack('test-stack', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    const branchSnapshots = { main: 'sha-main', 'feat/a': 'sha-a' };
    const entry = OperationLog.create('sync', stack, branchSnapshots);
    await OperationLog.save(entry);

    const { stdout: jsonOut, exitCode: jsonExit } = await runCli(['log', '--json'], repo.dir, configDir);
    expect(jsonExit).toBe(0);
    const parsed = JSON.parse(jsonOut);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].operation).toBe('sync');
    expect(Object.keys(parsed.entries[0].branchSnapshots)).toEqual(['main', 'feat/a']);

    const { stdout: humanOut, exitCode: humanExit } = await runCli(['log'], repo.dir, configDir);
    expect(humanExit).toBe(0);
    expect(humanOut).toContain('sync');
  });

  test('track/add/remove/untrack lifecycle', async () => {
    const { repo, configDir } = await makeRepo();
    await runCli(['track', 'mystack', '--root', 'main'], repo.dir, configDir);
    const add = await runCli(['add', 'feature-a', '--parent', 'main'], repo.dir, configDir);
    expect(add.exitCode).toBe(0);
    const list = JSON.parse((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout);
    expect(list.stacks[0].nodes.map((n: { branch: string }) => n.branch)).toEqual(['feature-a']);
    await runCli(['remove', 'feature-a'], repo.dir, configDir);
    await runCli(['untrack', 'mystack'], repo.dir, configDir);
    const after = JSON.parse((await runCli(['stacks', '--json'], repo.dir, configDir)).stdout);
    expect(after.stacks).toEqual([]);
  });

  test('add on a 2-stack repo without --stack exits 1 and lists stack names', async () => {
    const { repo, configDir } = await makeRepo();
    await runCli(['track', 'stack-one', '--root', 'main'], repo.dir, configDir);
    await runCli(['track', 'stack-two', '--root', 'main'], repo.dir, configDir);
    const { exitCode, stderr } = await runCli(['add', 'feature-a', '--parent', 'main'], repo.dir, configDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('stack-one');
    expect(stderr).toContain('stack-two');
  });
});
