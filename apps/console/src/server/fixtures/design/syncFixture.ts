import type { OrgSync, SyncState } from '../../../shared/settings-sync';

export type SyncScenario = 'pushed' | 'waiting' | 'stuck' | 'unknown';

const SCENARIOS: readonly SyncScenario[] = [
  'pushed',
  'waiting',
  'stuck',
  'unknown',
];

const LAST_PUSH = Date.parse('2026-11-23T11:52:00.000Z');

export function syncScenario(
  env: Record<string, string | undefined>
): SyncScenario {
  const wanted = env.CONSOLE_FIXTURE_SYNC;
  return SCENARIOS.find(s => s === wanted) ?? 'pushed';
}

/** The invented `acme` org from the team fixture, in one sync state per scenario. The settings routes are not fixtured, so `org` and `team` rename it to the ones they read. */
export function syncFixture(
  scenario: SyncScenario,
  org = 'acme',
  team = 'web'
): OrgSync[] {
  const store = `team:${team}` as const;
  const base = {
    org,
    pending: [] as OrgSync['pending'],
    cantPush: [] as string[],
    lastPushAt: LAST_PUSH,
    pullIntervalSec: 300,
    trialBranch: null,
  };
  const states: Record<SyncScenario, { state: SyncState } & Partial<OrgSync>> =
    {
      pushed: { state: { kind: 'pushed', lastPushAt: LAST_PUSH } },
      waiting: {
        state: { kind: 'waiting', count: 2 },
        pending: [
          { store, key: 'board.slack', change: 'changed' },
          { store, key: 'mattstack.directory', change: 'added' },
        ],
      },
      stuck: {
        state: {
          kind: 'stuck',
          reason: 'push-failed',
          detail:
            "fatal: unable to access 'https://gitlab.com/acme/org.git/': The requested URL returned error: 403",
        },
        pending: [{ store, key: 'board.slack', change: 'changed' }],
      },
      unknown: { state: { kind: 'unknown' }, lastPushAt: null },
    };
  return [{ ...base, ...states[scenario] }];
}
