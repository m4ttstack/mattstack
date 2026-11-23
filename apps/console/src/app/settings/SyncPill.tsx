import { useState } from 'react';
import {
  Alert,
  Anchor,
  Button,
  Code,
  Divider,
  Group,
  Loader,
  Popover,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon, type IconName } from '@mattstack/app-kit/icons';

import type { OrgSync, SyncState } from '../../shared/settings-sync';
import { useOpenRow } from './explainParam';
import { useSettingsSyncContext } from './SettingsSyncProvider';
import {
  lastPushText,
  pillLabel,
  pullMinutes,
  pushHelps,
  scopeText,
  STUCK_COPY,
  waitingTitle,
} from './syncCopy';

const PILL: Record<
  SyncState['kind'],
  { icon: IconName; color?: 'warn' | 'bad' }
> = {
  pushed: { icon: 'cloudCheck' },
  waiting: { icon: 'arrowUpFromLine', color: 'warn' },
  stuck: { icon: 'warning', color: 'bad' },
  unknown: { icon: 'cloudOff' },
};

/** Whether this org's settings changes have left this Mac, after the team in
    the Settings bar. Hidden outside the page's sync provider. */
export function SyncPill({ org }: { org: string }) {
  const ctx = useSettingsSyncContext();
  const [opened, setOpened] = useState(false);
  if (ctx === null) return null;
  const sync: OrgSync = ctx.orgs.find(o => o.org === org) ?? {
    org,
    state: { kind: 'unknown' },
    pending: [],
    cantPush: [],
    lastPushAt: null,
    pullIntervalSec: 300,
    trialBranch: null,
  };
  const pill = PILL[sync.state.kind];
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      shadow="md"
      width={380}
      withinPortal
    >
      <Popover.Target>
        <Button
          size="compact-sm"
          px={12}
          radius="xl"
          variant={pill.color ? 'hue-outline' : 'default'}
          color={pill.color}
          leftSection={<Icon name={pill.icon} size={14} />}
          style={{ flex: 'none' }}
          onClick={() => setOpened(o => !o)}
          aria-label={`Settings sync: ${pillLabel(sync.state)}`}
          data-testid="sync-pill"
        >
          {pillLabel(sync.state)}
        </Button>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <SyncDetail
          sync={sync}
          push={ctx.push}
          onOpenKey={() => setOpened(false)}
        />
      </Popover.Dropdown>
    </Popover>
  );
}

type PushResult =
  | { kind: 'idle' }
  | { kind: 'pushing' }
  | { kind: 'pushed' }
  | { kind: 'failed'; message: string };

function SyncDetail({
  sync,
  push,
  onOpenKey,
}: {
  sync: OrgSync;
  push: (org: string) => Promise<string | null>;
  onOpenKey: () => void;
}) {
  const [result, setResult] = useState<PushResult>({ kind: 'idle' });
  const now = Date.now();
  const { state, org } = sync;
  const pushNow = async () => {
    setResult({ kind: 'pushing' });
    const err = await push(org);
    setResult(
      err === null ? { kind: 'pushed' } : { kind: 'failed', message: err }
    );
  };

  return (
    <Stack gap={0} data-testid="sync-detail">
      <Stack gap={4} px={16} py={14}>
        <Header sync={sync} now={now} />
      </Stack>
      {state.kind === 'stuck' && (
        <Stack gap={8} px={16} pb={14}>
          {state.detail && (
            <Alert variant="light" color="bad" p={8}>
              <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)">
                {state.detail}
              </Text>
            </Alert>
          )}
          <Text fz={12}>{STUCK_COPY[state.reason].fix}</Text>
        </Stack>
      )}
      {sync.pending.length > 0 && (
        <>
          {state.kind === 'stuck' && <Divider />}
          <Stack gap={8} px={16} py={state.kind === 'stuck' ? 12 : 0} pb={14}>
            {state.kind === 'stuck' && (
              <Text fz={12} fw={500} c="dimmed">
                Waiting to push
              </Text>
            )}
            <WaitingList sync={sync} onOpenKey={onOpenKey} />
          </Stack>
        </>
      )}
      {sync.cantPush.length > 0 && (
        <>
          <Divider />
          <Stack gap={6} px={16} py={12} data-testid="sync-cant-push">
            <Text fz={12} fw={500} c="dimmed">
              {"Can't push from this Mac"}
            </Text>
            {sync.cantPush.map(path => (
              <Code key={path} fz={12}>
                {path}
              </Code>
            ))}
            <Text fz={12} c="dimmed">
              {
                "Your role can't push these. They stay on this Mac until an org admin's Mac pushes them."
              }
            </Text>
          </Stack>
        </>
      )}
      <Divider />
      <Group gap={8} px={16} py={10} wrap="nowrap" justify="space-between">
        <PushResultText result={result} sync={sync} now={now} />
        {pushHelps(state) && (
          <Button
            size="compact-sm"
            variant={state.kind === 'pushed' ? 'default' : 'filled'}
            leftSection={<Icon name="arrowUpFromLine" size={13} />}
            loading={result.kind === 'pushing'}
            onClick={() => void pushNow()}
            style={{ flex: 'none' }}
          >
            {state.kind === 'stuck' ? 'Try again' : 'Push now'}
          </Button>
        )}
      </Group>
    </Stack>
  );
}

