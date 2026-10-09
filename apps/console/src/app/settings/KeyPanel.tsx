import {
  Children,
  createContext,
  useContext,
  useEffect,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
} from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Menu,
  Popover,
  SegmentedControl,
  Skeleton,
  Stack,
  Table,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import { CodeMirror } from '@mattstack/app-kit/lazy';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { rowKind, type SchemaIssue } from '@mattstack/settings-kit/shapes';

import { analyzeChain, shortValue } from '../config/chain';
import { useAgentModels } from '../config/useSettings';
import { useEditorHref } from '../editorHref';
import { DivergedPanel } from './DivergedPanel';
import { DraftEditor } from './DraftEditor';
import { editorKind, formOf } from './formShape';
import { isDiverged, issueText, type WireIssue } from './issues';
import classes from './KeyPanel.module.css';
import { PanelToolbarSlot } from './PanelToolbar';
import { ProjectPicker } from './RowProject';
import { ScalarControl } from './ScalarControl';
import { ScopeBadge, ScopeDot } from './ScopeBadge';
import {
  useKeyExplain,
  useSettingsOrg,
  useSettingsRepo,
  useSettingsTeam,
  type ConsoleStore,
} from './useConsoleSettings';
import { useRowSave, type RowStore } from './useRowSave';
import {
  APPROVAL_KEY,
  cancelOnEscape,
  EDITOR_KINDS,
  isRung,
  isStoreScope,
  layerLabel,
  moveTargets,
  providerOf,
  repoLabel,
  rungBase,
  scopeLabel,
  type LayerScope,
  type Provider,
} from './view';

export type PanelTab = 'value' | 'where';
export type PanelStore = RowStore & Pick<ConsoleStore, 'prune'>;

/** `store`, calling `onChanged` after every settled write. */
export function notifying(
  store: PanelStore,
  onChanged?: () => void
): PanelStore {
  if (!onChanged) return store;
  const then = (err: string | null) => {
    onChanged();
    return err;
  };
  return {
    set: (...a: Parameters<PanelStore['set']>) => store.set(...a).then(then),
    unset: (...a: Parameters<PanelStore['unset']>) =>
      store.unset(...a).then(then),
    move: (...a: Parameters<PanelStore['move']>) => store.move(...a).then(then),
    prune: (...a: Parameters<PanelStore['prune']>) =>
      store.prune(...a).then(then),
  };
}

type Role = 'winner' | 'overridden' | 'contributor' | 'inert';

function Catalog({
  provider,
  children,
}: {
  provider: Provider;
  children: (suggestions?: string[]) => ReactNode;
}) {
  const models = useAgentModels(provider);
  return <>{children((models.data?.models ?? []).map(m => m.value))}</>;
}

export function Suggested({
  settingKey,
  children,
}: {
  settingKey: string;
  children: (suggestions?: string[]) => ReactNode;
}) {
  // Same rule as the Agents section: a provider's `.model` keys suggest
  // that provider's model catalog.
  const provider = settingKey.endsWith('.model')
    ? providerOf(settingKey)
    : null;
  return provider ? (
    <Catalog provider={provider}>{children}</Catalog>
  ) : (
    <>{children()}</>
  );
}

/** The def as if `row` were the only layer, so a scalar control edits that
    layer's own value. A layer's value is also what it authored, which a
    deep key's summary counts. */
function layerDef(def: SettingDefWire, row: ExplainRowWire): SettingDefWire {
  return {
    ...def,
    effective: {
      scope: row.scope,
      file: row.file,
      ...(row.present ? { value: row.value, authored: row.value } : {}),
    },
  };
}

/** A string reads bare; anything else, and an empty string, keeps its JSON
    text. */
function valueText(v: unknown): string {
  return typeof v === 'string' && v !== '' ? v : shortValue(v);
}

const STATUS: Partial<Record<Role, string>> = {
  winner: 'in effect',
  contributor: 'merged',
};

function Status({ role, row }: { role: Role; row: ExplainRowWire }) {
  const said = STATUS[role];
  return (
    <Group gap={6} wrap="nowrap">
      {row.shadowed && (
        <Badge color="warn" variant="light" tt="none">
          ignored, teamLocked
        </Badge>
      )}
      {row.invalid && (
        <Badge color="bad" variant="light" tt="none">
          refused
        </Badge>
      )}
      {said && (
        <Badge
          color="ok"
          variant="light"
          tt="none"
          leftSection={<Icons.check size={12} />}
        >
          {said}
        </Badge>
      )}
    </Group>
  );
}

