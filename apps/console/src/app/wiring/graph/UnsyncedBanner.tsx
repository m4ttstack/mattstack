import { useState } from 'react';
import {
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { modals } from '@mattstack/app-kit/modals';
import { notifications } from '@mattstack/app-kit/notifications';
import { useQueryClient } from '@tanstack/react-query';

import {
  fetchPendingChanges,
  guardedWrite,
  syncRefusal,
  useCompositionSnapshot,
  useDiscardChanges,
  usePendingChanges,
  useSkillsSync,
  useSkillsWriting,
  type SkillsChanges,
} from '../useWiring';
import { ButtonLabel } from './ButtonLabel';
import classes from './graph.module.css';
import {
  pendingChangesOf,
  sameChanges,
  type PendingChange,
} from './model/pendingChanges';

const MUTED = 'var(--tk-text-3)';
const BODY = 'var(--tk-text-1)';
const BUTTON = {
  root: classes.boardButton,
  section: classes.boardButtonSection,
};
const CHANGED =
  'The pack changed since this list was shown. Review the new list and try again.';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const outsideNote = (paths: string[]) =>
  `Sync is off until you commit or stash these files outside the pack: ${paths.join(', ')}`;

/** The changes poll, read the way the banner shows it: only in-pack edits
    count, and a failed poll is unknown, so it shows nothing. */
function useUnsynced(pack: string | null) {
  const query = usePendingChanges(pack);
  const changes = query.isError ? undefined : query.data;
  const show = changes !== undefined && changes.files.length > 0;
  return show ? changes : null;
}

function ChangeLine({ change, gap }: { change: PendingChange; gap: number }) {
  return (
    <Group gap={gap} wrap="nowrap" className={classes.changeLine}>
      <Text ff="monospace" fz={11} lh="normal" c={BODY} data-parity="s">
        {change.name}
      </Text>
      {change.detail && (
        <Text fz={12} lh="normal" c={MUTED} truncate data-parity="c">
          {change.detail}
        </Text>
      )}
    </Group>
  );
}

/** Every change, as both confirms list them. */
function ChangeList({ pending }: { pending: PendingChange[] }) {
  return (
    <Paper
      variant="panel-outline"
      radius={7}
      className={classes.changeList}
      data-parity="list"
    >
      <Stack gap={6}>
        {pending.map(change => (
          <ChangeLine key={change.key} change={change} gap={8} />
        ))}
      </Stack>
    </Paper>
  );
}

/** The pack's unsynced changes counted as the confirms list them, with the
    trial branch they would sync to; null while the pack is clean. */
export function useUnsyncedSummary(pack: string | null) {
  const changes = useUnsynced(pack);
  const composition = useCompositionSnapshot(pack).data;
  if (!changes) return null;
  return {
    count: pendingChangesOf(changes, composition).length,
    trial: changes.trialBranch ?? null,
    signature: changes.signature,
  };
}

/**
 * The two ways out of the pack's unsynced changes, for the head of their
 * History view: Discard and Sync, each behind a confirm that lists every
 * change it acts on, beside the trial branch a sync would push to.
 */
export function UnsyncedActions({
  pack,
  publishOnly = false,
  blockedBy = null,
}: {
  pack: string;
  /** Just the Publish button, for a bar that shows the rest itself. */
  publishOnly?: boolean;
  /** Why Publish waits, such as skills still to compile. */
  blockedBy?: string | null;
}) {
  const current = useUnsynced(pack);
  const queryClient = useQueryClient();
  const sync = useSkillsSync(pack);
  const discard = useDiscardChanges(pack);
  const writing = useSkillsWriting(pack);
  const composition = useCompositionSnapshot(pack).data;
  // The host slides the banner out once the pack is clean; it keeps the
  // last list on screen while it goes rather than emptying first.
  const [held, setHeld] = useState(current);
  if (current !== null && current !== held) setHeld(current);
  const changes = current ?? held;

  if (!changes) return null;

  const pending = pendingChangesOf(changes, composition);
  const count = pending.length;
  const outside = changes.outsideScope.map(file => file.path);

  /**
   * A confirm refuses its write when a fresh read of the pack differs from
   * the list it showed, since that list came from a poll that can be seconds
   * old and stayed fixed while the confirm was open. The write carries the
   * shown list's signature, so rt refuses too when an edit lands between
   * this check and its own read.
   */
  const confirmed =
    (
      listed: SkillsChanges,
      write: () => void,
      refuse?: (fresh: SkillsChanges) => string | null
    ) =>
    () =>
      guardedWrite(queryClient, pack, () => {
        void (async () => {
          let fresh: SkillsChanges;
          try {
            fresh = await fetchPendingChanges(queryClient, pack);
          } catch (error) {
            notifications.error((error as Error).message);
            return;
          }
          if (!sameChanges(listed, fresh)) {
            notifications.error(CHANGED);
            return;
          }
          const reason = refuse?.(fresh);
          if (reason) {
            notifications.error(reason);
            return;
          }
          guardedWrite(queryClient, pack, write);
        })();
      });

  // Reported from the promise, which settles whether or not the banner is
  // still mounted; a `mutate` callback is dropped once it unmounts.
  const runSync = (expect: string) =>
    sync
      .mutateAsync({ commitPending: true, expect })
      .then(report => {
        const refusal = syncRefusal(report);
        if (refusal) notifications.error(refusal);
        else
          notifications.success(
            `Published ${pack}. Run /reload-plugins in open Claude sessions.`
          );
      })
      .catch((error: Error) => notifications.error(error.message));

  const runDiscard = (expect: string) =>
    discard
      .mutateAsync(expect)
      .then(() =>
        notifications.success(`Discarded the unsynced changes in ${pack}`)
      )
      .catch((error: Error) => notifications.error(error.message));

  const confirmSync = () =>
    modals.confirm({
      title: (
        <Text
          span
          display="block"
          fz={15}
          fw={700}
          lh="normal"
          c={BODY}
          data-parity="t"
        >
          Publish {count} {plural(count, 'change', 'changes')}?
        </Text>
      ),
      message: (
        <Stack gap={14}>
          <Text fz={13} lh="normal" c={MUTED} data-parity="body">
            This saves {plural(count, 'the change', `the ${count} changes`)} to
            the {pack} pack and{' '}
            {changes.trialBranch
              ? `pushes ${plural(count, 'it', 'them')} to the trial branch ${changes.trialBranch}, not the data branch.`
              : `shares ${plural(count, 'it', 'them')} with your team.`}{' '}
            Then it installs the pack in Claude Code.
          </Text>
          <ChangeList pending={pending} />
          <Text fz={12} lh="normal" c={MUTED} data-parity="after">
            Afterwards, run /reload-plugins in open Claude sessions to pick it
            up.
          </Text>
        </Stack>
      ),
      labels: {
        confirm: <ButtonLabel>Publish</ButtonLabel>,
        cancel: <ButtonLabel>Cancel</ButtonLabel>,
      },
      confirmProps: {
        color: 'accent',
        size: 'xs',
        radius: 6,
        classNames: BUTTON,
        leftSection: <Icon name="upload" size={13} data-parity="i" />,
        'data-parity': 'button · Publish',
      },
      cancelProps: {
        variant: 'card-outline',
        size: 'xs',
        radius: 6,
        classNames: BUTTON,
        'data-parity': 'button · Cancel',
      },
      groupProps: { gap: 8, mt: 14 },
      size: 480,
      radius: 10,
      padding: 20,
      classNames: {
        header: classes.confirmHeader,
        close: classes.confirmClose,
      },
      closeButtonProps: {
        icon: <Icon name="close" size={16} data-parity="close" />,
      },
      attributes: { content: { 'data-parity': 'Modal · sync changes' } },
      onConfirm: confirmed(
        changes,
        () => runSync(changes.signature),
        fresh =>
          fresh.outsideScope.length > 0
            ? outsideNote(fresh.outsideScope.map(file => file.path))
            : null
      ),
    });

  const confirmDiscard = () =>
    modals.confirm({
      destructive: true,
      title: `Discard ${count} ${plural(count, 'change', 'changes')}?`,
      message: (
        <Stack gap="sm">
          <Text size="sm">
            This throws away{' '}
            {plural(count, 'this change', `these ${count} changes`)} in {pack}.
            It cannot be undone.
          </Text>
          <ChangeList pending={pending} />
        </Stack>
      ),
      labels: { confirm: 'Discard' },
      onConfirm: confirmed(changes, () => runDiscard(changes.signature)),
    });

  const trial = changes.trialBranch ?? null;
  const sync_ = (
    <Button
      color="accent"
      size="xs"
      radius={6}
      classNames={BUTTON}
      leftSection={<Icon name="upload" size={13} data-parity="i" />}
      disabled={writing || outside.length > 0 || blockedBy !== null}
      loading={sync.isPending}
      onClick={confirmSync}
      data-parity="button · Publish"
    >
      <ButtonLabel>{trial ? `Publish to ${trial}` : 'Publish'}</ButtonLabel>
    </Button>
  );
  const why = blockedBy ?? (outside.length > 0 ? outsideNote(outside) : null);
  const publish = why ? (
    <Tooltip label={why} multiline maw={320} withArrow>
      <span>{sync_}</span>
    </Tooltip>
  ) : (
    sync_
  );
  if (publishOnly) return publish;
  return (
    <div className={classes.unsyncedActions} data-testid="unsynced-actions">
      {trial && (
        <Badge
          variant="tint"
          color="purple"
          leftSection={<Icon name="gitBranch" size={12} />}
          classNames={{ root: classes.bannerStatus }}
          data-testid="unsynced-trial"
        >
          trial · {trial}
        </Badge>
      )}
      <Button
        variant="card-outline"
        size="xs"
        radius={6}
        classNames={BUTTON}
        disabled={writing}
        loading={discard.isPending}
        onClick={confirmDiscard}
        data-parity="button · Discard"
      >
        <ButtonLabel>Discard</ButtonLabel>
      </Button>
      {publish}
    </div>
  );
}

/** Whether the banner has anything to show, and whether the changes have
    been read yet, for a host that slides it in. */
export function useUnsyncedBanner(pack: string | null): {
  show: boolean;
  known: boolean;
} {
  const query = usePendingChanges(pack);
  return { show: useUnsynced(pack) !== null, known: !query.isPending };
}
