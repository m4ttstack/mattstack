import { describe, test, expect, beforeAll } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { COMMANDS } from '../src/cli/main.ts';

const REPO_ROOT = join(import.meta.dir, '..');
const REFERENCE_DIR = join(REPO_ROOT, 'website', 'docs', 'reference');

/** Recursively collects every `*.mdx` file under `dir`, as paths relative to `REFERENCE_DIR`. */
function walkMdx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMdx(full));
    } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      out.push(relative(REFERENCE_DIR, full));
    }
  }
  return out;
}

// A page "in a command subdirectory" is any .mdx nested at least one level below
// reference/ (read-only/stacks.mdx, surgery/split.mdx, ...). The five contract
// pages (global-flags.mdx, exit-codes.mdx, ...) live directly in reference/ and
// have no path separator, so this structural check excludes them without having
// to name them - or the command-category directories - explicitly. Both tests
// below share this exact rule (`p.includes(sep)`), so a command page mistakenly
// placed directly under reference/ (no subdirectory) counts as neither covering
// its command nor exempt from the stale-page check.
let commandPages: { relPath: string; name: string }[] = [];

describe('docs coverage', () => {
  const commandNames = Object.keys(COMMANDS);

  // Walking the filesystem is deferred to beforeAll (rather than module load)
  // so a missing website/docs/reference/ directory fails as a named test with
  // a useful message instead of throwing at import time.
  beforeAll(() => {
    const allMdxPaths = walkMdx(REFERENCE_DIR);
    commandPages = allMdxPaths
      .filter((p) => p.includes(sep))
      .map((relPath) => ({ relPath, name: relPath.split(sep).pop()!.replace(/\.mdx$/, '') }));
  });

  test('every CLI command has a reference page', () => {
    const commandPageNames = new Set(commandPages.map((p) => p.name));
    const missing = commandNames.filter((name) => !commandPageNames.has(name));
    expect(
      missing,
      `commands with no reference page under website/docs/reference/<category>/: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  test('every reference page in a command subdirectory matches a real command', () => {
    const orphans = commandPages.filter((page) => !(page.name in COMMANDS)).map((page) => page.relPath);
    expect(
      orphans,
      `reference pages with no matching CLI command (stale, from a removed command?): ${orphans.join(', ')}`,
    ).toEqual([]);
  });
});
