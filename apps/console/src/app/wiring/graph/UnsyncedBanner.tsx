import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { modals } from '@mattstack/app-kit/modals';
import { notifications } from '@mattstack/app-kit/notifications';
import { useQueryClient } from '@tanstack/react-query';

import { suffixOf } from '../outline';
import {
  isSkillsWriting,
  syncRefusal,
  useDiscardChanges,
  usePendingChanges,
  useSkillsSync,
  useSkillsWriting,
  type SkillsChanges,
} from '../useWiring';
import { ButtonLabel } from './ButtonLabel';
import classes from './graph.module.css';
import { stepLabel } from './model/focusModel';

const MUTED = 'var(--tk-text-3)';
const BODY = 'var(--tk-text-1)';
const BUTTON = {
  root: classes.boardButton,
  section: classes.boardButtonSection,
};
/** The banner names this many changes; the sync confirm names them all. */
const BANNER_LIMIT = 3;

type PendingChange = { key: string; name: string; detail: string | null };

const fillName = (binding: string | null) =>
  binding === null ? 'nothing' : suffixOf(binding);

const FILE_STATUS: Record<string, string> = {
  M: 'edited',
  A: 'added',
  '??': 'added',
  D: 'deleted',
};

/**
 * What the pack would share on a sync, as a person reads it: each binding
 * and surface change by the skill it changes, or, when no such change
 * explains the edits, each edited file by its path.
 */
function pendingChangesOf(changes: SkillsChanges): PendingChange[] {
  const named: PendingChange[] = [
    ...changes.bindings.map(change => ({
      key: `binding:${change.engineRef}:${change.slot}`,
      name: stepLabel(suffixOf(change.engineRef)),
      detail: `${change.slot} slot: ${fillName(change.from)} → ${fillName(change.to)}`,
    })),
    ...changes.surface.map(change => ({
      key: `surface:${change.skill}`,
      name: change.skill,
      detail: `${change.from} → ${change.to}`,
    })),
  ];
  if (named.length > 0) return named;
  return changes.files.map(file => ({
    key: `file:${file.path}`,
    name: file.path,
    detail: file.from
      ? `renamed from ${file.from}`
      : (FILE_STATUS[file.status] ?? null),
  }));
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

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

/**
 * Across the Wiring page while the pack has edits nobody has synced: what
 * they are, and the two ways out, each behind a confirm.
 */
export function UnsyncedBanner({ pack }: { pack: string }) {
  const changes = useUnsynced(pack);
  const queryClient = useQueryClient();
  const sync = useSkillsSync(pack);
  const discard = useDiscardChanges(pack);
  const writing = useSkillsWriting(pack);

  if (!changes) return null;

  const pending = pendingChangesOf(changes);
  const count = pending.length;
  const shown = pending.slice(0, BANNER_LIMIT);
  const outside = changes.outsideScope.map(file => file.path);

  /** Writes start from a confirm's answer, so the lock is read then. */
  const unlessWriting = (write: () => void) => () => {
    if (isSkillsWriting(queryClient, pack)) {
      notifications.error(
        `Another change to ${pack} is still being written. Try again once it finishes.`
      );
      return;
    }
    write();
  };

  // Reported from the promise, which settles whether or not the banner is
  // still mounted; a `mutate` callback is dropped once it unmounts.
  const runSync = () =>
    sync
      .mutateAsync({ commitPending: true })
      .then(report => {
        const refusal = syncRefusal(report);
        if (refusal) notifications.error(refusal);
        else
          notifications.success(
            `Synced ${pack}. Run /reload-plugins in open Claude sessions.`
          );
      })
      .catch((error: Error) => notifications.error(error.message));

  const runDiscard = () =>
    discard
      .mutateAsync()
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
          Sync {count} {plural(count, 'change', 'changes')}?
        </Text>
      ),
      message: (
        <Stack gap={14}>
          <Text fz={13} lh="normal" c={MUTED} data-parity="body">
            This saves {plural(count, 'the change', `the ${count} changes`)} to
            the {pack} pack and shares {plural(count, 'it', 'them')} with your
            team. Then it rebuilds the pack and updates your installed copy.
          </Text>
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
          <Text fz={12} lh="normal" c={MUTED} data-parity="after">
            Afterwards, run /reload-plugins in open Claude sessions to pick it
            up.
          </Text>
        </Stack>
      ),
      labels: {
        confirm: <ButtonLabel>Sync changes</ButtonLabel>,
        cancel: <ButtonLabel>Cancel</ButtonLabel>,
      },
      confirmProps: {
        color: 'accent',
        size: 'xs',
        radius: 6,
        classNames: BUTTON,
        leftSection: <Icon name="refresh" size={13} data-parity="i" />,
        'data-parity': 'button · Sync changes',
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
      onConfirm: unlessWriting(runSync),
    });

  const confirmDiscard = () =>
    modals.confirm({
      destructive: true,
      title: `Discard ${count} ${plural(count, 'change', 'changes')}?`,
      message: `This throws away ${plural(count, 'the change', 'the changes')} listed above in ${pack}. It cannot be undone.`,
      labels: { confirm: 'Discard' },
      onConfirm: unlessWriting(runDiscard),
    });

  return (
    <Alert
      variant="tint-outline"
      color="warn"
      radius={0}
      icon={<Icon name="circleDot" size={16} data-parity="i" />}
      classNames={{
        root: classes.banner,
        wrapper: classes.bannerWrapper,
        icon: classes.bannerIcon,
      }}
      data-parity="Banner · unsynced"
      data-testid="unsynced-banner"
    >
      <Group gap={12} wrap="nowrap">
        <Stack gap={3} className={classes.bannerText}>
          <Text fz={13} fw={500} lh="normal" c={BODY} data-parity="t">
            {count} unsynced {plural(count, 'change', 'changes')} in {pack}.
            Your Claude sessions still use the old version.
          </Text>
          {shown.map(change => (
            <ChangeLine key={change.key} change={change} gap={6} />
          ))}
          {count > shown.length && (
            <Text fz={12} lh="normal" c={MUTED}>
              and {count - shown.length} more
            </Text>
          )}
          {outside.length > 0 && (
            <Text fz={12} lh="normal" c={MUTED}>
              Sync refuses until you commit or stash these files outside the
              pack: {outside.join(', ')}
            </Text>
          )}
        </Stack>
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
        <Button
          color="accent"
          size="xs"
          radius={6}
          classNames={BUTTON}
          leftSection={<Icon name="refresh" size={13} data-parity="i" />}
          disabled={writing}
          loading={sync.isPending}
          onClick={confirmSync}
          data-parity="button · Sync changes"
        >
          <ButtonLabel>Sync changes</ButtonLabel>
        </Button>
      </Group>
    </Alert>
  );
}

/** Whether the banner has anything to show, for a host that slides it in. */
export function useUnsyncedBanner(pack: string | null): boolean {
  return useUnsynced(pack) !== null;
}