function LayerBadge({ scope }: { scope: string }) {
  const { text } = useSchemeColors();
  if (rungBase(scope)) return <ScopeBadge scope={scope as LayerScope} />;
  if (scope === 'default') return <ScopeBadge scope="default" />;
  return (
    <Text fz={12} fw={500} c={text.muted}>
      {scope}
    </Text>
  );
}

/** Opens the panel's Value tab, where the value in effect is shown whole. */
const ShowValueTab = createContext<(() => void) | null>(null);

const POPOVER_MAX_PX = 320;

/** Two JSON values alike, whatever their objects' key order. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameJson(v, b[i]))
    );
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  const rb = b as Record<string, unknown>;
  return (
    ka.length === Object.keys(rb).length &&
    ka.every(k => k in rb && sameJson((a as Record<string, unknown>)[k], rb[k]))
  );
}

/** A composite layer value's shape, counted plainly. */
export function shapeOf(value: unknown): string {
  if (Array.isArray(value))
    return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  if (typeof value === 'object' && value !== null) {
    const n = Object.keys(value).length;
    return `${n} ${n === 1 ? 'field' : 'fields'}`;
  }
  return valueText(value);
}

/** A composite layer's value: its shape, opening the whole value. A layer
    whose value is the one in effect (it wins, or it is the only part of a
    merge) opens the Value tab; any other layer shows its own JSON. */
function CompositeValue({
  value,
  inEffect,
  muted,
  testId,
}: {
  value: unknown;
  inEffect: boolean;
  muted: boolean;
  testId: string;
}) {
  const showTab = useContext(ShowValueTab);
  const { text } = useSchemeColors();
  const shape = shapeOf(value);
  const json = JSON.stringify(value, null, 2);
  const trigger = (onClick?: () => void) => (
    <Button
      size="compact-sm"
      variant="subtle"
      color="gray"
      c={muted ? text.muted : undefined}
      rightSection={
        inEffect ? <Icons.arrowRight size={12} /> : <Icons.eye size={12} />
      }
      data-testid={testId}
      onClick={onClick}
    >
      {shape}
    </Button>
  );
  if (inEffect && showTab) return trigger(showTab);
  return (
    <Popover position="bottom-start" shadow="md" withinPortal>
      <Popover.Target>{trigger()}</Popover.Target>
      <Popover.Dropdown p={4} w={480}>
        <CodeMirror
          value={json}
          language="json"
          readOnly
          height={`${Math.min(POPOVER_MAX_PX, json.split('\n').length * 20 + 20)}px`}
        />
      </Popover.Dropdown>
    </Popover>
  );
}

function LayerValue({
  def,
  row,
  role,
}: {
  def: SettingDefWire;
  row: ExplainRowWire;
  role?: Role;
}) {
  const { text } = useSchemeColors();
  if (!row.present)
    return (
      <Text fz={13} lh="17px" c={text.muted}>
        not set
      </Text>
    );
  if (def.secret)
    return (
      <Text fz={13} lh="17px" c={text.muted}>
        present, never shown here
      </Text>
    );
  const composite = def.type === 'object' || def.type === 'array';
  const muted = role === 'overridden' || role === 'inert';
  if (composite)
    return (
      <CompositeValue
        value={row.value}
        inEffect={
          role === 'winner' ||
          (role === 'contributor' && sameJson(row.value, def.effective.value))
        }
        muted={muted}
        testId={`layer-value-${row.scope}`}
      />
    );
  // The status badge marks the layer in effect, so no weight does.
  return (
    <Text
      fz={13}
      lh="17px"
      ff="monospace"
      truncate
      c={muted ? text.muted : undefined}
      data-role={role}
      data-testid={`layer-value-${row.scope}`}
    >
      {valueText(row.value)}
    </Text>
  );
}

/** One layer's 38px line: its badge in the fixed column, then its value.
    `trailing` and `children` hold an editable line's status, actions and
    sub-lines. */
