import type {
  FetchMergeRequestIndexOptions,
  FetchPullRequestsWarning,
  MergeRequestIndexRow,
  MRDetail,
  PullRequest,
  UserRef,
} from '@mattstack/glance';
import type { LeaderboardWarning } from '../../shared/types.js';
import type {
  StoredNote,
  StoredPipeline,
  StoredPushEvent,
} from '../store/index.js';
import type { ForgeSource } from './forge-source.js';
import { loginCanon } from './logins.js';
import { toIndexRow } from './mrs.js';
import type { SourceIO } from './provider.js';

/** glance's GitHub reads take no signal. */
export interface GitHubSourceProvider {
  fetchUser(username: string): Promise<UserRef | null>;
  fetchMergeRequestIndex(
    o: FetchMergeRequestIndexOptions
  ): Promise<MergeRequestIndexRow[]>;
  fetchSingleMR(
    projectPath: string,
    iid: number,
    me: number | null,
    onWarning?: (w: FetchPullRequestsWarning) => void
  ): Promise<PullRequest | null>;
  fetchMRDiscussions(repositoryId: string, iid: number): Promise<MRDetail>;
  restRequest(method: string, path: string): Promise<Response>;
}

interface GHFile {
  filename: string;
  additions: number;
  deletions: number;
}

interface GHCommit {
  author: { login: string } | null;
  commit: { author: { date: string } };
}

interface GHRun {
  id: number;
  actor: { login: string } | null;
  status: string | null;
  conclusion: string | null;
  created_at: string;
}

interface GHRunsPage {
  total_count: number;
  workflow_runs: GHRun[];
}

const COMMIT_CAP = 250;
const RUN_CAP = 1000;

const CONCLUSION_STATUS: Record<string, string> = {
  success: 'success',
  failure: 'failed',
  cancelled: 'canceled',
};

const hasNextPage = (link: string | null): boolean =>
  link !== null && /<[^>]*>\s*;\s*rel="next"/.test(link);

const toSeconds = (iso: string): string => iso.replace(/\.\d{3}Z$/, 'Z');

function runStatus(run: GHRun): string {
  if (run.conclusion === null) return (run.status ?? '').toLowerCase();
  const conclusion = run.conclusion.toLowerCase();
  return CONCLUSION_STATUS[conclusion] ?? conclusion;
}

