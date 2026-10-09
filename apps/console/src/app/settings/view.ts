import type { KeyboardEvent } from 'react';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import {
  ENUMS,
  filterDefs,
  getLeaf,
  setLeaf,
  targetScope,
  type RowKind,
} from '@mattstack/settings-kit/shapes';

import { groupOf, GROUPS, type Group } from './groups';

export type StoreScope = 'org' | 'team' | 'user' | 'machine';
export type ScopeFilter = 'any' | StoreScope;

export interface ViewFilter {
  query: string;
  needsFixing: boolean;
  scope: ScopeFilter;
}

export const NO_FILTER: ViewFilter = {
  query: '',
  needsFixing: false,
  scope: 'any',
};

export type Provider = 'claude' | 'codex';

/** The agent provider an `agent.<provider>.*` key belongs to. */
export function providerOf(key: string | undefined): Provider | null {
  const m = /^agent\.(claude|codex)\./.exec(key ?? '');
  return m ? (m[1] as Provider) : null;
}

export function needsFixing(def: SettingDefWire): boolean {
  return (def.issues?.length ?? 0) > 0 || (def.mergedIssues?.length ?? 0) > 0;
}

const SUB_ORDER: StoreScope[] = ['org', 'team', 'user', 'machine'];

export interface Subsection {
  scope: StoreScope;
  defs: SettingDefWire[];
}

export interface Section {
  group: Group;
  total: number;
  shown: number;
  subsections: Subsection[];
}

export function isStoreScope(s: string | null | undefined): s is StoreScope {
  return s === 'org' || s === 'team' || s === 'user' || s === 'machine';
}

export type RungScope = 'org.repo' | 'team.repo' | 'user.repo' | 'machine.repo';
/** A store layer, or a store's section for the picked repo. */
export type LayerScope = StoreScope | RungScope;

export function isRung(s: string | null | undefined): s is RungScope {
  return (
    s === 'org.repo' ||
    s === 'team.repo' ||
    s === 'user.repo' ||
    s === 'machine.repo'
  );
}

/** The store a layer lives in: `team.repo` is the team store's repo
    section. */
export function rungBase(s: string | null | undefined): StoreScope | null {
  if (isStoreScope(s)) return s;
  return isRung(s) ? (s.slice(0, -'.repo'.length) as StoreScope) : null;
}

export function rungOf(scope: StoreScope, repo: string | null): LayerScope {
  return repo ? (`${scope}.repo` as RungScope) : scope;
}

/** How a layer reads in UI copy: a rung as its store name plus `· repo`, a
    global layer as its own name. The one source every layer-naming string
    reads from, so a rung and its global layer never share an accessible
    name. */
export function layerLabel(
  scope: LayerScope,
  team: string | null = null,
  org: string | null = null
): string {
  const base = scopeLabel(rungBase(scope)!, team, org);
  return isRung(scope) ? `${base} · repo` : base;
}

/** A shared store's name carries whose it is, so an edit says where it goes. */
export function scopeLabel(
  scope: StoreScope,
  team: string | null,
  org: string | null = null
): string {
  if (scope === 'org' && org) return `org (${org})`;
  if (scope === 'team' && team) return `team (${team})`;
  return scope;
}

/** A repo identity's display label: everything after the host, the same
    rule settings-kit's /repos uses. */
export function repoLabel(identity: string): string {
  const at = identity.indexOf('/');
  return at < 0 ? identity : identity.slice(at + 1);
}

export interface WriteTarget {
  scope: StoreScope;
  repo?: string;
}

/** Where an edit of `def` lands. With a repo picked, a repo-scoped key
    writes that repo's section of the layer its value comes from, so a value
    inherited from a global layer gets a repo override rather than a global
    write; with no allowed winning layer, the key's first scope. While
    another team is open (`sharedOnly`) only the org and team stores take
    writes, so the edit lands on the shared layer serving the value, else the
    key's first shared scope. */
export function writeTarget(
  def: SettingDefWire,
  repo: string | null,
  sharedOnly = false
): WriteTarget {
  const scopes = def.scopes as readonly string[];
  const base = rungBase(def.effective.scope);
  const fallback = (
    sharedOnly ? scopes.find(s => isShared(s)) : scopes[0]
  ) as StoreScope;
  const allowed =
    base !== null && scopes.includes(base) && (!sharedOnly || isShared(base));
  if (def.repoScoped && repo)
    return { scope: allowed ? (base as StoreScope) : fallback, repo };
  if (sharedOnly) return { scope: allowed ? (base as StoreScope) : fallback };
  return { scope: targetScope(def) as StoreScope };
}

