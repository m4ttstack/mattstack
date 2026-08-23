import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Records what the target directory was filled from, and when. */
const MARKER = 'migrated-from.json';

export type MigrationResult =
  /** Nothing to move: no legacy directory, or it holds no files. */
  | { kind: 'no-legacy' }
  /** The copy happened in this call. */
  | { kind: 'migrated'; files: number }
  /** A previous call already moved this exact legacy directory here. */
  | { kind: 'already-migrated' }
  /**
   * Both directories hold files and no marker says they are related. The
   * caller uses the target and names the legacy path once; merging two live
   * stack stores would be a guess about which copy is current.
   */
  | { kind: 'target-occupied'; legacyDir: string };

/** Every regular file under `dir`, as paths relative to it. Missing dir = none. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out;
}

function readMarker(targetDir: string): { from?: string } | null {
  try {
    return JSON.parse(readFileSync(join(targetDir, MARKER), 'utf8')) as { from?: string };
  } catch {
    return null;
  }
}

/**
 * Move gitq's CLI files from the pre-app-root location into the app root, once.
 *
 * Copy-only by design: the legacy directory is left exactly as it was, so a
 * migration that turns out wrong costs nothing to walk back. The copy is
 * verified file by file before the marker is written, and the marker is what
 * makes a second run a silent no-op rather than a repeated "you have two
 * directories" warning.
 *
 * A verification failure throws with both paths named and writes no marker:
 * the legacy copy is still intact, and the next run sees an unmarked occupied
 * target rather than trusting a partial one.
 */
export function migrateLegacyConfigDir(legacyDir: string, targetDir: string): MigrationResult {
  const legacyFiles = filesUnder(legacyDir);
  if (legacyFiles.length === 0) return { kind: 'no-legacy' };

  if (filesUnder(targetDir).length > 0) {
    return readMarker(targetDir)?.from === legacyDir ? { kind: 'already-migrated' } : { kind: 'target-occupied', legacyDir };
  }

  mkdirSync(targetDir, { recursive: true });
  cpSync(legacyDir, targetDir, { recursive: true });

  for (const rel of legacyFiles) {
    const from = join(legacyDir, rel);
    const to = join(targetDir, rel);
    if (!existsSync(to) || statSync(to).size !== statSync(from).size) {
      throw new Error(`gitq: copying ${legacyDir} to ${targetDir} left ${rel} incomplete; the original is untouched, move it by hand`);
    }
  }

  writeFileSync(join(targetDir, MARKER), JSON.stringify({ from: legacyDir, at: new Date().toISOString() }, null, 2) + '\n');
  return { kind: 'migrated', files: legacyFiles.length };
}