function Line({
  scope,
  value,
  onValueKeyDown,
  status,
  actions,
  editing = false,
  testId,
  children,
}: {
  scope: string;
  value: ReactNode;
  onValueKeyDown?: KeyboardEventHandler<HTMLTableCellElement>;
  status?: ReactNode;
  actions?: ReactNode;
  editing?: boolean;
  testId?: string;
  children?: ReactNode;
}) {
  // A layer's sub-lines and editor sit in a row of their own under it, in
  // the same tbody, so the pair hovers and reads as one layer.
  const below = Children.toArray(children).length > 0;
  return (
    <Table.Tbody
      className={classes.line}
      mod={{ editing }}
      data-testid={testId}
    >
      <Table.Tr>
        <Table.Td className={classes.scope}>
          <LayerBadge scope={scope} />
        </Table.Td>
        <Table.Td className={classes.value} onKeyDown={onValueKeyDown}>
          {value}
        </Table.Td>
        <Table.Td className={classes.status}>{status}</Table.Td>
        <Table.Td className={classes.actions}>{actions}</Table.Td>
      </Table.Tr>
      {below && (
        <Table.Tr>
          <Table.Td />
          <Table.Td colSpan={3} className={classes.below}>
            {children}
          </Table.Td>
        </Table.Tr>
      )}
    </Table.Tbody>
  );
}

/** The layers as a table: which layer, what it holds, how it counts, and
    what can be done there. */
function LayerTable({
  first = 'Layer',
  children,
}: {
  first?: string;
  children: ReactNode;
}) {
  return (
    <Box maw={840}>
      <Table
        variant="soft"
        radius="md"
        fullWidth
        withColumnBorders
        className={classes.layers}
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th className={classes.scope}>{first}</Table.Th>
            <Table.Th>Value</Table.Th>
            <Table.Th className={classes.status}>Status</Table.Th>
            <Table.Th className={classes.actions}>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        {children}
      </Table>
    </Box>
  );
}

