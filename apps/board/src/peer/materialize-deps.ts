import {
  currentOrg,
  isOrgAdmin,
  readOrgRoles,
  roleOf,
  type OrgRoles,
} from '@mattstack/rt-client';
import { announcementNotice, notifyEscalation } from '../triage/notify.ts';
import type { MaterializeDeps } from './inbox.ts';
import { finishSentNudge, resolveSentNudge, writeNudge } from './nudges.ts';
import { writePeerReview } from './peer-reviews.ts';

export function senderIsOrgAdmin(
  username: string,
  org: string | null,
  roles: (org: string) => OrgRoles
): boolean {
  if (org === null) return false;
  return isOrgAdmin(roleOf(username, roles(org)));
}

/** The board's real stores behind materializeEnvelope, for the server's tick
    and the triage peer pass alike. The store functions take their db before
    the nudge id and the sender, hence the adapters. */
export function boardMaterializeDeps(
  log: (line: string) => void
): Omit<MaterializeDeps, 'reportAuth'> {
  return {
    writePeerReview,
    writeNudge,
    resolveSentNudge: (mrUrl, resolution, from) =>
      resolveSentNudge(mrUrl, resolution, undefined, from),
    finishSentNudge: (mrUrl, finish, ifSentBefore, nudgeId, from) =>
      finishSentNudge(mrUrl, finish, ifSentBefore, undefined, nudgeId, from),
    log,
    isOrgAdmin: username =>
      senderIsOrgAdmin(username, currentOrg(), readOrgRoles),
    notifyAnnouncement: (id, payload, from) => {
      const notice = announcementNotice(payload, from);
      void notifyEscalation(notice.title, notice.message, 'rt', {
        category: 'announcement',
        id,
      });
    },
  };
}
