import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';

import { stageFiles } from '../latch/stage.ts';

const made: string[] = [];
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

const file = (filename: string, text: string) => ({
  filename,
  bytes: new TextEncoder().encode(text),
  contentType: 'image/gif',
  alt: filename,
});

test('staging creates a missing evidence folder and removes only its own subfolder', async () => {
  const base = mkdtempSync(join(tmpdir(), 'latch-stage-'));
  made.push(base);
  const root = join(base, 'evidence', 'board-latch');
  const staged = await stageFiles([file('a.gif', 'one')], { root });
  expect(statSync(staged.dir).mode & 0o777).toBe(0o700);
  expect(staged.dir.startsWith(root)).toBe(true);
  expect(staged.paths).toEqual([
    { path: join(staged.dir, 'a.gif'), name: 'a.gif' },
  ]);
  expect(readFileSync(staged.paths[0]!.path, 'utf8')).toBe('one');
  writeFileSync(join(root, 'sibling.txt'), 'keep');
  await staged.cleanup();
  expect(existsSync(staged.dir)).toBe(false);
  expect(readFileSync(join(root, 'sibling.txt'), 'utf8')).toBe('keep');
});

test('default root follows HOME at call time', async () => {
  const home = mkdtempSync(join(tmpdir(), 'latch-home-'));
  made.push(home);
  const prior = process.env.HOME;
  process.env.HOME = home;
  try {
    const staged = await stageFiles([file('b.gif', 'x')]);
    expect(
      staged.dir.startsWith(join(home, '.mattstack', 'evidence', 'board-latch'))
    ).toBe(true);
    await staged.cleanup();
  } finally {
    process.env.HOME = prior;
  }
});
