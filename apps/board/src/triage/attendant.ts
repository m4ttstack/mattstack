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

/** The board's doctor holds the MR's CI lease on the doctor pane's behalf --
    the pane never claims, and this port's heartbeat, called every cron pass
    while the doctor is in flight, is its pulse. The cron interval must stay
    under the TTL. Every method catches every error, not just lock
    contention: an fs failure (EACCES, ENOSPC, ENOTDIR) escaping any one of
    these would abort runTriage and skip the latch pass and writeMemory that
    follow it in bin/triage.ts. claim reports no claim; read/readByBranch
    report no lease; heartbeat/release are no-ops. Lock contention
    (CiLeaseError's "lease lock ..." messages) is expected under a live
    doctor and stays silent -- the next cron pass retries; every other
    failure warns once so a systematic failure (not just a busy lock) stays
    visible. */

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
