import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import {
  ActionIcon,
  Alert,
  Collapse,
  Group,
  NavLink,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useLocalStorage } from '@mattstack/app-kit/hooks';
import { Icon, Icons } from '@mattstack/app-kit/icons';

import { BackPill } from '../../nav/BackPill';
import { StepLoader, useStepLoading } from '../../StepLoader';
import classes from './graph.module.css';
import {
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

function AttentionDot() {
  return (
    <StatusDot tone="warn" data-parity="dot" data-testid="attention-dot" />
  );
}

/** A sidebar group whose label folds it; each group remembers its fold. */
function FocusGroup({
  label,
  scope = '',
  count,
  defaultOpen = true,
  children,
}: {
  label: string;
  /** Keeps this list's folds apart from another list's group of that name. */
  scope?: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useLocalStorage<boolean>({
    key: `console-wiring-group-${scope}${label.toLowerCase()}`,
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
    its text role. Every row shares one face and size; a command's pack
    prefix reads quieter than its name, and the full text shows on hover
    once the row cuts it. */
function RowLabel({
  text,
  active,
  rest,
}: {
  text: string;
  active: boolean;
  rest: string;
}) {
  const split = /^(\/[^:]+:)(.+)$/.exec(text);
  return (
    <Text
      span
      fz="md"
      fw={active ? 500 : 400}
      c={active ? undefined : rest}
      truncate
      title={text}
      data-parity="l"
    >
      {split ? (
        <>
          <Text span inherit c="dimmed">
            {split[1]}
          </Text>
          {split[2]}
        </>
      ) : (
        text
      )}
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
          active={active}
          rest={BODY}
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
          <Text span fz="xs" lh="normal" c={MUTED}>
            {item.from ?? 'off'}
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
          active={active}
          rest={BODY}
        />
      }
      leftSection={
        <Text
          span
          fz="xs"
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
              active={active}
              rest={BODY}
            />
          }
          rightSection={
            <Group gap={8} wrap="nowrap">
              <Text span fz="xs" lh="normal" c={MUTED} data-parity="sub">
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
          <Text fz="xs" c={MUTED} className={classes.notice}>
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
          // A verb nothing binds still runs on its own, so it lists here.
          ['Commands', [...groups.standalone, ...groups.unwired.items]],
          ['Board', groups.board],
          ['Reference skills', groups.skills],
          ['Fills', groups.fills],
        ] as const
      ).map(
        ([label, items]) =>
          items.length > 0 && (
            <FocusGroup
              key={label}
              label={label}
              count={items.length}
              defaultOpen={label === 'Commands' || label === 'Board'}
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

/** The Overview tab's focus list, rendered as `PageShell.Sidebar` content. */
export function GraphSidebar({ pack }: { pack: string }) {
  const { patch, checkQuery, groups, focused } = useGraphFocus(pack);
  const onFocus = (key: string) => patch({ focus: key });
  const ready = groups ?? null;
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
            steps={[`rt skills composition --pack ${pack}`]}
          />
        ) : (
          <FocusGroupsList
            groups={ready}
            activeKey={focused?.key ?? null}
            onFocus={onFocus}
          />
        )}
      </Stack>
    </PackContext.Provider>
  );
}

/** The org base pack this pack extends, read-only: everything in it, each
    opening from its own file. */
export function BaseSidebar({ pack }: { pack: string }) {
  const { patch, groups, focused } = useGraphFocus(pack);
  const base = groups?.basePack;
  if (!base) return null;
  const onFocus = (key: string) => patch({ focus: key });
  const total = base.fills.length + base.reference.length;
  const lists = [
    ['Fills', base.fills],
    ['Reference skills', base.reference],
  ] as const;
  return (
    <PackContext.Provider value={pack}>
      <Stack gap={2} className={classes.list} data-testid="base-list">
        <BackPill
          label={pack}
          onClick={() => patch({ base: false, focus: null })}
          testId="base-back"
        />
        <div className={classes.baseHead}>
          <Text fw={500}>{base.name}</Text>
          <Text fz="xs" c={MUTED}>
            Org base pack, {total} skills
          </Text>
        </div>
        {lists.map(
          ([label, items]) =>
            items.length > 0 && (
              <FocusGroup
                key={label}
                label={label}
                scope="base-"
                count={items.length}
              >
                {items.map(item => (
                  <ItemRow
                    key={item.key}
                    item={item}
                    activeKey={focused?.key ?? null}
                    onFocus={onFocus}
                  />
                ))}
              </FocusGroup>
            )
        )}
      </Stack>
    </PackContext.Provider>
  );
}
