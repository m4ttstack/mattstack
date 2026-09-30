import { readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { expect, test } from 'bun:test';

import { ROOT } from './helpers.ts';

// A test that resolves the repo root reads other packages from disk, which
// turbo's per-package hash cannot see; it must declare $TURBO_ROOT$ inputs.
const REACHES_ROOT =
  /import\.meta\.dirname,\s*(['"])\.\.\1,\s*\1\.\.\1,\s*\1\.\.\1/;

function packageOf(file: string): string {
  const parts = relative(ROOT, file).split(sep);
  const kind = parts[0]!;
  const name = parts[1]!;
  const pkg = JSON.parse(
    readFileSync(join(ROOT, kind, name, 'package.json'), 'utf8')
  );
  return pkg.name as string;
}

test('every test that reads outside its package declares $TURBO_ROOT$ inputs', () => {
  const turbo = JSON.parse(readFileSync(join(ROOT, 'turbo.json'), 'utf8'));
  const glob = new Bun.Glob('{apps,packages}/*/**/*.test.{ts,tsx}');
  const offenders: string[] = [];
  for (const rel of glob.scanSync(ROOT)) {
    if (rel.includes('/node_modules/')) continue;
    const file = join(ROOT, rel);
    if (!REACHES_ROOT.test(readFileSync(file, 'utf8'))) continue;
    const inputs: string[] =
      turbo.tasks[`${packageOf(file)}#test`]?.inputs ?? [];
    if (!inputs.some(i => i.startsWith('$TURBO_ROOT$/'))) offenders.push(rel);
  }
  expect(offenders).toEqual([]);
});

// test-scope.ts skips the unit shards on an apps-only PR, so a guard over
// apps/*/skills runs on that PR only through this always-run root task.
test('the deps.lock skills-tree guard runs in //#turbo:test and rehashes on any apps skills edit', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  expect(pkg.scripts['turbo:test'].split(' ')).toContain('./lib/__tests__/deps-lock-live.test.ts');
  const turbo = JSON.parse(readFileSync(join(ROOT, 'turbo.json'), 'utf8'));
  expect(turbo.tasks['//#turbo:test'].inputs).toEqual(
    expect.arrayContaining([
      'rt-tray/deps.lock',
      'lib/__tests__/deps-lock-live.test.ts',
      'lib/bundle-layout.ts',
      'lib/skills/sources.ts',
      '$TURBO_ROOT$/apps/*/skills/**',
    ])
  );
});

test('the settings bypass guard runs in //#turbo:test and rehashes on every root it scans', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  expect(pkg.scripts['turbo:test'].split(' ')).toContain(
    './lib/__tests__/no-settings-bypass.test.ts'
  );
  const turbo = JSON.parse(readFileSync(join(ROOT, 'turbo.json'), 'utf8'));
  expect(turbo.tasks['//#turbo:test'].inputs).toEqual(
    expect.arrayContaining([
      'lib/__tests__/no-settings-bypass.test.ts',
      'cli.ts',
      'commands/**/*.{ts,tsx,mts,cts,js,mjs}',
      'lib/**/*.{ts,tsx,mts,cts,js,mjs}',
      'scripts/**/*.{ts,tsx,mts,cts,js,mjs}',
      '$TURBO_ROOT$/apps/**/*.{ts,tsx,mts,cts,js,mjs}',
      '$TURBO_ROOT$/packages/**/*.{ts,tsx,mts,cts,js,mjs}',
      '$TURBO_ROOT$/extensions/**/*.{ts,tsx,mts,cts,js,mjs}',
      '$TURBO_ROOT$/plugins/**/*.{ts,tsx,mts,cts,js,mjs}',
    ])
  );
});

test('the board skills drift guard runs in //#turbo:test and rehashes on its sources', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  expect(pkg.scripts['turbo:test'].split(' ')).toContain(
    './lib/__tests__/no-board-skills-drift.test.ts'
  );
  const turbo = JSON.parse(readFileSync(join(ROOT, 'turbo.json'), 'utf8'));
  expect(turbo.tasks['//#turbo:test'].inputs).toEqual(
    expect.arrayContaining([
      'lib/__tests__/no-board-skills-drift.test.ts',
      'lib/skills/expand.ts',
      'lib/skills/mcp-lint.ts',
      'lib/mcp/**',
      'commands/skills-expand.ts',
      '$TURBO_ROOT$/apps/board/skills/**',
      '$TURBO_ROOT$/apps/board/skills-src/**',
      '$TURBO_ROOT$/plugins/mattstack/attachments/**',
      '!$TURBO_ROOT$/**/node_modules/**',
      '!$TURBO_ROOT$/**/.turbo/**',
      '!$TURBO_ROOT$/**/dist/**',
      '!$TURBO_ROOT$/**/dist-bin/**',
    ])
  );
});
