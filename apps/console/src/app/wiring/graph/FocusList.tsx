import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActionIcon,
  Alert,
  Box,
  Collapse,
  Divider,
  Group,
  NavLink,
  Stack,
  Switch,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useLocalStorage } from '@mattstack/app-kit/hooks';
import { Icon, Icons } from '@mattstack/app-kit/icons';

import { StepLoader, useStepLoading } from '../../StepLoader';
import type { SkillsCheck } from '../outline';
import classes from './graph.module.css';
import {
  onlyAttention,
  workTypeOf,
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
const UNWIRED_ROW = { root: classes.unwired, section: classes.section };

function AttentionDot() {
  return (
    <StatusDot tone="warn" data-parity="dot" data-testid="attention-dot" />
  );
}

/** A sidebar group whose label folds it; each group remembers its fold. */
function FocusGroup({
  label,
  count,
  defaultOpen = true,
  children,
}: {
  label: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useLocalStorage<boolean>({
    key: `console-wiring-group-${label.toLowerCase()}`,
    defaultValue: defaultOpen,
  });
  return (
    <>
      <UnstyledButton
        className={classes.groupToggle}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open ?? defaultOpen}
        data-testid={`focus-group-${label.toLowerCase()}`}
      >
        <Icons.chevronRight
          size={14}
          className={classes.groupChevron}
          data-open={(open ?? defaultOpen) || undefined}
        />
        <span className={classes.groupLabel} data-parity="l">
          {label}
        </span>
        {count !== undefined && (
          <span className={classes.groupCount}>{count}</span>
        )}
      </UnstyledButton>
      <Collapse expanded={open ?? defaultOpen}>{children}</Collapse>
    </>
  );
}

/** An active row takes the NavLink's own active colour; a resting one names
    its text role. */
function RowLabel({
  text,
  size,
  active,
  rest,
  mono = false,
}: {
  text: string;
  size: number;
  active: boolean;
  rest: string;
  /** A skill's name as Claude Code shows it. */
  mono?: boolean;
}) {
  return (
    <Text
      span
      fz={mono ? size - 0.5 : size}
      fw={active ? 500 : 400}
      ff={mono ? 'monospace' : undefined}
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

/** What you type in Claude Code for a row, prefix and all; null for a
    skill the pack does not surface. */
const typed = (pack: string, item: FocusItem) =>
  item.command ? `/${pack}:${item.command}` : null;

/** The pack whose commands the rows name, for their prefix. */
const PackContext = createContext('');

function ItemRow({
  item,
  activeKey,
  onFocus,
}: {
  item: FocusItem;
  activeKey: string | null;
  onFocus: (key: string) => void;
}) {
  const pack = useContext(PackContext);
  const active = item.key === activeKey;
  return (
    <NavLink
      component="button"
      type="button"
      color="accent"
      active={active}
      label={
        <RowLabel
          text={typed(pack, item) ?? item.label}
          size={13}
          active={active}
          rest={BODY}
          mono
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
        item.attention ? (
          <AttentionDot />
        ) : item.icon === 'lock' ? (
          <Text span fz={11} lh="normal" c={MUTED}>
            internal
          </Text>
        ) : undefined
      }
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
  const pack = useContext(PackContext);
  const active = item.key === activeKey;
  return (
    <NavLink
      component="button"
      type="button"
      color="accent"
      active={active}
      label={
        <RowLabel
          text={typed(pack, item) ?? item.label}
          size={13}
          active={active}
          rest={BODY}
          mono={item.command !== undefined}
        />
      }
      leftSection={
        <Text
          span
          fz={11}
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

/** A pipeline by the command that runs it. Its name opens its page; the
    chevron beside it folds its stages, kept open while one is in focus. */
function PipelineRow({
  item,
  activeKey,
  onFocus,
}: {
  item: FocusItem;
  activeKey: string | null;
  onFocus: (key: string) => void;
}) {
  const pack = useContext(PackContext);
  const active = item.key === activeKey;
  const holdsFocus = item.children.some(step => step.key === activeKey);
  const [open, setOpen] = useLocalStorage<boolean>({
    key: `console-wiring-pipeline-${item.key}`,
    defaultValue: true,
  });
  const opened = (open ?? true) || holdsFocus;
  return (
    <div data-testid={`pipeline-${item.key}`}>
      <div className={classes.pipelineHead}>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={`${opened ? 'Fold' : 'Unfold'} ${item.label}`}
          aria-expanded={opened}
          disabled={holdsFocus}
          onClick={() => setOpen(!opened)}
          data-testid={`fold-${item.key}`}
        >
          <Icons.chevronRight
            size={14}
            className={classes.groupChevron}
            data-open={opened || undefined}
          />
        </ActionIcon>
        <NavLink
          component="button"
          type="button"
          color="accent"
          active={active}
          label={
            <RowLabel
              text={typed(pack, item) ?? item.label}
              size={13}
              active={active}
              rest={BODY}
              mono
            />
          }
          rightSection={
            <Group gap={8} wrap="nowrap">
              <Text span fz={11} lh="normal" c={MUTED} data-parity="sub">
                {workTypeOf(item.key)}
              </Text>
              {item.attention && <AttentionDot />}
            </Group>
          }
          classNames={ROW}
          data-parity={rowLayer(active, item.label)}
          data-testid={`focus-${item.key}`}
          onClick={() => onFocus(item.key)}
        />
      </div>
      <Collapse expanded={opened}>
        <div className={classes.children}>
          {item.children.map(step => (
            <StepRow
              key={step.key}
              item={step}
              activeKey={activeKey}
              onFocus={onFocus}
            />
          ))}
        </div>
      </Collapse>
    </div>
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
      <FocusGroup label="Pipelines" count={groups.pipelines.length}>
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
      </FocusGroup>
      {(
        [
          ['Commands', groups.standalone],
          ['Board', groups.board],
          ['Standard', groups.skills],
        ] as const
      ).map(
        ([label, items]) =>
          items.length > 0 && (
            <FocusGroup
              key={label}
              label={label}
              count={items.length}
              defaultOpen={label !== 'Standard'}
            >
              {items.map(item => (
                <ItemRow
                  key={item.key}
                  item={item}
                  activeKey={activeKey}
                  onFocus={onFocus}
                />
              ))}
            </FocusGroup>
          )
      )}
    </>
  );
}

const isEmpty = (groups: FocusGroups) =>
  groups.pipelines.length === 0 &&
  groups.standalone.length === 0 &&
  groups.board.length === 0 &&
  groups.skills.length === 0 &&
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
  const { url, patch, checkQuery, groups, focused } = useGraphFocus(pack);
  const onFocus = (key: string) => patch({ focus: key });
  const shown = groups && url.attention ? onlyAttention(groups) : groups;
  // The filter reads drift from check, so its rows wait for check to answer.
  const ready =
    shown && !(url.attention && checkQuery.isPending) ? shown : null;
  const { show: held, bind: heldBind } = useStepLoading(!ready);

  return (
    <PackContext.Provider value={pack}>
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
        {!ready || held ? (
          <StepLoader
            {...heldBind}
            testId="focus-list-loading"
            steps={[
              url.attention && groups
                ? `rt skills check --pack ${pack}`
                : `rt skills composition --pack ${pack}`,
            ]}
          />
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
    </PackContext.Provider>
  );
}
