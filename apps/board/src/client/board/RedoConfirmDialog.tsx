import { ConfirmDialog } from '@mattstack/tui-kit';
import { redoCopy } from './redo-copy.ts';
import type { Lane } from './row-actions.ts';

export interface PendingRedo {
  lane: Lane;
  count: number;
  prior: number;
  run: () => void;
}

/** Every redo asks here first: it starts the lane over from scratch on an
    MR that already had a run. Cancel holds focus, so Enter backs out. */
export function RedoConfirmDialog({
  pending,
  onDone,
}: {
  pending: PendingRedo | null;
  onDone: () => void;
}) {
  const copy = pending
    ? redoCopy(pending.lane, pending.count, pending.prior)
    : null;
  return (
    <ConfirmDialog
      open={pending !== null}
      intent="accent"
      confirmVariant="filled"
      title={copy?.title ?? ''}
      confirmLabel={copy?.confirmLabel ?? ''}
      cancelLabel="Cancel"
      onConfirm={() => {
        pending?.run();
        onDone();
      }}
      onCancel={onDone}
    >
      {copy && (
        <>
          <p>{copy.body[0]}</p>
          <p>{copy.body[1]}</p>
        </>
      )}
    </ConfirmDialog>
  );
}
