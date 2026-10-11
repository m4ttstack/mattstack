import { getSetting } from '@mattstack/rt-client';

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

function basenameOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Validates a gitq.board value and fills its port and workspace defaults. */
export function validateBoardConfig(parsed: unknown, source: string): BoardConfig {
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

const NO_BOARD =
  'no "gitq.board" in your settings: rt setup writes it with the repos it finds, ' +
  "or run rt settings set gitq.board '{\"repos\":[{\"path\":\"/path/to/repo\"}]}' --scope machine";

/** The board config, from `gitq.board`. `$PORT` still wins over its port; server.ts applies that. */
export function loadConfig(resolve: GetSettingFn = getSetting): BoardConfig {
  const resolved = resolve<unknown>('gitq.board');
  if (resolved.provenance.every((p) => p.scope === 'default')) throw new Error(NO_BOARD);
  return validateBoardConfig(resolved.value, 'gitq.board');
}
