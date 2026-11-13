import type { LeaderboardWarning, TimeWindow } from '../../shared/types.js';
import type {
  IndexRow,
  StoredIdentity,
  StoredMetrics,
  StoredPipeline,
  StoredPushEvent,
} from '../store/index.js';
import { fetchPipelinesFor } from './activity.js';
import { resolveIdentity } from './identities.js';
import { fetchMetrics, scanProject } from './mrs.js';
import type { SourceIO, SourceProvider } from './provider.js';

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
    takeWarnings: () => [],
  };
}
