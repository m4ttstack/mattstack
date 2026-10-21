import { ConfirmDialog } from '@mattstack/tui-kit';
import { usePeople } from './people.ts';

export interface PendingPresence {
  reviewer: string;
  run: () => void;
}

/** Starting a review someone else is already running doubles the work;
    Cancel holds focus, so Enter backs out. */
export function PresenceConfirmDialog({
  pending,
  onDone,
}: {
  pending: PendingPresence | null;
  onDone: () => void;
}) {
  const people = usePeople();
  const name = pending ? people.short(pending.reviewer) : '';
  return (
    <ConfirmDialog
      open={pending !== null}
      intent="accent"
      confirmVariant="filled"
      title={`${name} is already reviewing this`}
      confirmLabel="Review anyway"
      cancelLabel="Cancel"
      onConfirm={() => {
        pending?.run();
        onDone();
      }}
      onCancel={onDone}
    >
      <p>{name}'s board says their review is still running.</p>
    </ConfirmDialog>
  );
}
