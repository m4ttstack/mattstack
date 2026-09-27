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

/** BOARD-10: the board's doctor holds the MR's CI lease on the doctor pane's
    behalf -- the pane never claims, and this port's heartbeat, called every
    cron pass while the doctor is in flight, is its pulse. The cron interval
    must stay under the TTL. Every method catches CiLeaseError (lock busy)
    so a contested lock never aborts the whole cron pass: claim reports no
    claim, heartbeat/release leave the retry to the next pass. */
export function createBoardAttendants(opts: CiLeaseOpts = {}): AttendantsPort {
  return {
    read: mrUrl => {
      try {
        return readCiLease(mrUrl, opts).lease;
      } catch {
        return null;
      }
    },
    readByBranch: branch => {
      try {
        return readCiLeaseByBranch(branch, opts);
      } catch {
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
        if (err instanceof CiLeaseError) return false;
        throw err;
      }
    },
    heartbeat: mrUrl => {
      try {
        const owner = boardDoctorOwner(mrUrl);
        adoptLegacyCiLease(mrUrl, owner, 'doctor', opts);
        heartbeatCiLease(mrUrl, owner, opts);
      } catch (err) {
        if (!(err instanceof CiLeaseError)) throw err;
      }
    },
    release: mrUrl => {
      try {
        releaseCiLease(mrUrl, boardDoctorOwner(mrUrl), opts);
      } catch (err) {
        if (!(err instanceof CiLeaseError)) throw err;
      }
    },
  };
}
