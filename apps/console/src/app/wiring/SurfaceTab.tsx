import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Collapse,
  GenericError,
  Group,
  Menu,
  Paper,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useLocalStorage, useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icon, Icons, type IconName } from '@mattstack/app-kit/icons';
import { useQueryClient } from '@tanstack/react-query';

import { useEditorHref } from '../editorHref';
import { StepLoader, useStepLoading } from '../StepLoader';
import { useReportReady } from './contentReady';
import { buildFocusGroups } from './graph/model/focusModel';
import {
  isBuiltIn,
  SURFACE_GROUP_ORDER,
  surfaceGroupsOf,
  type SurfaceGroupId,
} from './model/surfaceGroups';
import { suffixOf } from './outline';
import legendClasses from './SurfaceTab.module.css';
import type { SkillsSurfaceRow } from './useWiring';
import {
  guardedWrite,
  useCompositionSnapshot,
  useDisableModelInvocation,
  useSkillsApply,
  useSurface,
} from './useWiring';

/** Mirrors `SurfaceDelta` from rt's `commands/skills.ts` exactly -- this is
    not a parallel type, it is the same shape the CLI already exports. */
export interface SurfaceDelta {
  toPublic: string[];
  toInternal: string[];
}

/**
 * What Apply actually does to this row, in the reader's own words -- a
 * compiled row is never git-mv'd (`runApply` skips `classify === 'compiled'`
 * entirely; going internal just deletes its directory and stops regenerating
 * it, going public compiles it into existence), so it cannot share the
 * hand-authored row's "moves to attachments/" wording without lying about
 * one of the two kinds.
 */
function effectLine(
  row: SkillsSurfaceRow,
  next: 'public' | 'internal'
): string {
  if (row.kind === 'compiled') {
    return next === 'internal'
      ? `skills/${row.name}/ stops being compiled and is removed`
      : `compiled into skills/${row.name}/`;
  }
  if (row.kind === 'missing') {
    return `${row.name} has no files on disk -- rt will reject this name`;
  }
  return next === 'public'
    ? `attachments/${row.name}/ → skills/${row.name}/`
    : `skills/${row.name}/ → attachments/${row.name}/`;
}

/** One direction of the delta as the CLI would run it. Every name going the
    same direction lands in ONE `rt skills surface set` call, never one call
    per row: a `set` per name would cost one full pack compile per row and
    leave every intermediate state written to disk. */
function commandLine(
  names: string[],
  direction: 'public' | 'internal'
): string | null {
  if (names.length === 0) return null;
  // `names` is already sorted -- it comes straight out of `delta`.
  return `rt skills surface set ${names.join(' ')} --${direction}`;
}

/** Stable across re-renders with the same rows so the staging-reset effect
    below does not fire on every render -- only when the server truth the
    rows describe actually changes. */
function rowsSignature(rows: SkillsSurfaceRow[]): string {
  // `kind` is part of the truth: a row that becomes `missing` on refetch (same
  // name and status) must reset staging, or a since-invalid entry lingers in
  // the delta and Apply submits a name rt rejects.
  return rows.map(row => `${row.name}:${row.status}:${row.kind}`).join('|');
}

/**
 * The staged-edit state machine, unchanged from `SurfaceRoster`: toggling a
 * row writes nothing, it only moves a name into (or out of) the delta below.
 * A row reset back to its on-disk status drops out of the map entirely --
 * `delta` is a diff against disk, not an edit log -- and a fresh `rows` (a
 * successful apply, a pack switch) clears the whole map since it is no
 * longer a delta against what is on screen.
 */
function useSurfaceStaging(rows: SkillsSurfaceRow[], pack: string) {
  const [staged, setStaged] = useState<Map<string, 'public' | 'internal'>>(
    new Map()
  );

  // Clear on a pack switch as well as a row change: two packs can share a row
  // signature, and a stale delta must never be applied against a different pack.
  const signature = rowsSignature(rows);
  useEffect(() => {
    setStaged(new Map());
  }, [signature, pack]);

  const delta = useMemo<SurfaceDelta>(() => {
    const toPublic: string[] = [];
    const toInternal: string[] = [];
    for (const [name, status] of staged) {
      (status === 'public' ? toPublic : toInternal).push(name);
    }
    toPublic.sort();
    toInternal.sort();
    return { toPublic, toInternal };
  }, [staged]);

  function toggle(name: string) {
    const row = rows.find(r => r.name === name);
    // A `missing` skill has no files on disk; rt rejects it either direction,
    // so it can be read but never staged; a base fill stays internal because
    // rt refuses to make it public.
    if (!row || row.kind === 'missing' || row.fill) return;
    setStaged(prev => {
      const next = new Map(prev);
      const current = next.get(name) ?? row.status;
      const flipped = current === 'public' ? 'internal' : 'public';
      if (flipped === row.status) next.delete(name);
      else next.set(name, flipped);
      return next;
    });
  }

  return { staged, delta, toggle, discard: () => setStaged(new Map()) };
}

