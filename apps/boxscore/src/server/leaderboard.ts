import type {
  LeaderboardResponse,
  LeaderboardWarning,
  RefreshProgress,
  Scope,
  TimeWindow,
  UserDetailResponse,
} from '../shared/types.js';
import { getCurrentUser } from './config/current-user.js';
import { ConfigError, readSettings, type Env } from './config/index.js';
import { readSecrets } from './config/secrets.js';
import { readTeamMembership } from './config/team.js';
import { resolveViewer } from './config/viewer.js';
import { buildUserEvidence } from './metrics/evidence.js';
import { computeSnapshot, type Snapshot } from './metrics/snapshot.js';
import { buildResponse, type BuildContext } from './metrics/trend.js';
import { runRefresh } from './refresh/index.js';
import { makeProvider } from './source/index.js';
import { getStore } from './store/index.js';
import type { FetchResult } from './store/model.js';
import {
  buildFetchResult,
  hasDataFor,
  storedIdentities,
} from './store/query.js';
import { baseWindow, covers, priorWindow } from './util/window.js';
import {
  applyViewAs,
  canSeeUser,
  LOCKED_MESSAGE,
  narrowForViewer,
  SELF_ONLY_MESSAGE,
  unrankedRow,
  ViewerForbiddenError,
} from './viewer-scope.js';

/** Thrown by getLeaderboard when cacheOnly is set and the store has never been populated. */
export class ColdCacheError extends Error {
  override readonly name = 'ColdCacheError';

  constructor(
    message: string,
    readonly scope: Scope
  ) {
    super(message);
  }
}

export interface LeaderboardOptions {
  window: TimeWindow;
  refresh: boolean;
  /** When false, the prior window is not computed and no deltas are produced. */
  trend: boolean;
  signal?: AbortSignal;
  onProgress?: (p: RefreshProgress) => void;
  /** When true, never fetch: a cold store throws ColdCacheError instead of hitting the network. */
  cacheOnly?: boolean;
  /** Roster username whose Self view a Team viewer previews; ignored for any other viewer. */
  viewAs?: string;
}

/** Wrap a window-agnostic reporter to stamp the window. Exported for testing. */
export function withWindow(
  window: 'current' | 'prior',
  onProgress?: (p: RefreshProgress) => void
): ((p: Omit<RefreshProgress, 'window'>) => void) | undefined {
  if (!onProgress) return undefined;
  return p => onProgress({ ...p, window });
}

export interface DetailOptions extends LeaderboardOptions {
  /** GitLab username to drill into. */
  user: string;
}

export class UnknownUserError extends Error {
  override readonly name = 'UnknownUserError';
}

/** Assembles the fetchers' connection envelope from settings + daemon secrets (spec 5.4). */
async function resolveEnv(): Promise<Env> {
  const s = readSettings();
  if (!s.baseUrl) {
    throw new ConfigError(
      'GitLab is not configured: set the forge host in mattstack.integrations (rt settings).'
    );
  }
  const secrets = await readSecrets();
  if (secrets.warning) console.warn(`[config] ${secrets.warning}`);
  if (!secrets.gitlabToken) {
    throw new ConfigError(
      'GitLab token is not configured: set gitlabToken in the rt secrets store (or GITLAB_TOKEN).'
    );
  }
  return {
    baseUrl: s.baseUrl,
    token: secrets.gitlabToken,
    linearApiKey: secrets.linearApiKey,
  };
}

/** Settings-driven, projects-only (spec 5.4; groupPath scoping was retired with config.ts). */
function resolveScope(): Scope {
  const projects = readSettings().projects;
  if (projects.length === 0) {
    throw new ConfigError(
      'boxscore.projects is empty: add at least one "group/project" (rt settings).'
    );
  }
  return { type: 'projects', projectPaths: projects };
}

/** The settings-derived options shared by snapshot and evidence computation. */
function metricOptionsFromSettings(users?: string[]) {
  const s = readSettings();
  return {
    users: users ?? s.users,
    sizeBand: s.sizeBand,
    doneStates: s.doneStates,
    extraBotPatterns: s.botPatterns,
    excludeFilePatterns: s.excludeFilePatterns,
    ignoredMrs: s.ignoredMrs,
  };
}

const snapshotFor = (
  result: FetchResult,
  window: TimeWindow,
  users?: string[]
): Snapshot =>
  computeSnapshot(result, { window, ...metricOptionsFromSettings(users) });

/**
 * Shared core: refresh the store when asked -> read current + prior windows straight from
 * it -> compute snapshots -> ranked response. Returns the current FetchResult too, so the
 * detail endpoint can build evidence from the same data without a second store read.
 */
