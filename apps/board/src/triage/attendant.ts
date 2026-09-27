import {
  adoptLegacyCiLease,
  boardDoctorOwner,
  CiLeaseError,
  claimCiLease,
  DEFAULT_CI_LEASE_TTL_SECONDS,
  heartbeatCiLease,
  readCiLease,
  readCiLeaseByBranch,
  releaseCiLease,
  type CiLeaseOpts,
} from '@mattstack/rt-client';

import type { AttendantsPort } from './run.ts';

/** Holds the MR's CI lease for the doctor pane, which never claims; the
    heartbeat each cron pass is its pulse, so the cron interval must stay
    under the TTL. Every method catches every error, since one escaping would
    abort runTriage before the latch pass and writeMemory in bin/triage.ts.
    Lock contention stays silent (the next pass retries); any other failure
    warns. */

function isLockContention(err: unknown): boolean {
  return err instanceof CiLeaseError && err.message.startsWith('lease lock');
}

function warnUnlessLockBusy(action: string, err: unknown): void {
  if (isLockContention(err)) return;
  console.warn(`board: ci lease ${action} failed`, err);
}

export function createBoardAttendants(opts: CiLeaseOpts = {}): AttendantsPort {
  return {
    read: mrUrl => {
      try {
        return readCiLease(mrUrl, opts).lease;
      } catch (err) {
        warnUnlessLockBusy(`read for ${mrUrl}`, err);
        return null;
      }
    },
    readByBranch: branch => {
      try {
        return readCiLeaseByBranch(branch, opts);
      } catch (err) {
        warnUnlessLockBusy(`read by branch ${branch}`, err);
        return null;
      }
    },
    claim: (mrUrl, _iid, branch) => {
      try {
        return claimCiLease(
          {
            mrUrl,
            owner: boardDoctorOwner(mrUrl),
            holder: 'doctor',
            sessionLabel: 'mr-board-triage',
            ttlSeconds: DEFAULT_CI_LEASE_TTL_SECONDS,
            ...(branch !== undefined && { branch }),
          },
          opts
        ).claimed;
      } catch (err) {
        warnUnlessLockBusy(`claim for ${mrUrl}`, err);
        return false;
      }
    },
    heartbeat: mrUrl => {
      try {
        const owner = boardDoctorOwner(mrUrl);
        adoptLegacyCiLease(mrUrl, owner, 'doctor', opts);
        heartbeatCiLease(mrUrl, owner, opts);
      } catch (err) {
        warnUnlessLockBusy(`heartbeat for ${mrUrl}`, err);
      }
    },
    release: mrUrl => {
      try {
        releaseCiLease(mrUrl, boardDoctorOwner(mrUrl), opts);
      } catch (err) {
        warnUnlessLockBusy(`release for ${mrUrl}`, err);
      }
    },
  };
}