/** What the switch means, one quiet line above the list it governs; the
    group headings and each badge's hover card carry the rest. */
function SwitchKey() {
  return (
    <div className={legendClasses.switchKey} data-testid="surface-switch-key">
      <span className={legendClasses.switchKeyItem}>
        <Icon name="toggleRight" size={16} color="var(--tk-text-accent)" />
        <span className={legendClasses.switchKeyTerm}>On</span>
        In agents' skill list
      </span>
      <span className={legendClasses.switchKeyItem}>
        <Icon name="toggleLeft" size={16} color="var(--tk-text-3)" />
        <span className={legendClasses.switchKeyTerm}>Off</span>
        Only reached if another skill points here
      </span>
    </div>
  );
}

/** A badge that says what it means on hover, in place of a key. */
function KeyedBadge({
  meaning,
  children,
}: {
  meaning: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={meaning}>
      <span style={{ display: 'inline-flex', flex: 'none' }}>{children}</span>
    </Tooltip>
  );
}

export type SurfaceFilterKind =
  'all' | 'public' | 'internal' | 'base' | 'attention';

const FILTER_CHIPS: { key: 'all' | 'public' | 'internal'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'public', label: 'On' },
  { key: 'internal', label: 'Off' },
];

/** Surface.dc.html's `.rrow` radius (8px), the theme's `lg` step. */
const ROW_RADIUS = 'var(--mantine-radius-lg)';

interface FilterChipProps {
  id: string;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}

/**
 * Surface.dc.html's `.chip` is a true pill (999px radius) on a 26px-tall
 * control -- the theme's largest radius step is 10px, so this is a literal
 * with no token to reach for. The active fill/contrast pair are real theme
 * vars though (the same ones `WiringMap`'s bullet styling already uses
 * directly), so the color itself is never a hardcoded hex.
 */
