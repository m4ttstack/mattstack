import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

function run(cwd: string, args: string[]): string {
  const p = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (p.exitCode !== 0)
    throw new Error(`git ${args.join(' ')}: ${p.stderr.toString()}`);
  return p.stdout.toString().trim();
}

export function commit(
  root: string,
  files: Record<string, string>,
  msg = 'change'
): string {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  run(root, ['add', '-A']);
  run(root, [
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    msg,
  ]);
  return run(root, ['rev-parse', 'HEAD']);
}

export function gitRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'deck-git-'));
  run(root, ['init', '-q', '-b', 'main']);
  commit(root, files, 'init');
  return root;
}
