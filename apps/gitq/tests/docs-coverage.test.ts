import { describe, test, expect } from 'bun:test';
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

const allMdxPaths = walkMdx(REFERENCE_DIR);
const mdxBasenames = new Set(allMdxPaths.map((p) => p.split(sep).pop()!.replace(/\.mdx$/, '')));

// A page "in a command subdirectory" is any .mdx nested at least one level below
// reference/ (read-only/stacks.mdx, surgery/split.mdx, ...). The five contract
// pages (global-flags.mdx, exit-codes.mdx, ...) live directly in reference/ and
// have no path separator, so this structural check excludes them without having
// to name them - or the command-category directories - explicitly.
const commandPages = allMdxPaths
  .filter((p) => p.includes(sep))
  .map((relPath) => ({ relPath, name: relPath.split(sep).pop()!.replace(/\.mdx$/, '') }));

describe('docs coverage', () => {
  const commandNames = Object.keys(COMMANDS);

  test('every CLI command has a reference page', () => {
    const missing = commandNames.filter((name) => !mdxBasenames.has(name));
    expect(
      missing,
      `commands with no reference page under website/docs/reference/: ${missing.join(', ')}`,
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