function FilterChip({ id, label, count, active, onClick }: FilterChipProps) {
  const { bg, text, border } = useSchemeColors();
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={`surface-filter-${id}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 26,
        padding: '0 11px',
        borderRadius: 9999,
        border: `1px solid ${active ? 'var(--mantine-color-accent-filled)' : border.default}`,
        background: active ? 'var(--mantine-color-accent-filled)' : bg.level2,
        color: active ? 'var(--mantine-color-accent-contrast)' : text.muted,
        fontSize: 'var(--mantine-font-size-xs)',
        whiteSpace: 'nowrap',
      }}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span style={{ opacity: active ? 0.85 : 0.7 }}>{count}</span>
      )}
    </UnstyledButton>
  );
}

interface SurfaceGridRowProps {
  row: SkillsSurfaceRow;
  next: 'public' | 'internal';
  switchable: boolean;
  onToggle: (name: string) => void;
  /** Absolute path to the skill's source, joined from composition; null when
      it has no on-disk source to open (e.g. a `missing` row). */
  sourcePath: string | null;
  health: SkillHealth | null;
  onSetModelInvocation: (name: string, on: boolean) => void;
}

const MODEL_INVOCATION_INFO =
  'Can only be invoked by typing the skill call directly. Agents will not auto-discover this skill, or be able to invoke it themselves.';

/** The second line of a row with model invocation disabled. */
function ModelInvocationNote({ locked }: { locked: boolean }) {
  return (
    <div className={legendClasses.rowNote}>
      <span>Model invocation disabled</span>
      {locked && (
        <>
          <Icon name="lock" size={11} />
          <span>Set by the pack</span>
        </>
      )}
      <Tooltip
        label={MODEL_INVOCATION_INFO}
        multiline
        maw={298}
        events={{ hover: true, focus: true, touch: true }}
      >
        <span
          role="img"
          aria-label={MODEL_INVOCATION_INFO}
          tabIndex={0}
          className={legendClasses.rowNoteInfo}
        >
          <Icon name="info" size={12} />
        </span>
      </Tooltip>
    </div>
  );
}

/** The row's gear: a menu of one, which posts when clicked. */
function ModelInvocationMenu({
  name,
  state,
  onSet,
}: {
  name: string;
  state: 'on' | 'off' | 'locked';
  onSet: (name: string, on: boolean) => void;
}) {
  return (
    <Menu position="bottom-end" width={220} withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={`settings for ${name}`}
          data-testid={`surface-settings-${name}`}
          className={legendClasses.rowEdit}
          style={{ flex: 'none' }}
        >
          <Icons.settings size={14} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.CheckboxItem
          checked={state !== 'off'}
          disabled={state === 'locked'}
          closeMenuOnClick
          checkIcon={
            state === 'locked' ? (
              <Icon
                name="lock"
                size={12}
                color="var(--tk-text-3)"
                data-testid="dmi-lock"
              />
            ) : (
              <Icon
                name="check"
                size={12}
                color="var(--tk-text-accent)"
                data-testid="dmi-check"
              />
            )
          }
          onChange={on => onSet(name, on)}
        >
          Disable model invocation
        </Menu.CheckboxItem>
      </Menu.Dropdown>
    </Menu>
  );
}

const GROUPS: Record<
  SurfaceGroupId,
  { title: string; icon: IconName; note: (n: SurfaceGroupNote) => string }
> = {
  commands: {
    title: 'Commands',
    icon: 'squareTerminal',
    note: ({ publicCount }) => `${publicCount} on`,
  },
  reference: {
    title: 'Reference skills',
    icon: 'fileText',
    note: () => 'Read when needed',
  },
  stages: {
    title: 'Pipeline stages',
    icon: 'workflow',
    note: ({ pipeline }) =>
      pipeline ? `Run by /${pipeline}` : 'Run by a pipeline',
  },
  fills: {
    title: 'Fills',
    icon: 'puzzle',
    note: () => 'Plugged into blocks',
  },
};

type SurfaceGroupNote = { publicCount: number; pipeline: string | null };

/** One group of the list: a head that folds it, then its rows. */
function SurfaceGroup({
  id,
  rows,
  publicCount,
  pipeline,
  filtering,
  children,
}: {
  id: SurfaceGroupId;
  rows: readonly SkillsSurfaceRow[];
  publicCount: number;
  pipeline: string | null;
  /** A filter's matches stay in view whatever the head was left at. */
  filtering: boolean;
  children: React.ReactNode;
}) {
  const group = GROUPS[id];
  const [open, setOpen] = useLocalStorage<boolean>({
    key: `console-surface-group-${id}`,
    defaultValue: true,
  });
  const opened = filtering || (open ?? true);
  return (
    <section
      className={legendClasses.group}
      data-open={opened || undefined}
      data-testid={`surface-group-${id}`}
    >
      <UnstyledButton
        className={legendClasses.groupHead}
        aria-expanded={opened}
        onClick={() => setOpen(!opened)}
      >
        <Icon
          name="chevronRight"
          size={14}
          className={legendClasses.groupChevron}
          data-open={opened || undefined}
        />
        <Icon name={group.icon} size={14} color="var(--tk-text-2)" />
        <span className={legendClasses.groupTitle}>{group.title}</span>
        <span className={legendClasses.groupCount}>{rows.length}</span>
        <span className={legendClasses.groupNote}>
          {group.note({ publicCount, pipeline })}
        </span>
      </UnstyledButton>
      <Collapse expanded={opened}>
        <div className={legendClasses.groupRows}>{children}</div>
      </Collapse>
    </section>
  );
}

/** A staged row is outlined in the full accent (Surface.dc.html `.changed`);
    an unstaged public row keeps the `bg.level3` wash so "what's public right
    now" reads at a glance even with nothing pending. */
function SurfaceGridRow({
  row,
  next,
  switchable,
  onToggle,
  sourcePath,
  health,
  onSetModelInvocation,
}: SurfaceGridRowProps) {
  const { bg, text, border } = useSchemeColors();
  const editorHref = useEditorHref();
  const staged = next !== row.status;
  const modelInvocation = row.disableModelInvocation;

  return (
    <Box
      px="sm"
      py={6}
      className={legendClasses.row}
      data-no-switch={switchable ? undefined : true}
      bg={staged ? bg.color('accent') : undefined}
      style={{
        border: `1px solid ${staged ? border.color('accent') : 'transparent'}`,
        borderRadius: ROW_RADIUS,
      }}
      data-testid={`surface-row-${row.name}`}
    >
      {switchable && (
        <Switch
          checked={next === 'public'}
          onChange={() => onToggle(row.name)}
          aria-label={row.name}
          size="sm"
        />
      )}
      <div className={legendClasses.rowLine}>
        <Text size="sm" fw={600} style={{ flex: 'none' }}>
          {row.name}
        </Text>
        {row.base !== undefined && (
          <KeyedBadge meaning="From the parent pack. Edit it there">
            <Badge size="sm" variant="default" c={text.muted}>
              {row.base}
            </Badge>
          </KeyedBadge>
        )}
        {row.kind === 'missing' && (
          <KeyedBadge meaning="No files on disk">
            <Badge
              size="sm"
              variant="light"
              color="bad"
              className={legendClasses.kindBadge}
            >
              missing
            </Badge>
          </KeyedBadge>
        )}
        {health && (
          <span
            className={legendClasses.rowHealth}
            data-health={health}
            data-testid={`surface-health-${row.name}`}
          >
            {health === 'stale' ? 'source newer' : 'never compiled'}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }} />
        {staged ? (
          <Text
            size="xs"
            c={text.highContrast(next === 'internal' ? 'warn' : 'accent')}
            truncate
            style={{ flex: 'none', maxWidth: 220 }}
          >
            {effectLine(row, next)}
          </Text>
        ) : null}
        {sourcePath && (
          <Tooltip label="Open in editor" openDelay={300}>
            <ActionIcon
              component="a"
              href={editorHref(sourcePath)}
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={`open ${row.name} in editor`}
              data-testid={`surface-open-${row.name}`}
              className={legendClasses.rowEdit}
              style={{ flex: 'none' }}
            >
              <Icons.edit size={14} />
            </ActionIcon>
          </Tooltip>
        )}
        {modelInvocation && (
          <ModelInvocationMenu
            name={row.name}
            state={modelInvocation}
            onSet={onSetModelInvocation}
          />
        )}
      </div>
      {(modelInvocation === 'on' || modelInvocation === 'locked') && (
        <ModelInvocationNote locked={modelInvocation === 'locked'} />
      )}
    </Box>
  );
}

/** A skill's build state, as the Config tab's health strip counts it. */
export type SkillHealth = 'stale' | 'never-compiled';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export interface SurfaceTabProps {
  pack: string;
  /** Opens the tab that shows pipelines, stages and fills. */
  onOpenOverview?: () => void;
  /** Skills whose build needs attention; their rows say so, and a filter
      shows only them. */
  health?: ReadonlyMap<string, SkillHealth>;
  /** The filter, when a host drives it (the health strip's "Show these"). */
  filterKind?: SurfaceFilterKind;
  onFilterKind?: (kind: SurfaceFilterKind) => void;
}

/**
 * The promoted roster (formerly a drawer, `SurfaceRoster`): a 2-col grid,
 * filter bar, and a staged-changes footer, per Surface.dc.html. Fetches its
 * own data -- being the active tab IS the fetch trigger, there is no
 * separate "open" state above it anymore.
 */
export function SurfaceTab({
  pack,
  onOpenOverview,
  health,
  filterKind: hostFilter,
  onFilterKind,
}: SurfaceTabProps) {
  const { bg, text, border } = useSchemeColors();
  const surfaceQuery = useSurface(pack);
  const { show: held, bind: heldBind } = useStepLoading(surfaceQuery.isPending);
  useReportReady(!surfaceQuery.isPending && !held);
  const { surfaceApply, writing } = useSkillsApply(pack);
  const modelInvocationSet = useDisableModelInvocation(pack);
  const queryClient = useQueryClient();
  // Memoized so the `?? []` fallback isn't a fresh array reference on every
  // render -- `useSurfaceStaging` and the memos below key off this identity.
  const rows = useMemo(
    () => surfaceQuery.data?.rows ?? [],
    [surfaceQuery.data]
  );
  const { staged, delta, toggle, discard } = useSurfaceStaging(rows, pack);

  // Surface rows carry no path, so join composition (which does) by bare name
  // to offer a per-row "open in editor" link. A verb matches by name; a fill
  // by its binding suffix. Rows with no match (e.g. `missing`) get no link.
  const compositionQuery = useCompositionSnapshot(pack);
  const sourceByName = useMemo(() => {
    const map = new Map<string, string>();
    const comp = compositionQuery.data;
    if (comp) {
      for (const v of comp.verbs)
        if (v.sourcePath) map.set(v.name, v.sourcePath);
      for (const f of comp.fills)
        if (f.sourcePath) map.set(suffixOf(f.binding), f.sourcePath);
    }
    return map;
  }, [compositionQuery.data]);

  const groupOf = useMemo(() => {
    const comp = compositionQuery.data;
    const groups = comp ? buildFocusGroups(comp, undefined, rows) : null;
    return surfaceGroupsOf(rows, groups, comp);
  }, [compositionQuery.data, rows]);
  const pipelineName =
    compositionQuery.data?.verbs.find(verb => verb.name === 'work')?.name ??
    null;

  const [filterText, setFilterText] = useState('');
  const [ownFilter, setOwnFilter] = useState<SurfaceFilterKind>('all');
  const filterKind = hostFilter ?? ownFilter;
  const setFilterKind = onFilterKind ?? setOwnFilter;
  const attentionCount = health?.size ?? 0;
  const filtering = filterText.trim() !== '' || filterKind !== 'all';

  // Counts (and the kind/status filters) read the on-disk `rows`, never the
  // staged map -- a chip is a category of skill, not a preview of what Apply
  // will produce, so toggling a row must not shuffle it between chips.
  const listed = useMemo(
    () =>
      rows.filter(row => {
        const group = groupOf.get(row.name);
        return group === undefined || !isBuiltIn(group);
      }),
    [rows, groupOf]
  );
  const counts = useMemo(() => {
    let publicCount = 0;
    for (const row of listed) if (row.status === 'public') publicCount += 1;
    return {
      all: listed.length,
      public: publicCount,
      internal: listed.length - publicCount,
    };
  }, [listed]);
  const builtIn = useMemo(() => {
    const groups = rows.map(row => groupOf.get(row.name));
    return {
      stages: groups.filter(group => group === 'stages').length,
      fills: groups.filter(group => group === 'fills').length,
    };
  }, [rows, groupOf]);

  const baseRows = listed.filter(row => row.base !== undefined);
  const baseName = baseRows[0]?.base ?? null;

  const filteredRows = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    // A stage or fill with a stale build still has to be found from here.
    return (filterKind === 'attention' ? rows : listed).filter(row => {
      if (needle && !row.name.toLowerCase().includes(needle)) return false;
      if (filterKind === 'public') return row.status === 'public';
      if (filterKind === 'internal') return row.status === 'internal';
      if (filterKind === 'base') return row.base !== undefined;
      if (filterKind === 'attention') return health?.has(row.name) ?? false;
      return true;
    });
  }, [rows, listed, filterText, filterKind, health]);

  const lines = [
    commandLine(delta.toPublic, 'public'),
    commandLine(delta.toInternal, 'internal'),
  ].filter((line): line is string => line !== null);

  const applyError = surfaceApply.isError
    ? (surfaceApply.error as Error).message
    : surfaceApply.data && !surfaceApply.data.steps.every(step => step.ok)
      ? (surfaceApply.data.steps.find(step => !step.ok)?.error ??
        'apply failed')
      : null;

  const stagedLabel =
    staged.size === 0
      ? 'Nothing staged'
      : `${staged.size} change${staged.size === 1 ? '' : 's'} staged`;

  return (
    <Paper
      variant="ground"
      withBorder
      radius="xl"
      style={{ overflow: 'hidden' }}
      data-testid="surface-tab"
    >
      <Group
        wrap="wrap"
        gap={10}
        style={{
          padding: '13px 16px',
          borderBlock: `1px solid ${border.default}`,
          background: bg.level3,
        }}
      >
        <TextInput
          placeholder="Filter skills..."
          value={filterText}
          onTextChange={setFilterText}
          leftSection={<Icons.search size={14} />}
          size="xs"
          style={{ flex: 1, minWidth: 180 }}
          data-testid="surface-filter-input"
        />
        {FILTER_CHIPS.map(chip => (
          <FilterChip
            key={chip.key}
            id={chip.key}
            label={chip.label}
            count={counts[chip.key]}
            active={filterKind === chip.key}
            onClick={() => setFilterKind(chip.key)}
          />
        ))}
        {baseName !== null && (
          <FilterChip
            id="base"
            label={`From ${baseName}`}
            count={baseRows.length}
            active={filterKind === 'base'}
            onClick={() => setFilterKind('base')}
          />
        )}
        {attentionCount > 0 && (
          <FilterChip
            id="needs attention"
            label="Needs attention"
            count={attentionCount}
            active={filterKind === 'attention'}
            onClick={() => setFilterKind('attention')}
          />
        )}
      </Group>

      {surfaceQuery.isError ? (
        <Box p="xl">
          <GenericError
            title="Couldn't load the skills surface"
            message={(surfaceQuery.error as Error).message}
            onRetry={() => void surfaceQuery.refetch()}
          />
        </Box>
      ) : held ? (
        <Box px={28} py={12}>
          <StepLoader
            {...heldBind}
            testId="surface-loading"
            steps={[`rt skills surface list --pack ${pack}`]}
          />
        </Box>
      ) : (
        <div data-testid="surface-grid">
          <SwitchKey />
          {filteredRows.length === 0 ? (
            <Text size="sm" c={text.dimmed} style={{ gridColumn: '1 / -1' }}>
              No skills match this filter.
            </Text>
          ) : (
            SURFACE_GROUP_ORDER.map(id => {
              // What agents see comes first, then the rest by name.
              const members = filteredRows
                .filter(row => groupOf.get(row.name) === id)
                .sort(
                  (a, b) =>
                    Number(b.status === 'public') -
                      Number(a.status === 'public') ||
                    a.name.localeCompare(b.name)
                );
              if (members.length === 0) return null;
              return (
                <SurfaceGroup
                  key={id}
                  id={id}
                  rows={members}
                  publicCount={
                    members.filter(row => row.status === 'public').length
                  }
                  pipeline={pipelineName}
                  filtering={filtering}
                >
                  {members.map(row => (
                    <SurfaceGridRow
                      key={row.name}
                      row={row}
                      health={health?.get(row.name) ?? null}
                      next={staged.get(row.name) ?? row.status}
                      switchable={!isBuiltIn(id)}
                      onToggle={toggle}
                      onSetModelInvocation={(name, on) =>
                        modelInvocationSet.mutate({ name, on })
                      }
                      sourcePath={
                        row.base !== undefined
                          ? (row.basePath ?? null)
                          : (row.path ?? sourceByName.get(row.name) ?? null)
                      }
                    />
                  ))}
                </SurfaceGroup>
              );
            })
          )}
          {builtIn.stages + builtIn.fills > 0 && (
            <div
              className={legendClasses.builtIn}
              data-testid="surface-built-in"
            >
              <span>
                {plural(builtIn.stages, 'stage', 'stages')} and{' '}
                {plural(builtIn.fills, 'fill', 'fills')} are built into other
                skills
              </span>
              {onOpenOverview && (
                <UnstyledButton
                  type="button"
                  className={legendClasses.builtInLink}
                  onClick={onOpenOverview}
                >
                  See Overview
                </UnstyledButton>
              )}
            </div>
          )}
        </div>
      )}

      <Stack
        gap={6}
        style={{
          borderTop: `1px solid ${border.default}`,
          background: bg.level3,
          padding: '14px 18px',
        }}
      >
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" fw={600} style={{ flex: 'none' }}>
            {stagedLabel}
          </Text>
          {lines.length > 0 && (
            <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
              <Text
                size="xs"
                c={text.muted}
                ff="monospace"
                style={{ flex: 'none' }}
              >
                $
              </Text>
              <Text size="xs" ff="monospace" c={text.muted} truncate>
                {lines.join(' · ')}
              </Text>
            </Group>
          )}
          <Group gap={6} wrap="nowrap" style={{ flex: 'none' }}>
            <Button
              size="xs"
              variant="default"
              disabled={staged.size === 0 || writing}
              onClick={discard}
            >
              Discard
            </Button>
            <Button
              size="xs"
              disabled={staged.size === 0 || writing}
              loading={surfaceApply.isPending}
              onClick={() =>
                guardedWrite(queryClient, pack, () =>
                  surfaceApply.mutate(delta)
                )
              }
            >
              Apply
            </Button>
          </Group>
        </Group>

        {applyError && (
          <Alert variant="light" color="bad" icon={<Icons.error size={14} />}>
            <Text size="xs">{applyError}</Text>
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
