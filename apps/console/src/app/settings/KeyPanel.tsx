import { useEffect, useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Menu,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { rowKind, type SchemaIssue } from '@mattstack/settings-kit/shapes';

import { analyzeChain, shortValue } from '../config/chain';
import { useAgentModels } from '../config/useSettings';
import { useEditorHref } from '../editorHref';
import { rowSummary } from './CompositeControls';
import { DivergedPanel } from './DivergedPanel';
import { DraftEditor } from './DraftEditor';
import { editorKind, formOf } from './formShape';
import { isDiverged, issueText, type WireIssue } from './issues';
import { JsonBlock } from './JsonBlock';
import classes from './KeyPanel.module.css';
import { PanelToolbarSlot } from './PanelToolbar';
import { ScalarControl } from './ScalarControl';
import { ScopeBadge, ScopeDot } from './ScopeBadge';
import {
  useKeyExplain,
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
    layer's own value. */
function layerDef(def: SettingDefWire, row: ExplainRowWire): SettingDefWire {
  return {
    ...def,
    effective: {
      scope: row.scope,
      file: row.file,
      ...(row.present ? { value: row.value } : {}),
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
    <Group gap={8} wrap="nowrap">
      {row.shadowed && (
        <Text fz={12} c="var(--tk-text-warn-small)">
          ignored, teamLocked
        </Text>
      )}
      {row.invalid && (
        <Text fz={12} c="var(--tk-text-bad-small)">
          refused
        </Text>
      )}
      {said && (
        <Group gap={4} wrap="nowrap">
          <Icons.check size={12} color="var(--tk-text-ok-vivid)" />
          <Text fz={12} c="var(--tk-text-ok-small)">
            {said}
          </Text>
        </Group>
      )}
    </Group>
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
  const repo = useSettingsRepo();
  const scope = row.scope;
  const store = rungBase(scope);
  // Accessible names keep the team-less label; only the text a person reads
  // names the team.
  const label = store ? layerLabel(scope as LayerScope) : null;
  const named = store ? layerLabel(scope as LayerScope, team) : null;
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
  else if (!row.present)
    value = (
      <Text fz={13} lh="17px" c={text.muted}>
        not set
      </Text>
    );
  else if (def.secret)
    value = (
      <Text fz={13} lh="17px" c={text.muted}>
        present, never shown here
      </Text>
    );
  else
    value = (
      <Text
        fz={13}
        lh="17px"
        ff="monospace"
        truncate
        fw={role === 'winner' ? 500 : undefined}
        c={role === 'overridden' || role === 'inert' ? text.muted : undefined}
        data-role={role}
        data-testid={`layer-value-${scope}`}
      >
        {composite ? rowSummary(layerDef(def, row)) : valueText(row.value)}
      </Text>
    );

  const issues =
    editing && composite ? [] : (reported ?? row.nonconforming ?? []);
  const stray = row.present && store !== null && !allowed;
  const offerOlder = replaceWith && !composite && editable && store;
  const subs =
    Boolean(row.invalid) || issues.length > 0 || stray || Boolean(offerOlder);

  return (
    <Box
      className={classes.line}
      mod={{ editing }}
      data-testid={`layer-${scope}`}
    >
      <Group gap={12} wrap="nowrap" mih={38} px={8}>
        <Box className={classes.scope}>
          {store ? (
            <ScopeBadge scope={scope as LayerScope} bare />
          ) : scope === 'default' ? (
            <ScopeBadge scope="default" />
          ) : (
            <Text fz={12} fw={500} c={text.muted}>
              {scope}
            </Text>
          )}
        </Box>
        <Box
          className={classes.value}
          onKeyDown={
            editing && store && !composite
              ? cancelOnEscape(() => setEditing(false))
              : undefined
          }
        >
          {value}
        </Box>
        <Status role={role} row={row} />
        <Group gap={2} wrap="nowrap" className={classes.actions}>
          {row.file !== null && (
            <Tooltip label={`Open ${row.file}`}>
              <ActionIcon
                component="a"
                href={editorHref(row.file)}
                variant="subtle"
                color="gray"
                aria-label={`open ${row.file}`}
              >
                <Icons.externalLink size={14} />
              </ActionIcon>
            </Tooltip>
          )}
          {editable && store && (
            <Tooltip label={editing ? 'Cancel' : `Set at ${named}`}>
              <ActionIcon
                variant="subtle"
                color="gray"
                disabled={busy}
                aria-label={
                  editing
                    ? `cancel editing ${def.key} at ${label}`
                    : `set ${def.key} at ${label}`
                }
                onClick={() => setEditing(e => !e)}
              >
                {editing ? <Icons.close size={14} /> : <Icons.edit size={14} />}
              </ActionIcon>
            </Tooltip>
          )}
          {moves.length > 0 && (
            <Menu position="bottom-end" withinPortal>
              <Tooltip label="Move to another layer">
                <Menu.Target>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    disabled={busy}
                    aria-label={`move ${def.key} from ${label}`}
                  >
                    <Icons.arrowRight size={14} />
                  </ActionIcon>
                </Menu.Target>
              </Tooltip>
              <Menu.Dropdown>
                {moves.map(to => (
                  <Menu.Item
                    key={to}
                    leftSection={<ScopeDot scope={to} />}
                    onClick={() => void onMove(scope, to)}
                  >
                    {`Move to ${scopeLabel(to, team)}`}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
          {writable && store && row.present && (
            <Tooltip label={`Remove from ${named}${allRepos}`}>
              <ActionIcon
                variant="subtle"
                color="gray"
                disabled={busy}
                aria-label={`remove ${def.key} from ${label}`}
                onClick={() => void onRemove(scope)}
              >
                <Icons.trash size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
      {subs && (
        <Stack gap={2} className={classes.sub}>
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
                size="compact-sm"
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
        <Box className={classes.sub}>
          <DraftEditor
            def={def}
            form={formOf(def)}
            initial={row.present ? row.value : undefined}
            targetLabel={layerLabel(scope as LayerScope, team)}
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
    </Box>
  );
}

function RepoSection({
  settingKey,
  identity,
  onPick,
}: {
  settingKey: string;
  identity: string;
  onPick?: (repo: string) => void;
}) {
  const { text } = useSchemeColors();
  const { rows, loading } = useKeyExplain(settingKey, identity);
  const set = rows.filter(r => r.present && isRung(r.scope));
  return (
    <Box className={classes.repo} data-testid={`repo-${identity}`}>
      <Group gap={12} wrap="nowrap" justify="space-between">
        <Text fz={13} ff="monospace">
          {repoLabel(identity)}
        </Text>
        {onPick && (
          <Button
            size="compact-sm"
            variant="default"
            aria-label={`Show ${repoLabel(identity)}`}
            onClick={() => onPick(identity)}
          >
            Show
          </Button>
        )}
      </Group>
      {loading ? (
        <Skeleton h={28} mt={8} />
      ) : (
        set.map(r => (
          <Stack key={r.scope} gap={4} pt={8}>
            <ScopeBadge scope={r.scope as LayerScope} />
            <JsonBlock value={r.value} />
          </Stack>
        ))
      )}
      {!loading && set.length === 0 && (
        <Text fz={12} c={text.muted} pt={6}>
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
        rows
          .filter(shown)
          .map(r => (
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
          ))
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
              Repos
            </Text>
            <Text fz={12} c={text.muted}>
              · sections that override every repo's value for one repo
            </Text>
          </Group>
          {def.repos!.map(r => (
            <RepoSection
              key={r.identity}
              settingKey={def.key}
              identity={r.identity}
              onPick={onPickRepo}
            />
          ))}
        </>
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
        <WhereTab
          key={`${def.key}:${fix ?? ''}:${repo ?? ''}`}
          def={def}
          store={store}
          fix={fix}
          externalWrites={externalWrites}
          onChanged={onChanged}
          onPickRepo={onPickRepo}
        />
      )}
    </Stack>
  );
}