export function githubSource(
  provider: GitHubSourceProvider,
  opts: { knownLogins: readonly string[] }
): ForgeSource {
  const canon = loginCanon(opts.knownLogins);
  const canonLogin = (login: string): string => canon(login) ?? login;
  let warnings: LeaderboardWarning[] = [];

  async function* pages(
    pathFor: (page: number) => string,
    io: SourceIO
  ): AsyncGenerator<unknown> {
    for (let page = 1; ; page++) {
      io.signal?.throwIfAborted();
      const path = pathFor(page);
      const res = await provider.restRequest('GET', path);
      if (!res.ok) throw new Error(`GET ${path} returned ${res.status}`);
      yield await res.json();
      if (!hasNextPage(res.headers.get('link'))) return;
    }
  }

  async function listAll<T>(
    pathFor: (page: number) => string,
    io: SourceIO
  ): Promise<T[]> {
    const rows: T[] = [];
    for await (const body of pages(pathFor, io)) rows.push(...(body as T[]));
    return rows;
  }

  return {
    async resolveIdentity(username, io) {
      io.signal?.throwIfAborted();
      const user = await provider.fetchUser(username);
      const fetchedAt = new Date().toISOString();
      if (!user) {
        return {
          username,
          name: null,
          resolved: false,
          userId: null,
          fetchedAt,
        };
      }
      const numeric = Number(user.id.split(':').pop());
      return {
        username,
        name: user.name,
        resolved: true,
        userId: Number.isInteger(numeric) ? numeric : null,
        fetchedAt,
      };
    },

    async scanProject(projectPath, updatedAfter, io) {
      io.signal?.throwIfAborted();
      const rows = await provider.fetchMergeRequestIndex({
        projectPaths: [projectPath],
        updatedAfter,
        signal: io.signal,
      });
      const scannedAt = new Date().toISOString();
      return rows.map(r => {
        const row = toIndexRow(r, scannedAt);
        return { ...row, authorUsername: canon(row.authorUsername) };
      });
    },

    async fetchDetail(row, io) {
      const { projectPath, iid } = row;
      const ref = `${projectPath}#${iid}`;
      const repositoryId = `github:${projectPath}`;

      const fillFailures: string[] = [];
      io.signal?.throwIfAborted();
      const pr = await provider.fetchSingleMR(projectPath, iid, null, w => {
        if (w.source === 'fill') fillFailures.push(w.message);
      });
      if (fillFailures.length > 0)
        throw new Error(`${ref}: ${fillFailures[0]}`);
      if (!pr) throw new Error(`${ref}: the pull request read came back empty`);

      io.signal?.throwIfAborted();
      const detail = await provider.fetchMRDiscussions(repositoryId, iid);
      const notes: StoredNote[] = detail.discussions
        .flatMap(d => d.notes)
        .map(n => ({
          authorUsername: canonLogin(n.author.username),
          createdAt: n.createdAt,
          system: false,
          inline: n.position !== null || n.type === 'DiffNote',
        }));

      const files = await listAll<GHFile>(
        page =>
          `/repos/${projectPath}/pulls/${iid}/files?per_page=100&page=${page}`,
        io
      );
      const ghCommits = await listAll<GHCommit>(
        page =>
          `/repos/${projectPath}/pulls/${iid}/commits?per_page=100&page=${page}`,
        io
      );
      if (ghCommits.length >= COMMIT_CAP) {
        warnings.push({
          code: 'mr_detail_partial',
          message: `${ref}: GitHub lists at most ${COMMIT_CAP} commits per pull request, so its commits are capped at ${COMMIT_CAP}.`,
        });
      }
      const commits: StoredPushEvent[] = ghCommits.flatMap(c =>
        c.author === null
          ? []
          : [
              {
                username: canonLogin(c.author.login),
                createdAt: c.commit.author.date,
                repositoryId,
              },
            ]
      );

      return {
        metrics: {
          projectPath,
          iid,
          description: pr.description,
          diffStats: pr.diffStats
            ? {
                additions: pr.diffStats.additions,
                deletions: pr.diffStats.deletions,
                filesChanged: pr.diffStats.filesChanged,
              }
            : null,
          fileStats: files.map(f => ({
            path: f.filename,
            additions: f.additions,
            deletions: f.deletions,
          })),
          labels: row.labels,
          approvedByUsernames: pr.approvedBy.map(u => canonLogin(u.username)),
          notes,
        },
        commits,
      };
    },

    async fetchPipelines(projectPath, username, window, io) {
      const created = `${toSeconds(window.start)}..${toSeconds(window.end)}`;
      const rows: StoredPipeline[] = [];
      let capped = false;
      for await (const body of pages(
        page =>
          `/repos/${projectPath}/actions/runs?actor=${encodeURIComponent(username)}&created=${created}&per_page=100&page=${page}`,
        io
      )) {
        const runs = body as GHRunsPage;
        if (runs.total_count > RUN_CAP) capped = true;
        for (const run of runs.workflow_runs) {
          rows.push({
            id: `github:run:${run.id}`,
            projectPath,
            username: canon(run.actor?.login ?? null),
            status: runStatus(run),
            createdAt: run.created_at,
          });
        }
      }
      if (capped) {
        warnings.push({
          code: 'pipeline_fetch_failed',
          message: `Pipelines ${projectPath} / ${username}: GitHub lists at most ${RUN_CAP} runs, so this count is capped.`,
        });
      }
      return rows;
    },

    readsPushEvents: false,
    reusesFreshSnapshots: 'any',

    takeWarnings() {
      const taken = warnings;
      warnings = [];
      return taken;
    },
  };
}
