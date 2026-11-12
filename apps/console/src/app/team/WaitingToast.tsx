import { useLocation } from 'wouter';

import { ToastPill, useToastOnce } from '../toast/ToastPill';
import { TEAM_HREF } from './TeamRailEntry';
import { repliedHandles, useTeam } from './useTeam';

/** Teammates waiting for approval, as one pill over the Runs page: shown
    once per waiting list, so the Team rail badge carries it afterwards. */
export function WaitingToast() {
  const { teams } = useTeam();
  const [, navigate] = useLocation();
  const waiting = repliedHandles(teams);
  const signature =
    waiting.length === 0
      ? null
      : waiting
          .map(w => `${w.slug}/${w.handle}`)
          .sort()
          .join(',');
  const toast = useToastOnce({
    storageKey: 'console-team-waiting-seen',
    signature,
  });

  const only = waiting.length === 1 ? waiting[0] : undefined;

  return (
    <ToastPill
      mounted={toast.visible && waiting.length > 0}
      title={
        only
          ? `${only.handle} is waiting for approval`
          : `${waiting.length} people are waiting for approval`
      }
      meta={only?.team}
      onReview={() => {
        toast.hide();
        navigate(TEAM_HREF);
      }}
      onDismiss={toast.hide}
      onHoverChange={toast.setHovered}
      testId="waiting-toast"
    />
  );
}
