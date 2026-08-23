import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateLegacyConfigDir } from '../src/core/config-migration.ts';

let dir: string;
let legacy: string;
let target: string;

/** A legacy dir with the shape a real one has: stacks, an operation log, settings. */
function seedLegacy(): { stackA: string; stackB: string; log: string } {
  mkdirSync(join(legacy, 'stacks'), { recursive: true });
  const stackA = JSON.stringify({ stacks: [{ stackName: 'demo', root: 'main', nodes: [{ branch: 'feat-a', parent: 'main' }] }] });
  const stackB = JSON.stringify({ stacks: [{ stackName: 'other', root: 'trunk', nodes: [{ branch: 'feat-b', parent: 'trunk' }] }] });
  const log = JSON.stringify([{ op: 'track', at: 1 }, { op: 'sync', at: 2 }]);
  writeFileSync(join(legacy, 'stacks', '10e91a6f238e7615.json'), stackA);
  writeFileSync(join(legacy, 'stacks', '701a8a1dba32ab39.json'), stackB);
  writeFileSync(join(legacy, 'stacks', '6a786895cb7e5f70.json.bak'), '{"stale":true}');
  writeFileSync(join(legacy, 'operation-log.json'), log);
  writeFileSync(join(legacy, 'settings.json'), JSON.stringify({ maxWorkSlots: 5 }));
  return { stackA, stackB, log };
}

/** Every regular file under `dir`, relative, sorted -- the comparison surface. */
function listFiles(root: string, prefix = ''): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listFiles(join(root, e.name), join(prefix, e.name)) : [join(prefix, e.name)]))
    .sort();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gitq-migration-'));
  legacy = join(dir, 'config-gitq');
  target = join(dir, 'mattstack-gitq');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('legacy config migration', () => {
  test('copies a populated legacy dir and leaves the original in place', () => {
    const seeded = seedLegacy();
    const before = listFiles(legacy);

    const result = migrateLegacyConfigDir(legacy, target);

    expect(result).toEqual({ kind: 'migrated', files: 5 });
    // The stack list must be identical, not merely present.
    expect(listFiles(target).filter((f) => f !== 'migrated-from.json')).toEqual(before);
    expect(readFileSync(join(target, 'stacks', '10e91a6f238e7615.json'), 'utf8')).toBe(seeded.stackA);
    expect(readFileSync(join(target, 'stacks', '701a8a1dba32ab39.json'), 'utf8')).toBe(seeded.stackB);
    expect(readFileSync(join(target, 'operation-log.json'), 'utf8')).toBe(seeded.log);
    // Copy, never move: the original is the walk-back.
    expect(listFiles(legacy)).toEqual(before);
  });

  test('a second run is a silent no-op, and copies nothing new', () => {
    seedLegacy();
    migrateLegacyConfigDir(legacy, target);
    const afterFirst = listFiles(target);
    // A file written into the new root after the migration must survive a rerun.
    writeFileSync(join(target, 'config.json'), '{"repos":[]}');

    expect(migrateLegacyConfigDir(legacy, target)).toEqual({ kind: 'already-migrated' });
    expect(listFiles(target)).toEqual([...afterFirst, 'config.json'].sort());
  });

  test('an unmarked, already-populated target is used as-is and never merged into', () => {
    seedLegacy();
    mkdirSync(join(target, 'stacks'), { recursive: true });
    writeFileSync(join(target, 'stacks', 'newer.json'), '{"stacks":[]}');

    expect(migrateLegacyConfigDir(legacy, target)).toEqual({ kind: 'target-occupied', legacyDir: legacy });
    expect(listFiles(target)).toEqual([join('stacks', 'newer.json')]);
  });

  test('no legacy dir, or an empty one, is nothing to do', () => {
    expect(migrateLegacyConfigDir(join(dir, 'absent'), target)).toEqual({ kind: 'no-legacy' });
    mkdirSync(join(legacy, 'stacks'), { recursive: true });
    expect(migrateLegacyConfigDir(legacy, target)).toEqual({ kind: 'no-legacy' });
    expect(existsSync(join(target, 'migrated-from.json'))).toBe(false);
  });

  test('a target populated only by empty directories still counts as free', () => {
    seedLegacy();
    mkdirSync(join(target, 'state', 'jobs'), { recursive: true });
    expect(migrateLegacyConfigDir(legacy, target).kind).toBe('migrated');
    expect(readFileSync(join(target, 'settings.json'), 'utf8')).toBe(JSON.stringify({ maxWorkSlots: 5 }));
  });

  test('the marker records where the files came from', () => {
    seedLegacy();
    migrateLegacyConfigDir(legacy, target);
    expect(JSON.parse(readFileSync(join(target, 'migrated-from.json'), 'utf8')).from).toBe(legacy);
  });

  // A marker naming a different legacy dir must not be read as "already done".
  test('a marker from some other directory does not suppress the warning', () => {
    seedLegacy();
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'migrated-from.json'), JSON.stringify({ from: '/somewhere/else' }));
    expect(migrateLegacyConfigDir(legacy, target)).toEqual({ kind: 'target-occupied', legacyDir: legacy });
  });
});