async function buildLeaderboard(
  opts: LeaderboardOptions
): Promise<{ response: LeaderboardResponse; current: FetchResult; env: Env }> {
  const env = await resolveEnv();
  const settings = readSettings();
  const scope = resolveScope();
  const store = getStore();
  const pw = priorWindow(opts.window);
  // Everything this request reads: the window, plus its prior when deltas are wanted.
  const read: TimeWindow = opts.trend
    ? { start: pw.start, end: opts.window.end, key: opts.window.key }
    : opts.window;
  const warnings: LeaderboardWarning[] = [];

  // Resolved before the refresh so an unknown viewAs 404s without fetching anything.
  const who = await getCurrentUser(env.baseUrl, env.token);
  const { viewer, previewing } = applyViewAs(
    resolveViewer({
      currentUser: who?.username ?? null,
      roster: settings.roster,
      roles: settings.roles,
      team: readTeamMembership(),
    }),
    opts.viewAs,
    settings.roster
  );
  if (opts.refresh) {
    // Spec 7.3: the refresh covers the base window (90 days, 180 with trend), so switching
    // presets never refetches; only a range the base cannot cover is fetched as itself.
    const base = baseWindow(opts.trend, new Date());
    const refreshed = await runRefresh({
      store,
      provider: makeProvider(env),
      settings,
      env,
      window: covers(base, read) ? base : read,
      signal: opts.signal,
      onProgress: withWindow('current', opts.onProgress),
    });
    warnings.push(...refreshed);
  }

  if (
    opts.cacheOnly &&
    !opts.refresh &&
    !hasDataFor(store, settings.projects, read)
  ) {
    throw new ColdCacheError(
      `no data back to ${read.start} for ${settings.projects.join(', ')}`,
      scope
    );
  }

  if (!who && !previewing) {
    warnings.push({
      code: 'user_lookup_failed',
      message: 'GitLab /user lookup failed; no row is highlighted as you',
    });
  }

  // A Self viewer is computed alone: hiddenMembers is a Team view overlay.
  const compared =
    viewer.role === 'team'
      ? undefined
      : viewer.username === null
        ? []
        : [viewer.username];

  const rosterUsernames = settings.roster.map(r => r.username);
  const current = buildFetchResult(store, opts.window, rosterUsernames);
  const priorSnapshot: Snapshot | null = opts.trend
    ? snapshotFor(buildFetchResult(store, pw, rosterUsernames), pw, compared)
    : null;

  opts.onProgress?.({
    phase: 'compute',
    label: 'Computing metrics',
    done: 0,
    total: 0,
    window: 'current',
  });

  const ctx: BuildContext = {
    scope,
    window: opts.window,
    priorWindow: priorSnapshot ? pw : null,
    baseUrl: env.baseUrl,
    currentUser: previewing ? (viewer.username ?? '') : (who?.username ?? ''),
    viewer,
    generatedAt: new Date().toISOString(),
    // No refresh ran on this request: everything served came from data already in the store.
    fromCache: !opts.refresh,
    identities: storedIdentities(store, rosterUsernames),
    warnings,
  };

  return {
    response: {
      ...narrowForViewer(
        buildResponse(
          snapshotFor(current, opts.window, compared),
          priorSnapshot,
          ctx
        ),
        viewer
      ),
      previewing,
    },
    current,
    env,
  };
}

/** Orchestrator: refresh (when asked) -> read current + prior from the store -> build response with trend. */
export async function getLeaderboard(
  opts: LeaderboardOptions
): Promise<LeaderboardResponse> {
  return (await buildLeaderboard(opts)).response;
}

/**
 * Per-person drill-down: the same ranked row the leaderboard shows (value + rank + delta for
 * the rail) plus per-metric evidence built from the same store data.
 */
export async function getUserDetail(
  opts: DetailOptions
): Promise<UserDetailResponse> {
  const { response, current, env } = await buildLeaderboard(opts);
  if (!canSeeUser(response.viewer, opts.user)) {
    throw new ViewerForbiddenError(
      response.viewer.username === null ? LOCKED_MESSAGE : SELF_ONLY_MESSAGE
    );
  }
  const want = opts.user.toLowerCase();
  const userRow = response.users.find(u => u.username.toLowerCase() === want);
  if (!userRow) {
    throw new UnknownUserError(
      `Unknown user "${opts.user}" (not in the configured set).`
    );
  }

  // Strips `users` (the full roster) before spreading into CohortOptions, which has no such
  // field; buildUserEvidence takes the one user to build evidence for via `opts.user` instead.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest-destructure exclusion, not a real binding
  const { users: _users, ...evidenceOpts } = metricOptionsFromSettings();
  const evidence = buildUserEvidence(current, userRow.username, {
    window: opts.window,
    baseUrl: env.baseUrl,
    ...evidenceOpts,
  });

  return {
    window: response.window,
    priorWindow: response.priorWindow,
    hasTrend: response.hasTrend,
    baseUrl: response.baseUrl,
    currentUser: response.currentUser,
    viewer: response.viewer,
    previewing: response.previewing,
    generatedAt: response.generatedAt,
    fromCache: response.fromCache,
    user: response.viewer.role === 'team' ? userRow : unrankedRow(userRow),
    evidence,
    warnings: response.warnings,
  };
}
