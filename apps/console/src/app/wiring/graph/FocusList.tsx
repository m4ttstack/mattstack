import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  Group,
  NavLink,
  Skeleton,
  Stack,
  Switch,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import classes from './graph.module.css';
import {
  onlyAttention,
  type FocusGroups,
  type FocusItem,
} from './model/focusModel';
import { useGraphFocus } from './useGraphFocus';

const BODY = 'var(--tk-text-1)';
const MUTED = 'var(--tk-text-3)';

const PIPELINE_NOTICE: Record<NonNullable<FocusGroups['empty']>, string> = {
  'rt-without-pipelines':
    'This rt does not report pipelines, so there is no run order to draw. Update rt to see the pipeline. Every wired skill is still listed below.',
  'no-pipeline':
    "This pack's manifest declares no pipeline, so there is no run order. Every wired skill is still listed below.",
};

const ROW = { root: classes.item, section: classes.section };
const STEP_ROW = { root: classes.step, section: classes.section };
const PIPELINE_ROW = { ...ROW, children: classes.children };
const UNWIRED_ROW = { root: classes.unwired, section: classes.section };
const LABEL = { label: { 'data-parity': 'l' } };

function AttentionDot() {
  return (
    <Box
      className={classes.dot}
      data-parity="dot"
      data-testid="attention-dot"
    />
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <Box className={classes.group}>
      <Text
        size="xs"
        fw={500}
        lh="normal"
        lts="0.08em"
        tt="uppercase"
        c={MUTED}
        data-parity="l"
      >
        {children}
      </Text>
    </Box>
  );
}

/** Only a row that paints (the active one) is a layer of its own; a resting
    row's icon, label and dot sit straight under the list. */
const rowLayer = (active: boolean, name: string) =>
  active ? `focus · ${name}` : undefined;

function ItemRow({
  item,
  activeKey,
  onFocus,
}: {
  item: FocusItem;
  activeKey: string | null;
  onFocus: (key: string) => void;
}) {
  const active = item.key === activeKey;
  return (
    <NavLink
      component="button"
      type="button"
      color="accent"
      active={active}
      fw={active ? 500 : 400}
      c={active ? undefined : BODY}
      label={item.label}
      leftSection={
        <Icon
          name={item.icon}
          size={15}
          color={active ? undefined : MUTED}
          data-parity="i"
        />
      }
      rightSection={item.attention ? <AttentionDot /> : undefined}
      classNames={ROW}
      attributes={LABEL}
      data-parity={rowLayer(active, item.label)}
      data-testid={`focus-${item.key}`}
      onClick={() => onFocus(item.key)}
    />
  );
}

function StepRow({
  item,
  activeKey,
  onFocus,
}: {
  item: FocusItem;
  activeKey: string | null;
  onFocus: (key: string) => void;
}) {
  const active = item.key === activeKey;
  return (
    <NavLink
      component="button"
      type="button"
      color="accent"
      active={active}
      fw={active ? 500 : 400}
      c={active ? undefined : MUTED}
      label={item.label}
      leftSection={
        <Text span size="xs" lh="normal" fw={400} data-parity="n">
          {item.step}
        </Text>
      }
      rightSection={item.attention ? <AttentionDot /> : undefined}
      classNames={STEP_ROW}
      attributes={LABEL}
      data-parity={rowLayer(active, `stage · ${item.label}`)}
      data-testid={`focus-${item.key}`}
      onClick={() => onFocus(item.key)}
    />
  );
}

function PipelineRow({
  item,
  activeKey,
  onFocus,
}: {
  item: FocusItem;
  activeKey: string | null;
  onFocus: (key: string) => void;
}) {
  const active = item.key === activeKey;
  const onStep = item.children.some(child => child.key === activeKey);
  const [unfolded, setUnfolded] = useState(false);
  return (
    <NavLink
      component="button"
      type="button"
      color="accent"
      active={active}
      fw={active ? 500 : 400}
      c={active ? undefined : BODY}
      label={item.label}
      leftSection={
        <Icon
          name={item.icon}
          size={15}
          color={active ? undefined : MUTED}
          data-parity="i"
        />
      }
      rightSection={
        <Group gap={8}>
          <Text span size="xs" lh="normal" fw={400} c={MUTED} data-parity="sub">
            {item.children.length}
          </Text>
          {item.attention && <AttentionDot />}
        </Group>
      }
      opened={onStep || unfolded}
      onChange={setUnfolded}
      keepMounted={false}
      childrenOffset={0}
      disableRightSectionRotation
      classNames={PIPELINE_ROW}
      attributes={LABEL}
      data-parity={rowLayer(active, item.label)}
      data-testid={`focus-${item.key}`}
      onClick={() => onFocus(item.key)}
    >
      {item.children.map(step => (
        <StepRow
          key={step.key}
          item={step}
          activeKey={activeKey}
          onFocus={onFocus}
        />
      ))}
    </NavLink>
  );
}

