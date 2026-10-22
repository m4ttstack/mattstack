import { Button, ConfirmDialog } from '@mattstack/tui-kit';
import type { ActiveRun } from '../types.ts';
import { runParent } from './run-guard.ts';

export interface PendingRun {
  run: ActiveRun;
  iid: number;
  ring: () => void;
  launch: () => void;
}

function whereLine(run: ActiveRun): string | null {
  const parent = runParent(run);
  const stage = run.stage ? `at its ${run.stage} stage` : null;
  if (parent)
    return `The run is on parent ${parent}${stage ? `, ${stage}` : ''}.`;
  return stage ? `The run is ${stage}.` : null;
}

/** A doctor on a branch a live work run owns races the worker; ringing hands
    the worker what the MR needs instead. Cancel holds focus, so Enter backs
    out. */
export function RunActiveConfirmDialog({
  pending,
  onDone,
}: {
  pending: PendingRun | null;
  onDone: () => void;
}) {
  const run = pending?.run;
  const title = run?.name
    ? `${run.name}'s run is active on this branch`
    : `A work run is active on !${pending?.iid ?? ''}`;
  const where = run ? whereLine(run) : null;
  return (
    <ConfirmDialog
      open={pending !== null}
      intent="accent"
      confirmVariant="filled"
      title={title}
      confirmLabel="Ring worker"
      cancelLabel="Cancel"
      onConfirm={() => {
        pending?.ring();
        onDone();
      }}
      onCancel={onDone}
    >
      {where && <p>{where}</p>}
      <p>Ringing hands the worker this MR's CI or rebase. No doctor starts.</p>
      <Button
        variant="subtle"
        intent="muted"
        size="sm"
        onClick={() => {
          pending?.launch();
          onDone();
        }}
      >
        Launch doctor anyway
      </Button>
    </ConfirmDialog>
  );
}