export function targetLabel(
  t: WriteTarget,
  team: string | null = null,
  org: string | null = null
): string {
  const scope = scopeLabel(t.scope, team, org);
  return t.repo ? `${scope} · ${repoLabel(t.repo)}` : scope;
}

/** A layer line's scope as a write target; a repo rung needs the picked
    repo. */
export function targetAt(at: string, repo: string | null): WriteTarget | null {
  const scope = rungBase(at);
  if (!scope) return null;
  if (!isRung(at)) return { scope };
  return repo ? { scope, repo } : null;
}

/** Row kinds console draws an editor for. */
export const EDITOR_KINDS: ReadonlySet<RowKind> = new Set<RowKind>([
  'scalar',
  'enum',
  'stringList',
  'stringMap',
  'leaves',
  'objectList',
  'objectMap',
  'json',
]);

/** A hash rt writes when the user approves the team's worktree `ready`
    commands; console never edits it, only revokes it. */
export const APPROVAL_KEY = 'rt.worktreeReadyApproval';

/** `keep` (the open row) passes the chips and the scope filter, which its
    own writes can stop it matching; the query reads only key and
    description, so it still applies. */
export function applyFilter(
  defs: SettingDefWire[],
  f: ViewFilter,
  keep: string | null = null
): SettingDefWire[] {
  return filterDefs(defs, f.query).filter(
    d =>
      d.key === keep ||
      ((!f.needsFixing || needsFixing(d)) &&
        (f.scope === 'any' || setIn(d, f.scope)))
  );
}

/** Whether a store holds a value of the key: its global value, or a repo
    section's. A per-project key has only the second. */
function setIn(d: SettingDefWire, scope: string): boolean {
  return (
    rungBase(d.effective.scope) === scope ||
    (d.repos ?? []).some(r => r.scopes.includes(scope))
  );
}

const SCALAR_RANK: Record<string, number> = {
  number: 1,
  string: 2,
  boolean: 3,
};

/** Rows lead with the quick scalar controls and end with the composites that
    expand; the sort is stable, so registry order holds within a rank. */
function rowRank(d: SettingDefWire): number {
  if (ENUMS[d.key]) return 0;
  return SCALAR_RANK[d.type] ?? 4;
}

const isShared = (s: string | null | undefined): s is 'org' | 'team' =>
  s === 'org' || s === 'team';

/** A key sits under the layer its value comes from, so its block and its row
    say the same thing; a key nothing sets yet sits under its first scope. */
function subheadOf(
  def: SettingDefWire,
  sharedOnly = false
): string | undefined {
  const allowed = (s: string | null | undefined) =>
    Boolean(s) && (!sharedOnly || isShared(s));
  const served = rungBase(def.effective.scope);
  // A repo section's store serves it even when the key does not list that
  // store among its scopes.
  if (
    allowed(served) &&
    (isRung(def.effective.scope) || def.scopes.includes(served!))
  )
    return served!;
  // The list reads no project, so a per-project key sits with the store its
  // repo sections live in, when they all live in one.
  const stores = new Set(
    (def.repos ?? []).flatMap(r => r.scopes).filter(s => allowed(s))
  );
  if (stores.size === 1) return [...stores][0];
  return sharedOnly ? def.scopes.find(isShared) : def.scopes[0];
}

/** Every group with at least one registered key, in GROUPS order, with
    unknown first segments after them. Empty-after-filter sections are kept
    so the index can show zeros. */
/** `sharedOnly` is for viewing another team: only keys a shared store can
    hold are listed, each under the shared scope that serves it or its
    first shared scope. */
export function buildSections(
  every: SettingDefWire[],
  f: ViewFilter,
  keep: string | null = null,
  opts: { sharedOnly?: boolean } = {}
): Section[] {
  const sharedOnly = opts.sharedOnly === true;
  const all = sharedOnly ? every.filter(d => d.scopes.some(isShared)) : every;
  const shownKeys = new Set(applyFilter(all, f, keep).map(d => d.key));
  const byGroup = new Map<string, { group: Group; defs: SettingDefWire[] }>();
  for (const d of all) {
    const group = groupOf(d.key);
    const entry = byGroup.get(group.id) ?? { group, defs: [] };
    entry.defs.push(d);
    byGroup.set(group.id, entry);
  }
  const known = GROUPS.map(g => g.id);
  const extra = [...byGroup.keys()].filter(id => !known.includes(id)).sort();
  return [...known, ...extra]
    .filter(id => byGroup.has(id))
    .map(id => {
      const { group, defs } = byGroup.get(id)!;
      const shown = defs
        .filter(d => shownKeys.has(d.key))
        .sort((a, b) => rowRank(a) - rowRank(b));
      const subsections = SUB_ORDER.map(scope => ({
        scope,
        // With one store picked, every row shown is set there.
        defs: shown.filter(
          d =>
            (f.scope === 'any' ? subheadOf(d, sharedOnly) : f.scope) === scope
        ),
      })).filter(s => s.defs.length > 0);
      return { group, total: defs.length, shown: shown.length, subsections };
    });
}

