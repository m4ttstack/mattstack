import { readFileSync } from 'fs';
import { join } from 'path';
import { getSetting } from '@mattstack/rt-client';
import { APP_ROOT } from '../core/app-root.ts';
import { warnStoreFallback } from '../core/settings-fallback-warn.ts';

type GetSettingFn = typeof getSetting;

export interface RepoEntry {
  path: string;
  name: string;
}

export interface BoardConfig {
  repos: RepoEntry[];
  port: number;
  herdrWorkspace: string;
}

/*
 * There is deliberately no forge host here. The board resolves each repo's
 * provider and base URL from that repo's own remote, so a board-wide host
 * could never be right for more than one of them, and a self-hosted instance
 * is named once in `gitq.forges` for the whole of gitq rather than again per
 * board. A `gitlabHost` key sat here validated and unread until MAT-19; an
 * on-disk config still carrying it loads fine, ignored.
 */

export const CONFIG_PATH = join(APP_ROOT, 'config.json');

function basenameOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Shared by both sources: a `gitq.board` store value gets the same shape and defaults checked. */
function validateBoardConfig(parsed: unknown, source: string): BoardConfig {
  if (!parsed || typeof parsed !== 'object') throw new Error(`${source} must be a JSON object`);
  const cfg = parsed as { repos?: unknown; port?: unknown; herdrWorkspace?: unknown };

  if (!Array.isArray(cfg.repos) || cfg.repos.length === 0) {
    throw new Error(`${source} needs a non-empty "repos" array`);
  }
  const repos: RepoEntry[] = cfg.repos.map((entry, i) => {
    if (!entry || typeof entry !== 'object') throw new Error(`${source} repos[${i}] must be an object`);
    const { path, name } = entry as { path?: unknown; name?: unknown };
    if (typeof path !== 'string' || path === '') throw new Error(`${source} repos[${i}] needs a "path" string`);
    if (name !== undefined && typeof name !== 'string')
      throw new Error(`${source} repos[${i}].name must be a string`);
    return { path, name: name ?? basenameOf(path) };
  });

  const port = cfg.port === undefined ? 11008 : cfg.port;
  if (typeof port !== 'number') throw new Error(`${source} "port" must be a number`);
  const herdrWorkspace = cfg.herdrWorkspace === undefined ? 'gitq' : cfg.herdrWorkspace;
  if (typeof herdrWorkspace !== 'string') throw new Error(`${source} "herdrWorkspace" must be a string`);

  return { repos, port, herdrWorkspace };
}

/** Pure string-to-config parse so tests never touch the filesystem. */
export function parseConfig(raw: string): BoardConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('config.json is not valid JSON');
  }
  return validateBoardConfig(parsed, 'config.json');
}

/**
 * The board config, from `gitq.board` in the settings store once owned,
 * config.json otherwise. Ownership is wholesale like `gitq.forges`: the store
 * value is one object, so an owning write replaces `repos`/`port`/
 * `herdrWorkspace` together rather than merging field by field with the file.
 * A resolver throw (unreadable/malformed store file, never the daemon)
 * degrades to the file after one warning. `$PORT` still wins over whichever
 * source answers here -- that precedence is applied by the caller in
 * server.ts, unchanged from before this store existed.
 */
export function loadConfig(resolve: GetSettingFn = getSetting, configPath: string = CONFIG_PATH): BoardConfig {
  let store: unknown;
  try {
    store = resolve<unknown>('gitq.board').value;
  } catch (err) {
    warnStoreFallback('gitq.board', 'config.json', err);
  }
  if (store !== undefined) return validateBoardConfig(store, 'gitq.board');

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch {
    throw new Error(`no config.json at ${configPath}, and no "gitq.board" in the settings store; set one of them`);
  }
  return parseConfig(raw);
}
