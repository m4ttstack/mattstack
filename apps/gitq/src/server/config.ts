import { readFileSync } from 'fs';
import { join } from 'path';

export interface RepoEntry {
  path: string;
  name: string;
}

export interface BoardConfig {
  repos: RepoEntry[];
  port: number;
  herdrWorkspace: string;
  /** Accepted for forward compatibility; the provider stack is gitlab.com-only today. */
  gitlabHost: string;
}

export const CONFIG_PATH = join(import.meta.dir, '..', '..', 'config.json');

function basenameOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Pure string-to-config parse so tests never touch the filesystem. */
export function parseConfig(raw: string): BoardConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('config.json is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('config.json must be a JSON object');
  const cfg = parsed as { repos?: unknown; port?: unknown; herdrWorkspace?: unknown; gitlabHost?: unknown };

  if (!Array.isArray(cfg.repos) || cfg.repos.length === 0) {
    throw new Error('config.json needs a non-empty "repos" array');
  }
  const repos: RepoEntry[] = cfg.repos.map((entry, i) => {
    if (!entry || typeof entry !== 'object') throw new Error(`repos[${i}] must be an object`);
    const { path, name } = entry as { path?: unknown; name?: unknown };
    if (typeof path !== 'string' || path === '') throw new Error(`repos[${i}] needs a "path" string`);
    if (name !== undefined && typeof name !== 'string') throw new Error(`repos[${i}].name must be a string`);
    return { path, name: name ?? basenameOf(path) };
  });

  const port = cfg.port === undefined ? 11008 : cfg.port;
  if (typeof port !== 'number') throw new Error('"port" must be a number');
  const herdrWorkspace = cfg.herdrWorkspace === undefined ? 'gitq' : cfg.herdrWorkspace;
  if (typeof herdrWorkspace !== 'string') throw new Error('"herdrWorkspace" must be a string');
  const gitlabHost = cfg.gitlabHost === undefined ? 'https://gitlab.com' : cfg.gitlabHost;
  if (typeof gitlabHost !== 'string') throw new Error('"gitlabHost" must be a string');

  return { repos, port, herdrWorkspace, gitlabHost };
}

export function loadConfig(): BoardConfig {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    throw new Error(`no config.json at ${CONFIG_PATH}; copy config.example.json and edit it`);
  }
  return parseConfig(raw);
}