function Header({ sync, now }: { sync: OrgSync; now: number }) {
  const { state, org } = sync;
  const minutes = pullMinutes(sync);
  const line = (icon: IconName, color: string, title: string, sub: string) => (
    <>
      <Group gap={8} wrap="nowrap">
        <Icon name={icon} size={15} color={color} />
        <Text fz={14} fw={600}>
          {title}
        </Text>
      </Group>
      <Text fz={12} c="dimmed">
        {sub}
      </Text>
    </>
  );
  switch (state.kind) {
    case 'pushed':
      return line(
        'cloudCheck',
        'var(--tk-text-ok-vivid)',
        `Everything has reached ${org}`,
        sync.lastPushAt === null
          ? 'Nothing is waiting to push.'
          : `${lastPushText(sync, now)}. Teammates pull within ${minutes} min.`
      );
    case 'waiting':
      return line(
        'arrowUpFromLine',
        'var(--tk-text-warn-vivid)',
        waitingTitle(state.count, org),
        `They push on their own within a minute. Teammates pull within ${minutes} min of that.`
      );
    case 'stuck':
      return line(
        'warning',
        'var(--tk-text-bad-vivid)',
        `Changes aren't reaching ${org}`,
        STUCK_COPY[state.reason].why
      );
    case 'unknown':
      return line(
        'cloudOff',
        'var(--tk-text-3)',
        `Can't tell what has reached ${org}`,
        "rt didn't report this org's sync state. An older mattstack daemon doesn't; it does after an update."
      );
  }
}

function WaitingList({
  sync,
  onOpenKey,
}: {
  sync: OrgSync;
  onOpenKey: () => void;
}) {
  const { set } = useOpenRow();
  return (
    <Stack gap={8} data-testid="sync-waiting">
      {sync.pending.map(entry =>
        'key' in entry ? (
          <Group
            key={`${entry.store}|${entry.repo ?? ''}|${entry.key}`}
            gap={8}
            wrap="nowrap"
          >
            <Anchor
              component="button"
              type="button"
              fz={12}
              ff="monospace"
              onClick={() => {
                set(
                  { key: entry.key, tab: 'value', fix: null },
                  entry.repo ? { repo: entry.repo } : {}
                );
                onOpenKey();
              }}
            >
              {entry.key}
            </Anchor>
            <Text fz={12} c="dimmed" truncate>
              {scopeText(entry)}
            </Text>
            <Text fz={12} c="dimmed" ml="auto" style={{ flex: 'none' }}>
              {entry.change}
            </Text>
          </Group>
        ) : (
          <Group key={entry.path} gap={8} wrap="nowrap">
            <Text fz={12} ff="monospace" truncate>
              {entry.path}
            </Text>
            {entry.heldBack && (
              <Text fz={12} c="dimmed" ml="auto" style={{ flex: 'none' }}>
                waits for rt team publish
              </Text>
            )}
          </Group>
        )
      )}
    </Stack>
  );
}

function PushResultText({
  result,
  sync,
  now,
}: {
  result: PushResult;
  sync: OrgSync;
  now: number;
}) {
  switch (result.kind) {
    case 'pushing':
      return (
        <Group gap={6} wrap="nowrap">
          <Loader size={12} />
          <Text fz={12} c="dimmed">
            Pushing to {sync.org}…
          </Text>
        </Group>
      );
    case 'pushed':
      return (
        <Group gap={6} wrap="nowrap">
          <Icon name="circleCheck" size={13} color="var(--tk-text-ok-vivid)" />
          <Text fz={12} c="var(--tk-text-ok-small)">
            Pushed just now
          </Text>
        </Group>
      );
    case 'failed':
      return (
        <Group gap={6} wrap="nowrap" align="flex-start">
          <Icon name="circleAlert" size={13} color="var(--tk-text-bad-vivid)" />
          <Text fz={12} c="var(--tk-text-bad-small)">
            {"Didn't push: "}
            {result.message}
          </Text>
        </Group>
      );
    case 'idle':
      return (
        <Text fz={12} c="dimmed">
          {lastPushText(sync, now)}
        </Text>
      );
  }
}
