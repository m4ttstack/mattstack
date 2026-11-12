import { useLocation } from 'wouter';

import { PAGE_ROW_HEIGHT } from '../chrome';
import { ToastPill, useToastOnce } from '../toast/ToastPill';
import { TEAM_HREF, teamHref } from './TeamRailEntry';
import { repliedHandles, staleAccess, useTeam } from './useTeam';

/** The Team page's one pill over the Runs page: teammates waiting for
    approval first, then admin access that needs updating. Each shows once
    per list, so the Team rail badge and page carry it afterwards. */
export function WaitingToast() {
  const { teams, loaded } = useTeam();
  const [, navigate] = useLocation();
  const waiting = repliedHandles(teams);
  const stale = staleAccess(teams);
  const waitingToast = useToastOnce({
    storageKey: 'console-team-waiting-seen',
    signature:
      waiting.length === 0
        ? null
        : waiting
            .map(w => `${w.slug}/${w.handle}`)
            .sort()
            .join(','),
  });
  const accessToast = useToastOnce({
    storageKey: 'console-team-access-seen',
    signature:
      stale.length === 0
        ? null
        : stale
            .map(s => s.slug)
            .sort()
            .join(','),
    ready: !waitingToast.claimed,
    // Only a read where every team answers counts as a clear: before the
    // first read the list is empty, and an unknown check may just be slow.
    forgetWhenClear:
      loaded &&
      teams.every(t => t.ok && t.team.adminSecrets?.state !== 'unknown'),
  });

  const showAccess = !waitingToast.visible && accessToast.visible;
  const toast = showAccess ? accessToast : waitingToast;
  const only = waiting.length === 1 ? waiting[0] : undefined;
  const onlyStale = stale.length === 1 ? stale[0] : undefined;
  const linked = showAccess ? stale[0]?.slug : waiting[0]?.slug;

  return (
    <ToastPill
      mounted={
        showAccess
          ? stale.length > 0
          : waitingToast.visible && waiting.length > 0
      }
      title={
        showAccess
          ? 'Admin access needs updating'
          : only
            ? `${only.handle} is waiting for approval`
            : `${waiting.length} people are waiting for approval`
      }
      meta={showAccess ? onlyStale?.team : only?.team}
      onReview={() => {
        toast.hide();
        navigate(linked ? teamHref(linked) : TEAM_HREF);
      }}
      onDismiss={toast.hide}
      onHoverChange={toast.setHovered}
      testId={showAccess ? 'admin-secrets-toast' : 'waiting-toast'}
      top={PAGE_ROW_HEIGHT + 12}
    />
  );
}
