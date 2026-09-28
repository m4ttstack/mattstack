import { realpathSync } from 'fs';
import { relative } from 'path';

import type { RunMode } from '../api/state.ts';
import { git } from '../edge/source.ts';
import { setLastDeploy, type AppRecord } from './records.ts';

export interface NewCode {
  deployed: string;
  head: string;
}

const SHORT = 7;
const diffs = new Map<string, { key: string; changed: boolean }>();
const warned = new Set<string>();

export function resetNewCodeCache(): void {
  diffs.clear();
  warned.clear();
}

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[new-code] ${message}`);
}

// Bun.spawnSync throws ENOENT when its cwd is gone, so a disposed checkout
// must come back as null here rather than escaping into boot or a poll.
function checkout(dir: string): { root: string; head: string } | null {
  try {
    const res = git(['rev-parse', '--show-toplevel', 'HEAD'], dir);
    const [root, head] = res.stdout.trim().split('\n');
    if (res.code !== 0 || !root || !head) return null;
    return { root, head };
  } catch {
    return null;
  }
}

function writeStamp(name: string, sha: string, now: () => Date): void {
  try {
    setLastDeploy(name, { sha, at: now().toISOString() });
  } catch (err) {
    warnOnce(`write|${name}`, `${name}: cannot record deploy stamp: ${err}`);
  }
}

export function stampDeploy(
  name: string,
  dir: string,
  now: () => Date = () => new Date()
): void {
  const co = checkout(dir);
  if (!co) {
    warnOnce(`stamp|${name}|${dir}`, `${name}: ${dir} is not a git checkout`);
    return;
  }
  writeStamp(name, co.head, now);
}

function touchesApp(
  name: string,
  sha: string,
  co: { root: string; head: string },
  dir: string
): boolean {
  let appDir: string;
  try {
    appDir = relative(co.root, realpathSync(dir)) || '.';
  } catch {
    warnOnce(`path|${name}|${dir}`, `${name}: cannot resolve ${dir}`);
    return false;
  }
  let code: number;
  try {
    code = git(
      ['diff', '--quiet', sha, co.head, '--', appDir, 'packages', 'bun.lock'],
      co.root
    ).code;
  } catch {
    code = -1;
  }
  if (code === 1) return true;
  if (code !== 0)
    warnOnce(`diff|${name}|${sha}`, `${name}: git diff from ${sha} failed`);
  return false;
}

// The first sighting of an app baselines at HEAD: what it loaded before this
// stamp existed is unknowable, so it starts with no offer.
export function newCodeFor(
  record: AppRecord,
  now: () => Date = () => new Date()
): NewCode | null {
  const dir = record.dev?.workingDirectory;
  if (!dir) return null;
  const co = checkout(dir);
  if (!co) {
    warnOnce(
      `head|${record.name}|${dir}`,
      `${record.name}: ${dir} is not a git checkout`
    );
    return null;
  }
  const sha = record.lastDeploy?.sha;
  if (!sha) {
    writeStamp(record.name, co.head, now);
    return null;
  }
  if (sha === co.head) return null;
  const key = `${sha}|${co.head}`;
  const hit = diffs.get(record.name);
  const changed =
    hit?.key === key ? hit.changed : touchesApp(record.name, sha, co, dir);
  diffs.set(record.name, { key, changed });
  return changed
    ? { deployed: sha.slice(0, SHORT), head: co.head.slice(0, SHORT) }
    : null;
}

export function stampSelfOnBoot(opts: {
  devMode: boolean;
  runMode: RunMode;
  record: AppRecord | undefined;
}): void {
  const dir = opts.record?.dev?.workingDirectory;
  if (!opts.devMode || opts.runMode !== 'source' || !opts.record || !dir)
    return;
  stampDeploy(opts.record.name, dir);
}