function UnwiredRow({
  unwired,
  activeKey,
  onFocus,
}: {
  unwired: FocusGroups['unwired'];
  activeKey: string | null;
  onFocus: (key: string) => void;
}) {
  const holdsFocus = unwired.items.some(item => item.key === activeKey);
  const [unfolded, setUnfolded] = useState(false);
  return (
    <Box data-parity="focus · not on the graph">
      <Divider />
      <NavLink
        component="button"
        type="button"
        c={MUTED}
        label="Unwired"
        leftSection={<Icon name="eyeOff" size={15} data-parity="i" />}
        rightSection={
          <Group gap={8}>
            <Text
              span
              size="xs"
              lh="normal"
              c={unwired.attention ? 'warn' : MUTED}
              data-parity="n"
            >
              {unwired.count}
            </Text>
            {unwired.attention && <AttentionDot />}
          </Group>
        }
        opened={holdsFocus || unfolded}
        onChange={setUnfolded}
        keepMounted={false}
        childrenOffset={0}
        disableRightSectionRotation
        classNames={UNWIRED_ROW}
        attributes={LABEL}
        data-testid="focus-unwired"
      >
        {unwired.items.map(item => (
          <ItemRow
            key={item.key}
            item={item}
            activeKey={activeKey}
            onFocus={onFocus}
          />
        ))}
      </NavLink>
    </Box>
  );
}

function FocusGroupsList({
  groups,
  activeKey,
  onFocus,
}: {
  groups: FocusGroups;
  activeKey: string | null;
  onFocus: (key: string) => void;
}) {
  return (
    <>
      <GroupLabel>Pipeline</GroupLabel>
      {groups.empty && (
        <Text size="xs" c={MUTED} className={classes.notice}>
          {PIPELINE_NOTICE[groups.empty]}
        </Text>
      )}
      {groups.pipelines.map(item => (
        <PipelineRow
          key={item.key}
          item={item}
          activeKey={activeKey}
          onFocus={onFocus}
        />
      ))}
      {groups.onDemand.length > 0 && <GroupLabel>On-demand</GroupLabel>}
      {groups.onDemand.map(item => (
        <ItemRow
          key={item.key}
          item={item}
          activeKey={activeKey}
          onFocus={onFocus}
        />
      ))}
      {groups.board.length > 0 && <GroupLabel>Board</GroupLabel>}
      {groups.board.map(item => (
        <ItemRow
          key={item.key}
          item={item}
          activeKey={activeKey}
          onFocus={onFocus}
        />
      ))}
    </>
  );
}

/** The Graph tab's focus list, rendered as `PageShell.Sidebar` content. */
export function GraphSidebar({ pack }: { pack: string }) {
  const { url, patch, compositionQuery, groups, focused } = useGraphFocus(pack);
  const onFocus = (key: string) => patch({ focus: key });
  const shown = groups && url.attention ? onlyAttention(groups) : groups;

  return (
    <Stack
      gap={2}
      className={classes.list}
      data-parity="Focus list"
      data-testid="focus-list"
    >
      {compositionQuery.isError ? (
        <Alert
          variant="light"
          color="bad"
          title="This pack's skills failed to load"
          icon={<Icon name="warning" size={16} />}
        >
          <Stack gap="xs" align="flex-start">
            <Text size="sm">{(compositionQuery.error as Error).message}</Text>
            <Button
              variant="default"
              onClick={() => void compositionQuery.refetch()}
            >
              Retry
            </Button>
          </Stack>
        </Alert>
      ) : !shown ? (
        <Stack gap={2} data-testid="focus-list-loading">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} height={32} />
          ))}
        </Stack>
      ) : (
        <>
          <FocusGroupsList
            groups={shown}
            activeKey={focused?.key ?? null}
            onFocus={onFocus}
          />
          <Box className={classes.spacer} />
          <Switch
            label="Needs attention"
            checked={url.attention}
            onChange={event =>
              patch({ attention: event.currentTarget.checked })
            }
            classNames={{ root: classes.toggle }}
          />
          {shown.unwired.count > 0 && (
            <UnwiredRow
              unwired={shown.unwired}
              activeKey={focused?.key ?? null}
              onFocus={onFocus}
            />
          )}
        </>
      )}
    </Stack>
  );
}
