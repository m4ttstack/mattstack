import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from 'bun:test';

const BOARD = join(import.meta.dir, '..', '..');
const ROOTS = ['src', 'bin', 'scripts'];
const SKIP = new Set([join('src', 'latch', 'gateway.ts')]);
const CALLS = [
  'new GitLabProvider(',
  'new NoteMutator(',
  'new MRDetailFetcher(',
  'latchGateway(',
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === 'node_modules'
        ? []
        : tsFiles(path);
    }
    return path.endsWith('.ts') ? [path] : [];
  });
}

function argsAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

test('no board code builds a GitLab client from a hard-coded forge', () => {
  const offenders: string[] = [];
  let seen = 0;
  for (const root of ROOTS) {
    for (const file of tsFiles(join(BOARD, root))) {
      const rel = relative(BOARD, file);
      if (SKIP.has(rel)) continue;
      const text = readFileSync(file, 'utf8');
      for (const call of CALLS) {
        let at = text.indexOf(call);
        while (at !== -1) {
          seen++;
          const args = argsAt(text, at + call.length - 1);
          if (!args.includes('gitlabOnly(')) {
            const line = text.slice(0, at).split('\n').length;
            offenders.push(`${rel}:${line} ${call}`);
          }
          at = text.indexOf(call, at + call.length);
        }
      }
    }
  }
  expect(seen).toBeGreaterThan(0);
  expect(offenders).toEqual([]);
});