function LayerLine({
  def,
  row,
  role,
  busy,
  onSet,
  onRemove,
  onMove,
  startEditing = false,
  replaceWith,
  reported,
}: {
  def: SettingDefWire;
  row: ExplainRowWire;
  role: Role;
  busy: boolean;
  onSet: (scope: string, value: unknown) => Promise<boolean>;
  onRemove: (scope: string) => Promise<boolean>;
  onMove: (from: string, to: string) => Promise<boolean>;
  startEditing?: boolean;
  replaceWith?: { label: string; value: unknown };
  reported?: SchemaIssue[];
}) {
  const { text } = useSchemeColors();
  const editorHref = useEditorHref();
  const team = useSettingsTeam();
  const org = useSettingsOrg();
  const repo = useSettingsRepo();
  const scope = row.scope;
  const store = rungBase(scope);
  // Accessible names keep the nameless label; only the text a person reads
  // names the org or the team.
  const label = store ? layerLabel(scope as LayerScope) : null;
  const named = store ? layerLabel(scope as LayerScope, team, org) : null;
  const allRepos =
    repo && def.repoScoped && isStoreScope(scope) ? ' (all repos)' : '';
  const allowed = store !== null && def.scopes.includes(store);
  const writable = allowed && def.writable && !def.secret;
  const kind = rowKind(def);
  const edit = editorKind(def);
  const composite = def.type === 'object' || def.type === 'array';
  // console never edits this key here: it is revoked from /settings, not
  // set through a free-text control.
  const editable =
    def.key !== APPROVAL_KEY &&
    !(def.repoOnly && !isRung(scope)) &&
    writable &&
    (composite ? EDITOR_KINDS.has(edit) : kind === 'scalar' || kind === 'enum');
  const moves =
    writable && scope === def.effective.scope ? moveTargets(def) : [];
  // Fix seeds editing open only when the row is editable; a row with no
  // console control keeps Remove as its only remedy.
  const [editing, setEditing] = useState(startEditing && editable);
  // Only the editor Fix opened scrolls to its bad field; a reopen does not.
  const [reveal, setReveal] = useState(startEditing);
  useEffect(() => {
    if (!editing) setReveal(false);
  }, [editing]);
  const [saved, setSaved] = useState(false);
  // Close on the re-read, not the write, so the old value never flashes.
  useEffect(() => {
    if (!saved) return;
    setSaved(false);
    setEditing(false);
  }, [row]); // eslint-disable-line react-hooks/exhaustive-deps

  let value: ReactNode;
  if (editing && store && !composite)
    value = (
      <Suggested settingKey={def.key}>
        {suggestions => (
          <ScalarControl
            def={layerDef(def, row)}
            writeScope={scope}
            suggestions={suggestions}
            onSave={v =>
              void (v === undefined ? onRemove(scope) : onSet(scope, v)).then(
                ok => ok && setSaved(true)
              )
            }
          />
        )}
      </Suggested>
    );
  else if (editing && composite)
    value = (
      <Text fz={12} c={text.muted}>
        editing below
      </Text>
    );
  else value = <LayerValue def={def} row={row} role={role} />;

  const issues =
    editing && composite ? [] : (reported ?? row.nonconforming ?? []);
  const stray = row.present && store !== null && !allowed;
  const offerOlder = replaceWith && !composite && editable && store;
  const subs =
    Boolean(row.invalid) || issues.length > 0 || stray || Boolean(offerOlder);

  const status = <Status role={role} row={row} />;
  const canEdit = editable && store !== null;
  const canRemove = writable && store !== null && row.present;
  // Each item keeps the accessible name its own button had.
  const actions = (row.file !== null ||
    canEdit ||
    moves.length > 0 ||
    canRemove) && (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          disabled={busy}
          aria-label={`actions for ${def.key} at ${label ?? scope}`}
        >
          <Icons.moreHorizontal size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {canEdit && (
          <Menu.Item
            leftSection={
              editing ? <Icons.close size={14} /> : <Icons.edit size={14} />
            }
            aria-label={
              editing
                ? `cancel editing ${def.key} at ${label}`
                : `set ${def.key} at ${label}`
            }
            onClick={() => setEditing(e => !e)}
          >
            {editing ? 'Cancel editing' : `Set at ${named}`}
          </Menu.Item>
        )}
        {row.file !== null && (
          <Menu.Item
            component="a"
            href={editorHref(row.file)}
            leftSection={<Icons.externalLink size={14} />}
            aria-label={`open ${row.file}`}
          >
            Open the file
          </Menu.Item>
        )}
        {moves.length > 0 && (
          <>
            <Menu.Divider />
            {moves.map(to => (
              <Menu.Item
                key={to}
                leftSection={<ScopeDot scope={to} />}
                onClick={() => void onMove(scope, to)}
              >
                {`Move to ${scopeLabel(to, team, org)}`}
              </Menu.Item>
            ))}
          </>
        )}
        {canRemove && (
          <>
            <Menu.Divider />
            <Menu.Item
              color="bad"
              leftSection={<Icons.trash size={14} />}
              aria-label={`remove ${def.key} from ${label}`}
              onClick={() => void onRemove(scope)}
            >
              {`Remove from ${named}${allRepos}`}
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );

  return (
    <Line
      scope={scope}
      value={value}
      onValueKeyDown={
        editing && store && !composite
          ? cancelOnEscape(() => setEditing(false))
          : undefined
      }
      status={status}
      actions={actions}
      editing={editing}
      testId={`layer-${scope}`}
    >
      {subs && (
        <Stack gap={2}>
          {row.invalid && (
            <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)">
              {row.invalid}
            </Text>
          )}
          {issues.map((issue, i) => (
            <Text key={i} fz={12} ff="monospace" c="var(--tk-text-warn-small)">
              {issueText(issue)}
            </Text>
          ))}
          {stray && (
            <Text fz={12} c={text.muted}>
              not allowed here
            </Text>
          )}
          {offerOlder && (
            <Group gap={8} wrap="nowrap" py={2}>
              <Text fz={12} c={text.muted}>
                older value{' '}
                <Text span inherit ff="monospace">
                  {JSON.stringify(replaceWith.value)}
                </Text>
              </Text>
              <Button
                size="sm"
                variant="default"
                disabled={busy}
                onClick={() =>
                  void onSet(scope, replaceWith.value).then(
                    ok => ok && setSaved(true)
                  )
                }
              >
                {replaceWith.label}
              </Button>
            </Group>
          )}
        </Stack>
      )}
      {editing && composite && store && (
        <Box>
          <DraftEditor
            def={def}
            form={formOf(def)}
            initial={row.present ? row.value : undefined}
            // Fix's bad field is highlighted and scrolled to only in the form.
            startIn={reveal ? 'form' : 'json'}
            targetLabel={layerLabel(scope as LayerScope, team, org)}
            saving={busy}
            replaceWith={replaceWith}
            reported={reported}
            reveal={reveal}
            onCancel={() => setEditing(false)}
            onSave={v =>
              onSet(scope, v).then(ok => {
                if (ok) setSaved(true);
                return ok;
              })
            }
          />
        </Box>
      )}
    </Line>
  );
}

function RepoSection({
  def,
  identity,
  onPick,
}: {
  def: SettingDefWire;
  identity: string;
  onPick?: (repo: string) => void;
}) {
  const { text } = useSchemeColors();
  const { rows, loading } = useKeyExplain(def.key, identity);
  const set = rows.filter(r => r.present && isRung(r.scope));
  return (
    <Box className={classes.repo} data-testid={`repo-${identity}`}>
      <Group
        gap={12}
        wrap="nowrap"
        justify="space-between"
        className={classes.repoHead}
      >
        <Text fz={13} ff="monospace">
          {repoLabel(identity)}
        </Text>
        {onPick && (
          <Button
            size="sm"
            variant="default"
            aria-label={`Edit ${repoLabel(identity)}`}
            onClick={() => onPick(identity)}
          >
            Edit
          </Button>
        )}
      </Group>
      {loading && rows.length === 0 ? (
        <Skeleton h={38} />
      ) : (
        // The section header already names the repo, so each line's badge
        // names only the store.
        set.length > 0 && (
          <LayerTable first="Store">
            {set.map(r => (
              <Line
                key={r.scope}
                scope={rungBase(r.scope) ?? r.scope}
                value={<LayerValue def={def} row={r} />}
              />
            ))}
          </LayerTable>
        )
      )}
      {!loading && set.length === 0 && (
        <Text fz={12} c={text.muted} className={classes.repoNote}>
          no repo section sets it now
        </Text>
      )}
    </Box>
  );
}

/** The tab lists the picked repo's rungs only, so an issue on another
    repo's rung has no layer line here. */
function onPickedLayer(issue: WireIssue, repo: string | null): boolean {
  return !isRung(issue.scope) || issue.repo === repo;
}

/** Whether an open Where it's set tab draws this issue: a diverged value as
    a panel below the layers (never for a secret key), any other issue under
    its own layer line. The row above it leaves out what this draws. */
export function whereDraws(
  def: Pick<SettingDefWire, 'secret'>,
  issue: WireIssue,
  repo: string | null
): boolean {
  return isDiverged(issue) ? !def.secret : onPickedLayer(issue, repo);
}

function WhereTab({
  def: storeDef,
  store,
  fix,
  externalWrites,
  onChanged,
  onPickRepo,
}: {
  def: SettingDefWire;
  store: PanelStore;
  fix?: string | null;
  externalWrites?: number;
  onChanged?: () => void;
  onPickRepo?: (repo: string) => void;
}) {
  const { text } = useSchemeColors();
  const repo = useSettingsRepo();
  const explained = useKeyExplain(storeDef.key, repo, externalWrites);
  const [pruneError, setPruneError] = useState<string | null>(null);
  const { refresh, rows, loading } = explained;
  // A settled explain read is fresher than a store loaded when the page
  // mounted; while a re-read runs, the store already holds the write.
  // settings-kit 0.5.0's /explain route never sets `repos`, `issues` or
  // `mergedIssues` (those come from /defs only), so they are carried over
  // from storeDef regardless of freshness -- otherwise the diverged panel
  // and the panel's own issue lines never render on real data.
  const def =
    !loading && explained.def
      ? {
          ...explained.def,
          repos: explained.def.repos ?? storeDef.repos,
          issues: explained.def.issues ?? storeDef.issues,
          mergedIssues: explained.def.mergedIssues ?? storeDef.mergedIssues,
        }
      : storeDef;

  // /explain never re-reads `issues`, so an issue carried from storeDef is
  // stale for a layer written here until /defs is read again: each mark
  // holds the `issues` the store had when the write began.
  const [written, setWritten] = useState<ReadonlyMap<string, unknown>>(
    new Map()
  );
  const wrote = (issues: unknown, ...scopes: string[]) =>
    setWritten(w => new Map([...w, ...scopes.map(s => [s, issues] as const)]));
  // A rung is written per repo, so its mark carries the repo it landed in.
  const rung = (scope: string, target?: string) =>
    target ? `${scope}.repo@${target}` : scope;
  // A failed move can still have written its target, so every settled write
  // re-reads the stack; prune goes through the same path as any other write.
  const tracked: PanelStore = {
    set: async (...a) => {
      const issues = storeDef.issues;
      const err = await store.set(...a);
      if (!err) wrote(issues, rung(a[1], a[3]));
      return after(err);
    },
    unset: async (...a) => {
      const issues = storeDef.issues;
      const err = await store.unset(...a);
      if (!err) wrote(issues, rung(a[1], a[2]));
      return after(err);
    },
    move: async (...a) => {
      const issues = storeDef.issues;
      const err = await store.move(...a);
      wrote(issues, ...(err ? [a[2]] : [a[1], a[2]]));
      return after(err);
    },
    prune: async (...a) => after(await store.prune(...a)),
  };
  function after(err: string | null) {
    refresh();
    onChanged?.();
    return err;
  }
  const layers = useRowSave(tracked, def);
  const verdict = rows.length > 0 ? analyzeChain(def, rows) : null;
  const roleOf = (row: ExplainRowWire): Role => {
    if (!verdict) return 'inert';
    if (verdict.kind === 'composite')
      return verdict.contributors.includes(row) ? 'contributor' : 'inert';
    if (verdict.winner === row) return 'winner';
    return verdict.overridden.includes(row) ? 'overridden' : 'inert';
  };
  const diverged = (def.issues ?? [])
    .filter(isDiverged)
    .filter(issue => whereDraws(def, issue, repo));
  const onLayer = (row: ExplainRowWire) => (issue: WireIssue) =>
    issue.scope === row.scope && onPickedLayer(issue, repo);
  const replaceWithFor = (row: ExplainRowWire) => {
    const issue = diverged.find(onLayer(row));
    return issue
      ? { label: 'Use the older value', value: issue.olderValue }
      : undefined;
  };

  // /explain rows may omit a layer's nonconforming issues that /defs
  // reported, and those are the ones Fix was opened from.
  const stale = (row: ExplainRowWire) => {
    const mark = isRung(row.scope) ? `${row.scope}@${repo}` : row.scope;
    return written.has(mark) && written.get(mark) === storeDef.issues;
  };
  const reportedFor = (row: ExplainRowWire): SchemaIssue[] => {
    const seen = new Set<string>();
    return [
      ...(row.nonconforming ?? []),
      ...(stale(row) ? [] : (def.issues ?? []))
        .filter(
          i =>
            i.kind === 'nonconforming' &&
            i.scope === row.scope &&
            whereDraws(def, i, repo)
        )
        .map(i => ({ path: i.path, message: i.message })),
    ].filter(i => {
      const id = JSON.stringify([i.path, i.message]);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };

  const shown = (r: ExplainRowWire) => {
    const base = rungBase(r.scope);
    if (base === null) return true;
    if (!def.scopes.includes(base)) return r.present;
    // A repo-only key's global layers only matter when one holds a stray
    // value to remove.
    return !def.repoOnly || r.present || isRung(r.scope);
  };

  return (
    <Stack gap={0}>
      <Text fz={12} lh="15px" c={text.muted} className={classes.caption}>
        {def.merge === 'deep' && def.type === 'object'
          ? 'Merged key by key. Lists replace whole.'
          : def.merge === 'add'
            ? 'Every layer adds its items.'
            : 'Weakest first. The last layer set wins.'}
      </Text>
      {explained.error ? (
        <Alert color="bad" variant="light" mt="md">
          <Text fz={12}>{explained.error}</Text>
        </Alert>
      ) : loading && rows.length === 0 ? (
        // Skeletons only before the first read: a re-read after a write
        // keeps the layers on screen.
        <Stack gap={10} pt={12}>
          {[0, 1, 2].map(i => (
            <Skeleton key={i} h={36} />
          ))}
        </Stack>
      ) : (
        <LayerTable>
          {rows.filter(shown).map(r => (
            <LayerLine
              key={`${r.scope}:${r.file ?? 'default'}`}
              def={def}
              row={r}
              role={roleOf(r)}
              busy={layers.status === 'saving'}
              onSet={(scope, v) => layers.setAt(scope, v)}
              onRemove={scope => layers.clear(scope)}
              onMove={(from, to) => layers.move(from, to)}
              startEditing={r.scope === fix && r.present}
              replaceWith={replaceWithFor(r)}
              reported={reportedFor(r)}
            />
          ))}
        </LayerTable>
      )}
      {layers.error && (
        <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)" pt={8}>
          {layers.error}
        </Text>
      )}
      {diverged.map((issue, i) => (
        <DivergedPanel
          key={i}
          issue={issue}
          onPrune={() => {
            setPruneError(null);
            const base = rungBase(issue.scope)!;
            const op = issue.repo
              ? tracked.prune(def.key, base, issue.storeName, issue.repo)
              : tracked.prune(def.key, base, issue.storeName);
            void op.then(err => err && setPruneError(err));
          }}
        />
      ))}
      {pruneError && (
        <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)" pt={8}>
          {pruneError}
        </Text>
      )}
      {def.secret && (
        <Alert variant="light" mt="md" icon={<Icons.warning size={14} />}>
          <Text fz={12}>
            Secret key: the console shows presence and store only. Rotate with{' '}
            <Text span ff="monospace" fz={12}>
              {`rt secrets rotate ${def.key.split('.')[0]} ${def.key.split('.').slice(1).join('.')}`}
            </Text>
            ; the value is prompted, never a CLI argument.
          </Text>
        </Alert>
      )}
      {def.repoScoped && repo === null && (def.repos?.length ?? 0) > 0 && (
        <>
          <Group gap={8} wrap="nowrap" className={classes.reposHead}>
            <Text fz={12} fw={500} tt="uppercase" lts={0.6} c={text.muted}>
              Projects
            </Text>
            <Text fz={12} c={text.muted}>
              · each project's value, from every layer that sets it
            </Text>
          </Group>
          {def.repos!.map(r => (
            <RepoSection
              key={r.identity}
              def={def}
              identity={r.identity}
              onPick={onPickRepo}
            />
          ))}
        </>
      )}
      {def.repoScoped && repo === null && onPickRepo && (
        <Group gap={8} wrap="nowrap" data-testid="another-project">
          <ProjectPicker
            def={def}
            value={null}
            onPick={onPickRepo}
            exclude={(def.repos ?? []).map(r => r.identity)}
            placeholder={
              (def.repos?.length ?? 0) > 0
                ? 'Set it for another project'
                : 'Set it for a project'
            }
            label="set it for another project"
          />
        </Group>
      )}
    </Stack>
  );
}

/** One key's panel: the Value tab the caller draws, and every layer that
    could set the key, weakest first. `externalWrites` counts the caller's
    own writes beside the panel; each new count re-reads the layers. */
export function KeyPanel({
  def,
  store,
  tab,
  onTab,
  value,
  fix,
  externalWrites,
  onChanged,
  onPickRepo,
}: {
  def: SettingDefWire;
  store: PanelStore;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  value: ReactNode;
  fix?: string | null;
  externalWrites?: number;
  onChanged?: () => void;
  onPickRepo?: (repo: string) => void;
}) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const repo = useSettingsRepo();
  return (
    <Stack gap={10}>
      <Group justify="space-between" wrap="nowrap" gap={12}>
        <SegmentedControl
          size="sm"
          aria-label={`${def.key} panel`}
          value={tab}
          onChange={v => onTab(v === 'value' ? 'value' : 'where')}
          data={[
            { value: 'value', label: 'Value' },
            { value: 'where', label: "Where it's set" },
          ]}
        />
        <div
          ref={setSlot}
          className={classes.toolbar}
          data-testid="panel-toolbar"
        />
      </Group>
      {tab === 'value' ? (
        <PanelToolbarSlot.Provider value={slot}>
          {value}
        </PanelToolbarSlot.Provider>
      ) : (
        // A new Fix on the open panel starts its layer's editor afresh. A
        // repo switch does too: a rung's line is the same for every repo,
        // and its editor would save the old repo's draft into the new one.
        <ShowValueTab.Provider value={() => onTab('value')}>
          <WhereTab
            key={`${def.key}:${fix ?? ''}:${repo ?? ''}`}
            def={def}
            store={store}
            fix={fix}
            externalWrites={externalWrites}
            onChanged={onChanged}
            onPickRepo={onPickRepo}
          />
        </ShowValueTab.Provider>
      )}
    </Stack>
  );
}
