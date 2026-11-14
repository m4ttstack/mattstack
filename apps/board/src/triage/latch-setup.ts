import { MRDetailFetcher } from '@mattstack/glance';
import { rtCommand } from '@mattstack/rt-client';
import { gitlabOnly, type BoardConfig } from '../config.ts';
import { boardLatchGateway } from '../latch/board-gateway.ts';
import { refreshedDiscussionCount } from '../latch/github-gateway.ts';
import {
  identityMismatchLine,
  verifyLatchIdentity,
} from '../latch/identity.ts';
import { fetchNewDiscussionCount } from '../latch/land.ts';
import type { LatchGateway } from '../latch/post.ts';
import type { AuditEntry } from './audit.ts';
import type { TriageForgePlan } from './forge-plan.ts';
import type { LatchMrFacts } from './latch.ts';

export interface LatchPassSetup {
  self: string;
  gateway: LatchGateway;
  /** The MRs this run may write to: on GitHub, only those on a repo whose
      daemon login is `self`. */
  scope(mrs: LatchMrFacts[]): Promise<LatchMrFacts[]>;
  countNew(mr: LatchMrFacts, launchAt: number): Promise<number | null>;
}

export interface LatchPassSetupDeps {
  verify?: typeof verifyLatchIdentity;
  command?: typeof rtCommand;
  appendAudit(entry: AuditEntry): void;
  now(): number;
  log(line: string): void;
}

/** The latch pass's identity, gateway and reads for this board's forge, or
    null when the pass cannot run. */
export function latchPassSetup(
  args: {
    config: BoardConfig;
    plan: TriageForgePlan;
    gitlabToken: string | null;
    username: string;
  },
  deps: LatchPassSetupDeps
): LatchPassSetup | null {
  const { config, plan, gitlabToken, username } = args;
  if (!plan.latch || !username) return null;

  if (config.forge.kind === 'gitlab') {
    const gateway = boardLatchGateway(config, gitlabToken);
    if (!gitlabToken || !gateway) return null;
    return {
      self: username,
      gateway,
      scope: async mrs => mrs,
      countNew: (mr, launchAt) => {
        const { projectId } = mr;
        if (projectId === null) return Promise.resolve(null);
        return fetchNewDiscussionCount(
          () =>
            new MRDetailFetcher(gitlabOnly(config), gitlabToken).fetchDetail(
              projectId,
              mr.iid
            ),
          username,
          launchAt
        );
      },
    };
  }

  if (typeof plan.identity !== 'object' || plan.identity === null) return null;
  const self = plan.identity.recorded;
  const gateway = boardLatchGateway(config, null);
  if (!gateway) return null;
  const verify = deps.verify ?? verifyLatchIdentity;
  const command = deps.command ?? rtCommand;
  const verified = new Map<string, boolean>();
  return {
    self,
    gateway,
    async scope(mrs) {
      const kept: LatchMrFacts[] = [];
      for (const mr of mrs) {
        if (!mr.rtRepo) continue;
        let ok = verified.get(mr.rtRepo);
        if (ok === undefined) {
          const verdict = await verify(mr.rtRepo, self);
          ok = verdict.ok;
          verified.set(mr.rtRepo, ok);
          if (!verdict.ok) {
            deps.log(identityMismatchLine(mr.rtRepo, self, verdict.login));
            deps.appendAudit({
              ts: deps.now(),
              mrUrl: mr.mrUrl,
              iid: mr.iid,
              event: 'latch',
              action: 'identity-mismatch',
              reason: verdict.login ?? 'no login',
            });
          }
        }
        if (ok) kept.push(mr);
      }
      return kept;
    },
    countNew: (mr, launchAt) =>
      refreshedDiscussionCount(mr, self, launchAt, command),
  };
}
