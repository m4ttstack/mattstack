import { RetryAlert } from '../RetryAlert';

/** The run's gates could not be read: its decisions are unknown, not none. */
export function GatesUnreadable({ onRetry }: { onRetry: () => void }) {
  return (
    <RetryAlert
      color="warn"
      icon="unplug"
      onRetry={onRetry}
      data-testid="gates-unreadable"
    >
      Can&apos;t read this run&apos;s decisions right now, so none are shown
      here.
    </RetryAlert>
  );
}
