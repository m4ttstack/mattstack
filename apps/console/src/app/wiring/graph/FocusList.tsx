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

import type { SkillsCheck } from '../outline';
import classes from './graph.module.css';
import {
  onlyAttention,
  type FocusGroups,
  type FocusItem,
} from './model/focusModel';
import { StatusDot } from './StatusDot';
import { useGraphFocus } from './useGraphFocus';

const BODY = 'var(--tk-text-1)';
const SECONDARY = 'var(--tk-text-2)';
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

function AttentionDot() {
  return (
    <StatusDot tone="warn" data-parity="dot" data-testid="attention-dot" />
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <Box className={classes.group}>
      <Text
        fz={10}
        fw={500}
        lh="normal"
        lts="0.8px"
        tt="uppercase"
        c={MUTED}
        data-parity="l"
      >
        {children}
      </Text>
    </Box>
  );
}

/** An active row takes the NavLink's own active colour; a resting one names
    its text role. */
function RowLabel({
  text,
  size,
  active,
  rest,
  strong = false,
}: {
  text: string;
  size: number;
  active: boolean;
  rest: string;
  strong?: boolean;
}) {
  return (
    <Text
      span
      fz={size}
      fw={active || strong ? 500 : 400}
      c={active ? undefined : rest}
      data-parity="l"
    >
      {text}
    </Text>
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
      variant="wash"
      color="accent"
      active={active}
      label={
        <RowLabel text={item.label} size={13} active={active} rest={BODY} />
      }
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
      variant="wash"
      color="accent"
      active={active}
      label={
        <RowLabel
          text={item.label}
          size={12}
          active={active}
          rest={SECONDARY}
        />
      }
      leftSection={
        <Text
          span
          fz={10}
          lh="normal"
          c={active ? undefined : SECONDARY}
          className={classes.stepNumber}
          data-parity="n"
        >
          {item.step}
        </Text>
      }
      rightSection={item.attention ? <AttentionDot /> : undefined}
      classNames={STEP_ROW}
      data-parity={rowLayer(active, `stage · ${item.label}`)}
      data-testid={`focus-${item.key}`}
      onClick={() => onFocus(item.key)}
    />
  );
}

/**
 * Open while one of its steps has focus. The first click on a pipeline that
 * is not in focus focuses it and opens it; once in focus, a click folds and
 * unfolds it.
 */
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
      variant="wash"
      color="accent"
      active={active}
      label={
        <RowLabel
          text={item.label}
          size={13}
          active={active}
          rest={BODY}
          strong
        />
      }
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
          <Text span fz={11} lh="normal" c={MUTED} data-parity="sub">
            {item.children.length}
          </Text>
          {item.attention && <AttentionDot />}
        </Group>
      }
      opened={onStep || unfolded}
      keepMounted={false}
      childrenOffset={0}
      disableRightSectionRotation
      classNames={PIPELINE_ROW}
      data-parity={rowLayer(active, item.label)}
      data-testid={`focus-${item.key}`}
      onClick={() => {
        if (active) {
          setUnfolded(open => !open);
          return;
        }
        setUnfolded(true);
        onFocus(item.key);
      }}
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
        label={
          <RowLabel text="Unwired" size={12} active={false} rest={SECONDARY} />
        }
        leftSection={
          <Icon name="eyeOff" size={15} color={MUTED} data-parity="i" />
        }
        rightSection={
          <Group gap={8}>
            <Text
              span
              fz={11}
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
        <Text fz={12} c={MUTED} className={classes.notice}>
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

const isEmpty = (groups: FocusGroups) =>
  groups.pipelines.length === 0 &&
  groups.onDemand.length === 0 &&
  groups.board.length === 0 &&
  groups.unwired.count === 0;

/** An empty filtered list is a claim about a measurement, so it says which
    one it rests on: none, nothing to compare, or a clean compare. */
function AttentionEmpty({ check }: { check: SkillsCheck | undefined }) {
  const compared = check?.verbs.length ?? null;
  const line =
    compared === null
      ? 'Not measured: rt skills check did not answer, so this list is empty, not clean.'
      : compared === 0
        ? 'Nothing to check: rt skills check found no roster verbs to compare.'
        : `Nothing needs attention: rt skills check compared ${compared} roster ${compared === 1 ? 'verb' : 'verbs'} and none differed.`;
  return (
    <Text
      fz={12}
      c={MUTED}
      className={classes.notice}
      data-testid="attention-empty"
    >
      {line}
    </Text>
  );
}

/** The Graph tab's focus list, rendered as `PageShell.Sidebar` content. */
export function GraphSidebar({ pack }: { pack: string }) {
  const { url, patch, compositionQuery, checkQuery, groups, focused } =
    useGraphFocus(pack);
  const onFocus = (key: string) => patch({ focus: key });
  const shown = groups && url.attention ? onlyAttention(groups) : groups;
  // The filter reads drift from check, so its rows wait for check to answer.
  const ready =
    shown && !(url.attention && checkQuery.isPending) ? shown : null;

  if (compositionQuery.isError) {
    return (
      <Stack
        gap={2}
        className={classes.list}
        data-parity="Focus list"
        data-testid="focus-list"
      >
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
      </Stack>
    );
  }

  return (
    <Stack
      gap={2}
      className={classes.list}
      data-parity="Focus list"
      data-testid="focus-list"
    >
      {checkQuery.isError && !checkQuery.data && (
        <Alert
          variant="light"
          color="warn"
          icon={<Icon name="warning" size={14} />}
          data-testid="check-error"
        >
          <Text size="xs">
            rt skills check failed, so no row below can state its drift:{' '}
            {(checkQuery.error as Error).message}
          </Text>
        </Alert>
      )}
      {!ready ? (
        <Stack gap={2} data-testid="focus-list-loading">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} height={32} />
          ))}
        </Stack>
      ) : url.attention && isEmpty(ready) ? (
        <AttentionEmpty check={checkQuery.data} />
      ) : (
        <FocusGroupsList
          groups={ready}
          activeKey={focused?.key ?? null}
          onFocus={onFocus}
        />
      )}
      <Box className={classes.spacer} />
      <Switch
        variant="contrast"
        label="Needs attention"
        checked={url.attention}
        onChange={event => patch({ attention: event.currentTarget.checked })}
        classNames={{ root: classes.toggle }}
      />
      {ready && ready.unwired.count > 0 && (
        <UnwiredRow
          unwired={ready.unwired}
          activeKey={focused?.key ?? null}
          onFocus={onFocus}
        />
      )}
    </Stack>
  );
}
