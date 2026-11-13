import type { LeaderboardWarning, TimeWindow } from '../../shared/types.js';
import { CONCURRENCY } from '../config/index.js';
import type { BoxscoreSettings, Env } from '../config/index.js';
import type {
  IndexRow,
  StoredIdentity,
  StoredMetrics,
  StoredPipeline,
  StoredPushEvent,
} from '../store/index.js';
import { fetchPipelinesFor } from './activity.js';
import { githubSource, type GitHubSourceProvider } from './github.js';
import { resolveIdentity } from './identities.js';
import { loginCanon } from './logins.js';
import { fetchMetrics, scanProject } from './mrs.js';
import type { GitProvider, SourceIO, SourceProvider } from './provider.js';

export interface ForgeDetail {
  metrics: StoredMetrics;
  commits: StoredPushEvent[];
}

export interface ForgeSource {
  resolveIdentity(username: string, io: SourceIO): Promise<StoredIdentity>;
  scanProject(
    projectPath: string,
    updatedAfter: string,
    io: SourceIO
  ): Promise<IndexRow[]>;
  fetchDetail(row: IndexRow, io: SourceIO): Promise<ForgeDetail | null>;
  fetchPipelines(
    projectPath: string,
    username: string,
    window: TimeWindow,
    io: SourceIO
  ): Promise<StoredPipeline[]>;
  /** GitLab reads push events per user after the project id step; GitHub returns commits from fetchDetail. */
  readonly readsPushEvents: boolean;
  /** How many PR or MR detail reads runRefresh keeps in flight. */
  readonly detailConcurrency: number;
  /**
   * Which stored snapshots at least as new as the index updatedAt a refresh reuses. GitHub
   * bumps updatedAt on every commit, comment, review and label; GitLab trusts it only once merged.
   */
  readonly reusesFreshSnapshots: 'merged' | 'any';
  /** Warnings raised inside reads that still returned rows (caps); runRefresh drains them into its result. */
  takeWarnings(): LeaderboardWarning[];
}

export function gitlabSource(provider: SourceProvider): ForgeSource {
  return {
    resolveIdentity: (username, io) => resolveIdentity(provider, username, io),
    scanProject: (projectPath, updatedAfter, io) =>
      scanProject(provider, projectPath, updatedAfter, io),
    async fetchDetail(row, io) {
      const metrics = await fetchMetrics(
        provider,
        row.projectPath,
        row.iid,
        io
      );
      return metrics ? { metrics, commits: [] } : null;
    },
    fetchPipelines: (projectPath, username, window, io) =>
      fetchPipelinesFor(provider, projectPath, username, window, io),
    readsPushEvents: true,
    detailConcurrency: CONCURRENCY,
    reusesFreshSnapshots: 'merged',
    takeWarnings: () => [],
  };
}

const knownLoginsOf = (settings: BoxscoreSettings): string[] =>
  [...settings.roster, ...settings.orgRoster].map(r => r.username);

/**
 * How stored logins read against the current roster: on GitHub, through the roster's
 * spelling, so a login stored before its owner joined (or under another case) still
 * matches. Undefined on GitLab, whose usernames match exactly.
 */
export function storedLoginCanon(
  env: Pick<Env, 'forge'>,
  settings: BoxscoreSettings
): ((login: string) => string) | undefined {
  if (env.forge !== 'github') return undefined;
  const canon = loginCanon(knownLoginsOf(settings));
  return login => canon(login) ?? login;
}

export function sourceFor(
  env: Env,
  provider: GitProvider,
  settings: BoxscoreSettings
): ForgeSource {
  if (env.forge !== 'github') {
    return gitlabSource(provider as unknown as SourceProvider);
  }
  // makeProvider builds a GitHubProvider for this forge; GitProvider types its reads optional.
  return githubSource(provider as unknown as GitHubSourceProvider, {
    knownLogins: knownLoginsOf(settings),
  });
}