export function badgeScope(
  def: SettingDefWire,
  subhead: StoreScope | null
): LayerScope | null {
  if (def.merge === 'add') return null;
  const scope = def.effective.scope;
  if (isRung(scope)) return scope;
  return isStoreScope(scope) && scope !== subhead ? scope : null;
}

export function sourceText(
  def: SettingDefWire
): 'default' | 'unset' | 'merged' | null {
  if (def.effective.scope === 'default') return 'default';
  if (def.effective.scope === null) return 'unset';
  return def.merge === 'add' ? 'merged' : null;
}

export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const m = /^(.*?(?<!\be\.g|\bi\.e)[.!?])(?=\s|$)/s.exec(trimmed);
  return m ? m[1]! : trimmed;
}

export function splitKey(key: string): [ns: string, name: string] {
  const i = key.lastIndexOf('.');
  return i < 0 ? ['', key] : [key.slice(0, i + 1), key.slice(i + 1)];
}

/** Rows arrive weakest-first, so the last one that sets the field wins. */
export function fieldSource(
  rows: ExplainRowWire[],
  path: string
): LayerScope | 'default' | null {
  for (const r of [...rows].reverse()) {
    if (!r.present || r.shadowed || r.invalid) continue;
    if (getLeaf(r.value, path) === undefined) continue;
    if (r.scope === 'default' || isStoreScope(r.scope) || isRung(r.scope))
      return r.scope;
  }
  return null;
}

/** The object to write to `target` after changing one field: the target
    layer's own authored value with that field set, so defaults and other
    layers are never copied into it. */
export function leafWrite(
  rows: ExplainRowWire[],
  target: string,
  path: string,
  value: unknown
): Record<string, unknown> {
  const own = rows.find(r => r.scope === target && r.present)?.value;
  return setLeaf(own, path, value);
}

/** A click that starts inside one of these belongs to the control it hit,
    never to the row around it. Options and listboxes render in a portal but
    still bubble through React to the row. */
export const ROW_CONTROLS =
  'input, textarea, select, button, a, label, [role="switch"], [role="combobox"], [role="listbox"], [role="option"], [role="menu"], [role="menuitem"], [contenteditable="true"]';

/** Escape here abandons an edit or closes a menu, never the row or modal
    around it. A radio or checkbox (the tab bar, a switch) has no Escape of
    its own; inside an open editor, `cancelOnEscape` has already taken it. */
export const ESCAPE_OWNERS =
  'input:not([type=radio]):not([type=checkbox]), textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]';

/** An editor root's keydown: Escape anywhere inside abandons the edit and
    is marked handled, so the row or modal around it stays open. An open
    menu, listbox or combobox dropdown takes that Escape first. */
export function cancelOnEscape(cancel: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (target.closest('[role="menu"], [role="listbox"]')) return;
    // A Select/Autocomplete target closes its own dropdown on Escape without
    // stopping the event; its aria-expanded is still "true" here since that
    // close hasn't re-rendered yet.
    if (target.getAttribute('aria-expanded') === 'true') return;
    e.preventDefault();
    cancel();
  };
}

/** Where the value in effect may move. settings-kit moves global layers
    only, and a move re-sets the value at its target, which would reject a
    value rt already refused. An add-merged list never moves: a set at the
    target would replace that layer's own items. */
export function moveTargets(def: SettingDefWire): StoreScope[] {
  if (def.merge === 'add') return [];
  const from = def.effective.scope;
  const base = rungBase(from);
  const stored =
    def.key !== APPROVAL_KEY &&
    Boolean(def.writable && base && def.scopes.includes(base));
  if (!stored || def.effective.invalid !== undefined || isRung(from)) return [];
  return (def.scopes as StoreScope[]).filter(
    s => s !== from && isStoreScope(s)
  );
}
