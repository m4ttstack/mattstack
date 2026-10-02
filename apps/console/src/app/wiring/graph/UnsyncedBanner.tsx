import { useState } from 'react';
import {
  Alert,
  Anchor,
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

import {
  fetchPendingChanges,
  isSkillsWriting,
  syncRefusal,
  useCompositionSnapshot,
  useDiscardChanges,
  usePendingChanges,
  useSkillsSync,
  useSkillsWriting,
  writeBusyMessage,
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
/** The banner names this many changes until asked for the rest. */
const BANNER_LIMIT = 3;
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

/**
 * Across the Wiring page while the pack has edits nobody has synced: what
 * they are, and the two ways out, each behind a confirm that lists every
 * change it acts on.
 */
export function UnsyncedBanner({ pack }: { pack: string }) {
  const current = useUnsynced(pack);
  const queryClient = useQueryClient();
  const sync = useSkillsSync(pack);
  const discard = useDiscardChanges(pack);
  const writing = useSkillsWriting(pack);
  const composition = useCompositionSnapshot(pack).data;
  const [expanded, setExpanded] = useState(false);
  // The host slides the banner out once the pack is clean; it keeps the
  // last list on screen while it goes rather than emptying first.
  const [held, setHeld] = useState(current);
  if (current !== null && current !== held) setHeld(current);
  const changes = current ?? held;

  if (!changes) return null;

  const pending = pendingChangesOf(changes, composition);
  const count = pending.length;
  const shown = expanded ? pending : pending.slice(0, BANNER_LIMIT);
  const hidden = count - shown.length;
  const outside = changes.outsideScope.map(file => file.path);

  /**
   * A confirm refuses its write when a fresh read of the pack differs from
   * the list it showed, since that list came from a poll that can be seconds
   * old and stayed fixed while the confirm was open. rt then reads the pack
   * again on its own and acts on whatever is pending when it starts, so an
   * edit landing between this check and that read is not caught here.
   */
  const confirmed =
    (
      listed: SkillsChanges,
      write: () => void,
      refuse?: (fresh: SkillsChanges) => string | null
    ) =>
    () => {
      void (async () => {
        if (isSkillsWriting(queryClient, pack)) {
          notifications.error(writeBusyMessage(pack));
          return;
        }
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
        if (isSkillsWriting(queryClient, pack)) {
          notifications.error(writeBusyMessage(pack));
          return;
        }
        write();
      })();
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
          <ChangeList pending={pending} />
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
      onConfirm: confirmed(changes, runSync, fresh =>
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
      onConfirm: confirmed(changes, runDiscard),
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
          {(hidden > 0 || expanded) && count > BANNER_LIMIT && (
            <Anchor
              component="button"
              type="button"
              fz={12}
              lh="normal"
              className={classes.bannerMore}
              onClick={() => setExpanded(value => !value)}
            >
              {expanded ? 'Show fewer' : `Show ${hidden} more`}
            </Anchor>
          )}
          {outside.length > 0 && (
            <Text fz={12} lh="normal" c={MUTED}>
              {outsideNote(outside)}
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
          disabled={writing || outside.length > 0}
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
