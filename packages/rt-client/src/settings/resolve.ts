/**
 * The settings resolver (RT-47): one read path that layers the stores and
 * the registry default into a single answer plus the provenance that explains
 * it. The shared layers are the one org on this Mac and its active team.
 *
 * Scope ladder, weakest → strongest:
 *
 *   default < org < team < user < org.repo < team.repo < user.repo < machine < machine.repo
 *
 * Merge is per-key schema, never global (`SettingDef.merge`):
 *  - `replace` — the strongest valid scope wins atomically; provenance has
 *    exactly one entry.
 *  - `deep` — object values overlay field-by-field walking weakest → strongest;
 *    arrays and scalars inside a deep key still replace atomically. Provenance
 *    lists every scope that still owns at least one leaf of the resolved value,
 *    weakest-first — a scope whose every field was overridden is NOT listed
 *    (same honesty rule that makes `replace` provenance length 1).
 *
 * Degrade rules (teammates run version-skewed binaries; one unknown key in the
 * team store must never brick resolution):
 *  - explicit `get`/`explain` of an unregistered key → throw.
 *  - unregistered keys FOUND in files → warn + skip, surfaced by `listSettings`
 *    with `unregistered: true`.
 *  - a registered key whose found value fails validation → warn + skip THAT
 *    scope only, labeled `invalid` in list/explain; weaker and stronger scopes
 *    still apply.
 *
 * Three deliberate decisions this file makes that the spec left to the
 * implementation:
 *  1. **The path-literal guard is scope-aware.** `validateValue`'s guarded
 *     fields (`rt.roles.hook`) are only illegal in SHARED scopes. The machine
 *     store is explicitly allowed path literals. So org, team and user rungs
 *     get the full check, the machine rung gets the type check alone.
 *  2. **A value found in a store the def does not allow is skipped**, labeled
 *     like any other invalid value (`rt.repoIdentityOverrides` is machine-only;
 *     honouring a team-store copy of it would defeat the schema).
 *  3. **`explain` shows `value` migrated to the current shape** (never
 *     variable-expanded) and `authored` as stored, because its job is to say
 *     what is in which file at both the shape a reader sees and the shape a
 *     writer left, and **`list` degrades** an unexpandable
 *     value to its raw form with an `expandError` label rather than throwing —
 *     one bad value must not brick a survey of every key. `get` is the loud
 *     one: an unsatisfiable closed-set variable throws.
 *
 * The resolver is daemon-FREE and sync: no spawns anywhere, repo identity is a
 * pre-derived input (see identity.ts for the async derivation). Store files are
 * parsed fresh per call — they are small, and memoization is a later
 * optimization that would need invalidation this wave does not have.
 *
 * Writes (`setSetting`) land in a later task; this module is read-side only.
 */

import { homedir } from "os";
import { join } from "path";
import { activeTeamFrom } from "./active-team.ts";
import { machineSettingsPath, orgSettingsPath, teamSettingsPath, teamsDir, userSettingsPath } from "./paths.ts";
import { currentStoreName, readSection, storeNameStatus, worstLabel, type OlderLabel, type OlderNameRead, type SectionRead } from "./migrate.ts";
import { allDefs, getDef, isMigrated, validateValue, type SettingDef, type SettingScope } from "./registry-machinery.ts";
import { checkSchema, type SchemaIssue } from "./schema.ts";
import { listOrgs, readStore, TEAM_NAME_RE, type StoreFile } from "./stores.ts";

// ─── Public types ────────────────────────────────────────────────────────────

export type Scope =
  | "machine.repo"
  | "machine"
  | "user.repo"
  | "team.repo"
  | "org.repo"
  | "user"
  | "team"
  | "org"
  | "default";

/** The scope ladder, weakest first. Also the order every result is built in. */
export const SCOPE_ORDER: Scope[] = [
  "default",
  "org",
  "team",
  "user",
  "org.repo",
  "team.repo",
  "user.repo",
  "machine",
  "machine.repo",
];

export interface Provenance {
  scope: Scope;
  /** The file the value came from; null for the registry default. */
  file: string | null;
}

export interface ResolveOpts {
  /** Normalized repo identity (identity.ts). Null/absent = repo rungs are unreachable. */
  repoIdentity?: string | null;
  /** Expand closed-set variables in the resolved value. Default true. */
  expand?: boolean;
  expandCtx?: { repoRoot?: string; worktree?: string };
  /** Read as this team folder instead of the active team; null reads the org layer alone. */
  team?: string | null;
}

export interface Resolved<T> {
  value: T;
  /** ALWAYS an array, weakest-first. Length 1 for replace keys. */
  provenance: Provenance[];
}

/** A scope whose authored value was found but refused (type, path guard, or store). */
export interface InvalidScope {
  scope: Scope;
  file: string | null;
  reason: string;
}

export interface ListedSetting {
  key: string;
  value: unknown;
  provenance: Provenance[];
  migrated: boolean;
  /** Present only for keys found in files but absent from the registry. */
  unregistered?: true;
  /** Scopes skipped during resolution, with the reason each was refused. */
  invalid?: InvalidScope[];
  /** Set when the value could not be expanded here; `value` is then raw. */
  expandError?: string;
  /** Per-scope schema issues for layers that applied despite failing their schema. */
  nonconforming?: { scope: Scope; file: string | null; issues: SchemaIssue[] }[];
  /** Schema issues on the fully merged value, across every layer that applied. */
  mergedIssues?: SchemaIssue[];
  /** Layers where an older store name was changed after the current one was written. */
  diverged?: { scope: Scope; file: string | null; storeNames: string[] }[];
  /** An unregistered row whose name a newer rt writes (`key@N` above this rt's version). */
  newer?: true;
}

export interface ExplainRow {
  scope: Scope;
  file: string | null;
  present: boolean;
  /** The value migrated to the current shape; never variable-expanded. */
  value?: unknown;
  /** Set when the value was ignored because the key is teamLocked. */
  shadowed?: "teamLocked";
  /** Set when the value was refused; the reason it was refused. */
  invalid?: string;
  /** Set when the value applied despite failing its schema; never means skipped. */
  nonconforming?: SchemaIssue[];
  /** The property the value was read from (`key` or `key@N`); present store rows only. */
  storeName?: string;
  storedVersion?: number;
  /** The value as stored; `value` is it migrated to the current shape. */
  authored?: unknown;
  /** Older names beside the current one in the same section, each labeled. */
  olderNames?: OlderNameRead[];
  /** The worst of `olderNames`' labels. */
  olderLabel?: OlderLabel;
}

export interface ExpandCtx {
  repoRoot?: string;
  worktree?: string;
  home: string;
  teamsDir: string;
}

// ─── Variables ───────────────────────────────────────────────────────────────

const VAR_RE = /\$\{([^}]*)\}/g;
const TEAM_VAR_RE = /^team:(.+)$/;

/**
 * Replaces ONLY `${repoRoot}`, `${worktree}`, `${home}` and `${team:<name>}`.
 * Every other `${...}` passes through verbatim — domain templates like the
 * interceptor's `${port}` are not ours to expand, and the same string may hold
 * both kinds, so substitution is per-occurrence. `${team:<name>}` is lexical:
 * `<teamsDir>/<name>` with no existence check (a missing team surfaces at use
 * time through the consumer's own fail-open path), but the name must be a
 * single directory segment — see `teamPath`. A closed-set variable with no
 * context in `ctx` throws — silently emitting a half-expanded path is the
 * dishonesty this design bans.
 *
 * Recurses through arrays and plain objects; non-strings pass through. Never
 * mutates its input.
 */
export function expandVariables(value: unknown, ctx: ExpandCtx): unknown {
  if (typeof value === "string") return expandString(value, ctx);
  if (Array.isArray(value)) return value.map((item) => expandVariables(item, ctx));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandVariables(v, ctx);
    return out;
  }
  return value;
}

function expandString(input: string, ctx: ExpandCtx): string {
  return input.replace(VAR_RE, (match, name: string) => {
    if (name === "home") return ctx.home;
    if (name === "repoRoot") return required(ctx.repoRoot, "repoRoot", "a repo path");
    if (name === "worktree") return required(ctx.worktree, "worktree", "a worktree path");
    const team = TEAM_VAR_RE.exec(name);
    if (team) return teamPath(ctx.teamsDir, team[1] as string);
    return match; // not ours — pass through verbatim
  });
}

/**
 * `${team:<name>}` → `<teamsDir>/<name>`, but only for a name that is a single
 * directory segment. `<name>` is a team NAME, and `join()` normalizes away
 * `..`, so `${team:../../.ssh}` would quietly resolve to a path OUTSIDE the
 * teams dir — a store value (a team store's own, even) that reads or executes
 * from anywhere on disk while still looking like a team-relative reference.
 * Any `/`, `\` or `..` therefore throws, on the same closed-set footing as an
 * unsatisfiable `${repoRoot}`: `get` surfaces it, `list` degrades that one
 * value to an `expandError`, and no half-expanded path is ever emitted.
 */
function teamPath(teamsDir: string, name: string): string {
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error(
      `rt: cannot expand \${team:${name}} — a team name must be a single directory segment (no "/", "\\" or "..")`,
    );
  }
  return join(teamsDir, name);
}

function required(value: string | undefined, name: string, needs: string): string {
  if (value === undefined || value === "") {
    throw new Error(`rt: cannot expand \${${name}} — this setting was resolved without ${needs}`);
  }
  return value;
}

// ─── Store reading ───────────────────────────────────────────────────────────

interface StoreBundle {
  user: StoreFile;
  machine: StoreFile;
  /** Null on a Mac with no org clone. */
  org: StoreFile | null;
  /** Null with no org, or with no active team. A team whose file is missing is a store with `exists: false`. */
  team: StoreFile | null;
}

function assertTeamName(team: string): void {
  if (!TEAM_NAME_RE.test(team)) throw new Error(`rt: "${team}" is not a team name (lowercase letters, digits and dashes, starting with a letter)`);
}

function readStores(view: { team?: string | null } = {}): StoreBundle {
  const user = readStore(userSettingsPath());
  const machine = readStore(machineSettingsPath());
  const orgs = [...listOrgs()].sort();
  if (orgs.length > 1) warnMultipleOrgs(orgs);
  const org = orgs[0];
  if (org === undefined) return { user, machine, org: null, team: null };
  const orgStore = readStore(orgSettingsPath(org));
  if (typeof view.team === "string") assertTeamName(view.team);
  const team = view.team !== undefined ? view.team : activeTeamFrom(org, orgStore, user).team;
  return { user, machine, org: orgStore, team: team === null ? null : readStore(teamSettingsPath(org, team)) };
}

let multiOrgWarned: string | null = null;

/** Once per process and per set of clones: every settings read folds the stores, so an unguarded warning would repeat on each one. */
function warnMultipleOrgs(orgs: string[]): void {
  const names = orgs.join(", ");
  if (multiOrgWarned === names) return;
  multiOrgWarned = names;
  emitSettingsWarning(
    `rt: this machine has ${orgs.length} org clones (${names}); mattstack supports one org per machine today. Only ${orgs[0]} is read.`,
  );
}

/**
 * The merged value the resolver would produce if `override.scope` (and its
 * repo section, when given) held `override.value`. A team write is judged in
 * the view of the team it lands in, never the caller's own active team.
 */
export function mergedValueWith(
  def: SettingDef,
  override: { scope: SettingScope; repoIdentity?: string; team?: string; value: unknown },
  opts: ResolveOpts = {},
): unknown {
  const view = override.scope === "team" && override.team !== undefined ? override.team : opts.team;
  const stores = readStores({ team: view });
  const patched: StoreBundle = {
    user: cloneStore(stores.user),
    machine: cloneStore(stores.machine),
    org: stores.org ? cloneStore(stores.org) : null,
    team: stores.team ? cloneStore(stores.team) : null,
  };
  const target = { user: patched.user, machine: patched.machine, org: patched.org, team: patched.team }[override.scope];
  if (target) {
    if (override.repoIdentity !== undefined) {
      target.repos[override.repoIdentity] = { ...(target.repos[override.repoIdentity] ?? {}), [currentStoreName(def)]: override.value };
    } else {
      target.global = { ...target.global, [currentStoreName(def)]: override.value };
    }
  }
  return resolveDef(def, patched, opts).value;
}

/** The merged value `getSetting` would return, without its warnings for
    skipped layers; the write gate and the check audit read it silently. */
export function currentMergedValue(def: SettingDef, opts: ResolveOpts = {}): unknown {
  return resolveDef(def, readStores({ team: opts.team }), opts).value;
}

function cloneStore(store: StoreFile): StoreFile {
  return { ...store, global: { ...store.global }, repos: Object.fromEntries(Object.entries(store.repos).map(([k, v]) => [k, { ...v }])) };
}

function sharedStores(stores: StoreBundle): StoreFile[] {
  return [stores.org, stores.team].filter((s): s is StoreFile => s !== null);
}

/** Every repo identity that has a `repos.<id>` section in any store. */
export function listStoreRepoIdentities(): string[] {
  const stores = readStores();
  const ids = new Set<string>();
  for (const store of [stores.user, stores.machine, ...sharedStores(stores)]) for (const id of Object.keys(store.repos)) ids.add(id);
  return [...ids].sort();
}

/**
 * Every key found in a store file that the registry has never heard of, in
 * global sections and every repo section, so a stale repo-scoped key surfaces
 * with no `repoIdentity` needed to see it. `scope` is the rung the key sat in
 * (`machine.repo`, not `machine`, for a key found inside `repos.<id>`).
 */
export function listUnregisteredSettings(): { key: string; scope: Scope; file: string; newer?: true }[] {
  const stores = readStores();
  const out: { key: string; scope: Scope; file: string; newer?: true }[] = [];
  const scan = (scope: Scope, file: string, section: Record<string, unknown> | undefined) => {
    for (const key of Object.keys(section ?? {})) {
      const status = storeNameStatus(key);
      if (status === "unknown") out.push({ key, scope, file });
      else if (status === "newer") out.push({ key, scope, file, newer: true });
    }
  };
  if (stores.org) {
    scan("org", stores.org.file, stores.org.global);
    for (const s of Object.values(stores.org.repos)) scan("org.repo", stores.org.file, s);
  }
  if (stores.team) {
    scan("team", stores.team.file, stores.team.global);
    for (const s of Object.values(stores.team.repos)) scan("team.repo", stores.team.file, s);
  }
  scan("user", stores.user.file, stores.user.global);
  for (const s of Object.values(stores.user.repos)) scan("user.repo", stores.user.file, s);
  scan("machine", stores.machine.file, stores.machine.global);
  for (const s of Object.values(stores.machine.repos)) scan("machine.repo", stores.machine.file, s);
  return out.sort((a, b) => a.key.localeCompare(b.key) || a.scope.localeCompare(b.scope));
}

/** Which stores set `key` for each repo identity, weakest-to-strongest order per identity. */
export function repoSectionsFor(key: string): { identity: string; scopes: SettingScope[] }[] {
  const def = getDef(key);
  const stores = readStores();
  const byId = new Map<string, SettingScope[]>();
  const note = (scope: SettingScope, store: StoreFile) => {
    for (const [id, section] of Object.entries(store.repos)) {
      const present = def ? readSection(def, section, { layer: true }).present : section[key] !== undefined;
      if (!present) continue;
      const list = byId.get(id) ?? [];
      if (!list.includes(scope)) list.push(scope);
      byId.set(id, list);
    }
  };
  if (stores.org) note("org", stores.org);
  if (stores.team) note("team", stores.team);
  note("user", stores.user);
  note("machine", stores.machine);
  return [...byId.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([identity, scopes]) => ({ identity, scopes }));
}

// ─── Slots: every rung a key could come from, weakest-first ──────────────────

interface Slot {
  scope: Scope;
  file: string | null;
  present: boolean;
  value?: unknown;
  read?: SectionRead;
}

function collectSlots(def: SettingDef, stores: StoreBundle, opts: ResolveOpts): Slot[] {
  const slots: Slot[] = [];
  const identity = opts.repoIdentity ?? null;
  const useRepo = def.repoScoped === true && typeof identity === "string" && identity !== "";
  const repoSection = (store: StoreFile): Record<string, unknown> | undefined =>
    useRepo ? store.repos[identity as string] : undefined;

  const push = (scope: Scope, file: string | null, section: Record<string, unknown> | undefined) => {
    const read = readSection(def, section, { layer: true });
    if (!read.present) slots.push({ scope, file, present: false });
    else slots.push({ scope, file, present: true, value: read.value, read });
  };

  /** A layer this Mac has no store for still gets its rung, absent, so `explain` shows the ladder in full. */
  const pushShared = (scope: Scope, store: StoreFile | null, section: (store: StoreFile) => Record<string, unknown> | undefined) => {
    if (store === null) {
      slots.push({ scope, file: null, present: false });
      return;
    }
    push(scope, store.file, section(store));
  };

  // default — cloned so a caller mutating the resolved value cannot corrupt
  // the registry's shared def object.
  slots.push(
    def.default === undefined
      ? { scope: "default", file: null, present: false }
      : { scope: "default", file: null, present: true, value: structuredClone(def.default) },
  );

  // The ladder itself, weakest → strongest. Repo rungs are omitted entirely
  // when they are unreachable (key not repoScoped, or no identity in hand) —
  // an unreachable rung in `explain` would be noise, not honesty.
  pushShared("org", stores.org, (store) => store.global);
  pushShared("team", stores.team, (store) => store.global);
  push("user", stores.user.file, stores.user.global);
  if (useRepo) pushShared("org.repo", stores.org, repoSection);
  if (useRepo) pushShared("team.repo", stores.team, repoSection);
  if (useRepo) push("user.repo", stores.user.file, repoSection(stores.user));
  push("machine", stores.machine.file, stores.machine.global);
  if (useRepo) push("machine.repo", stores.machine.file, repoSection(stores.machine));

  return slots;
}

// ─── Resolution ──────────────────────────────────────────────────────────────

interface Resolution {
  value: unknown;
  provenance: Provenance[];
  invalid: InvalidScope[];
  rows: ExplainRow[];
  mergedIssues: SchemaIssue[];
}

const TEAM_LOCKED_SCOPES: Scope[] = ["default", "org", "team", "org.repo", "team.repo"];

function isRepoRung(scope: Scope): boolean {
  return scope === "org.repo" || scope === "team.repo" || scope === "user.repo" || scope === "machine.repo";
}

/** The store a scope's value is authored in: the rung's write-side scope. */
function baseScope(scope: Scope): SettingScope | null {
  if (scope === "org" || scope === "org.repo") return "org";
  if (scope === "team" || scope === "team.repo") return "team";
  if (scope === "user" || scope === "user.repo") return "user";
  if (scope === "machine" || scope === "machine.repo") return "machine";
  return null; // default is not authored in a store
}

/** A layer other people author: the org's or a team's, global or per repo. Every gate that distrusts team-authored values asks this. */
export function isSharedScope(scope: Scope): boolean {
  return scope === "org" || scope === "org.repo" || scope === "team" || scope === "team.repo";
}

/**
 * The path-literal guard applies to SHARED scopes only — the machine store is
 * the one place path literals are legal.
 */
function validateForScope(
  def: SettingDef,
  scope: Scope,
  value: unknown,
): { ok: true } | { ok: false; reason: string } {
  const shared = scope !== "default" && scope !== "machine" && scope !== "machine.repo";
  return validateValue(shared ? def : { ...def, pathGuardFields: undefined }, value);
}

function resolveDef(def: SettingDef, stores: StoreBundle, opts: ResolveOpts): Resolution {
  const slots = collectSlots(def, stores, opts);
  const rows: ExplainRow[] = [];
  const invalid: InvalidScope[] = [];
  const applied: Array<{ scope: Scope; file: string | null; value: unknown }> = [];

  for (const slot of slots) {
    const row: ExplainRow = { scope: slot.scope, file: slot.file, present: slot.present };
    if (!slot.present) {
      rows.push(row);
      continue;
    }
    row.value = slot.value;
    if (slot.read) {
      row.storeName = slot.read.storeName;
      row.storedVersion = slot.read.storedVersion;
      row.authored = slot.read.authored;
      if (slot.read.older.length > 0) {
        row.olderNames = slot.read.older;
        row.olderLabel = worstLabel(slot.read.older);
      }
    }

    // teamLocked: the shared rungs and default and nothing else. Other scopes'
    // values are reported, never applied.
    if (def.teamLocked && !TEAM_LOCKED_SCOPES.includes(slot.scope)) {
      row.shadowed = "teamLocked";
      rows.push(row);
      continue;
    }

    // A key authored in a store its def does not list is not this key.
    const base = baseScope(slot.scope);
    if (base !== null && !def.scopes.includes(base)) {
      const reason = `not settable in the ${base} store (allowed: ${def.scopes.join(", ")})`;
      row.invalid = reason;
      invalid.push({ scope: slot.scope, file: slot.file, reason });
      rows.push(row);
      continue;
    }

    if (def.repoOnly && base !== null && !isRepoRung(slot.scope)) {
      const reason = `repo-only: set it in a repo section (--repo), not the global ${base} store`;
      row.invalid = reason;
      invalid.push({ scope: slot.scope, file: slot.file, reason });
      rows.push(row);
      continue;
    }

    // The registry default is trusted; everything read off disk is checked.
    if (slot.scope !== "default") {
      const check = validateForScope(def, slot.scope, slot.value);
      if (!check.ok) {
        const failed = slot.read?.migrationError;
        const reason = failed ? `${failed}; ${check.reason}` : check.reason;
        row.invalid = reason;
        invalid.push({ scope: slot.scope, file: slot.file, reason });
        rows.push(row);
        continue;
      }
    }

    if (slot.scope !== "default") {
      const failed = slot.read?.migrationError;
      const issues = [...(failed ? [{ path: [], message: failed }] : []), ...checkSchema(def, slot.value, { layer: true })];
      if (issues.length > 0) row.nonconforming = issues;
    }

    rows.push(row);
    applied.push({ scope: slot.scope, file: slot.file, value: slot.value });
  }

  const merged = mergeApplied(def, applied);
  const mergedIssues = merged.value === undefined ? [] : checkSchema(def, merged.value, { layer: false });
  return { value: merged.value, provenance: merged.provenance, invalid, rows, mergedIssues };
}

function mergeApplied(
  def: SettingDef,
  applied: Array<{ scope: Scope; file: string | null; value: unknown }>,
): { value: unknown; provenance: Provenance[] } {
  if (applied.length === 0) return { value: undefined, provenance: [] };

  // Deep merge is only meaningful for objects; a `deep` def with any other
  // type — or a non-object layer, only reachable through a malformed registry
  // default since every value read off disk is type-checked — falls back to
  // replace rather than inventing semantics for it.
  if (def.merge === "deep" && def.type === "object") {
    const objectLayers = applied.filter((layer) => isPlainObject(layer.value));
    if (objectLayers.length > 0) {
      const { value, contributors } = deepMerge(objectLayers.map((layer) => layer.value));
      return {
        value,
        provenance: contributors.map((i) => {
          const layer = objectLayers[i] as (typeof applied)[number];
          return { scope: layer.scope, file: layer.file };
        }),
      };
    }
  }

  const winner = applied[applied.length - 1] as (typeof applied)[number];
  return { value: winner.value, provenance: [{ scope: winner.scope, file: winner.file }] };
}

// ─── Deep merge with per-leaf attribution ────────────────────────────────────

// Leaf paths are joined with NUL so a field name containing a dot cannot
// collide with a nested path of the same spelling.
const PATH_SEP = "\u0000";

/**
 * Overlays object layers weakest → strongest, tracking which layer owns each
 * surviving leaf. Arrays and scalars replace atomically (an array IS a leaf);
 * objects recurse. `contributors` is the ascending list of layer indexes that
 * still own at least one leaf of the result.
 */
function deepMerge(layers: unknown[]): { value: Record<string, unknown>; contributors: number[] } {
  const owner = new Map<string, number>();
  let acc: Record<string, unknown> = {};

  layers.forEach((layer, index) => {
    acc = overlay(acc, layer as Record<string, unknown>, owner, index, "");
  });

  const contributors = [...new Set(owner.values())].sort((a, b) => a - b);
  return { value: acc, contributors };
}

function overlay(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
  owner: Map<string, number>,
  index: number,
  prefix: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(over)) {
    const path = prefix === "" ? key : `${prefix}${PATH_SEP}${key}`;
    const current = out[key];

    if (isPlainObject(value) && isPlainObject(current)) {
      out[key] = overlay(current, value, owner, index, path);
      continue;
    }

    out[key] = value;
    clearOwners(owner, path);
    registerLeaves(value, path, owner, index);
  }

  return out;
}

function clearOwners(owner: Map<string, number>, path: string): void {
  owner.delete(path);
  const under = `${path}${PATH_SEP}`;
  for (const existing of [...owner.keys()]) {
    if (existing.startsWith(under)) owner.delete(existing);
  }
}

/**
 * Records ownership at LEAF granularity: an object is walked into so that a
 * stronger layer overriding every one of its fields takes the whole thing over
 * (and the weaker layer correctly drops out of provenance).
 */
function registerLeaves(value: unknown, path: string, owner: Map<string, number>, index: number): void {
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > 0) {
      for (const [key, child] of entries) {
        registerLeaves(child, `${path}${PATH_SEP}${key}`, owner, index);
      }
      return;
    }
  }
  owner.set(path, index);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ─── Public API ──────────────────────────────────────────────────────────────

function unknownKey(key: string): Error {
  return new Error(`rt: unknown setting "${key}" — not in the settings registry (see \`rt settings list\`)`);
}

function expandCtxFrom(opts: ResolveOpts): ExpandCtx {
  return {
    repoRoot: opts.expandCtx?.repoRoot,
    worktree: opts.expandCtx?.worktree,
    home: process.env.HOME ?? homedir(),
    teamsDir: teamsDir(),
  };
}

let warnSink: ((msg: string) => void) | null = null;
const warnedOnce = new Set<string>();

/** The daemon binds a deduped log.warn here so a hot-path getSetting on a
 *  disallowed-scope key warns once, not every tick. Default: console.warn
 *  (CLI/test behavior unchanged). null restores the default. */
export function setSettingsWarnSink(sink: ((msg: string) => void) | null): void {
  warnSink = sink;
  warnedOnce.clear();
  multiOrgWarned = null;
}

export function emitSettingsWarning(msg: string): void {
  if (warnSink) {
    if (warnedOnce.has(msg)) return;
    warnedOnce.add(msg);
    warnSink(msg);
    return;
  }
  console.warn(msg);
}

function warnInvalid(key: string, entry: InvalidScope): void {
  emitSettingsWarning(
    `rt: ignoring "${key}" from the ${entry.scope} scope (${entry.file ?? "no file"}): ${entry.reason}`,
  );
}

/**
 * Resolves one key across the whole ladder. Throws for an unregistered key —
 * an explicit get of something rt has never heard of is a caller bug, not a
 * degrade (contrast: unknown keys FOUND in files, which only warn).
 */
export function getSetting<T>(key: string, opts: ResolveOpts = {}): Resolved<T> {
  const def = getDef(key);
  if (!def) throw unknownKey(key);

  const resolution = resolveDef(def, readStores({ team: opts.team }), opts);
  for (const entry of resolution.invalid) warnInvalid(key, entry);

  const shouldExpand = opts.expand ?? true;
  const value =
    shouldExpand && resolution.value !== undefined
      ? expandVariables(resolution.value, expandCtxFrom(opts))
      : resolution.value;

  return { value: value as T, provenance: resolution.provenance };
}

/**
 * Every registered key resolved (registry order), then every unregistered key
 * found in the stores (alphabetical). Nothing here throws: a survey of the
 * whole settings map must survive one bad value, so an unexpandable value
 * degrades to its raw form plus an `expandError` label.
 */
export function listSettings(opts: ResolveOpts = {}): ListedSetting[] {
  const stores = readStores({ team: opts.team });
  const ctx = expandCtxFrom(opts);
  const shouldExpand = opts.expand ?? true;
  const out: ListedSetting[] = [];

  for (const def of allDefs()) {
    const resolution = resolveDef(def, stores, opts);
    for (const entry of resolution.invalid) warnInvalid(def.key, entry);

    const listed: ListedSetting = {
      key: def.key,
      value: resolution.value,
      provenance: resolution.provenance,
      migrated: isMigrated(def),
    };
    if (resolution.invalid.length > 0) listed.invalid = resolution.invalid;

    const nonconforming = resolution.rows.filter((r) => r.nonconforming).map((r) => ({ scope: r.scope, file: r.file, issues: r.nonconforming! }));
    if (nonconforming.length > 0) listed.nonconforming = nonconforming;
    if (resolution.mergedIssues.length > 0) listed.mergedIssues = resolution.mergedIssues;

    const diverged = resolution.rows
      .filter((r) => r.olderLabel === "diverged")
      .map((r) => ({ scope: r.scope, file: r.file, storeNames: r.olderNames!.filter((o) => o.label === "diverged").map((o) => o.storeName) }));
    if (diverged.length > 0) listed.diverged = diverged;

    if (shouldExpand && resolution.value !== undefined) {
      try {
        listed.value = expandVariables(resolution.value, ctx);
      } catch (err) {
        listed.expandError = (err as Error).message;
        emitSettingsWarning(`rt: showing "${def.key}" unexpanded — ${listed.expandError}`);
      }
    }

    out.push(listed);
  }

  out.push(...listUnregistered(stores, opts));
  return out;
}

/**
 * Keys present in a store file that the registry has never heard of. They are
 * never merged (there is no def to say how) — the strongest scope holding one
 * is reported as-is, so a teammate's newer key is visible rather than silently
 * dropped.
 */
function listUnregistered(stores: StoreBundle, opts: ResolveOpts): ListedSetting[] {
  const identity = opts.repoIdentity ?? null;
  const found = new Map<string, Provenance & { value: unknown; newer: boolean }>();

  const scan = (scope: Scope, file: string, section: Record<string, unknown> | undefined) => {
    for (const [key, value] of Object.entries(section ?? {})) {
      const status = storeNameStatus(key);
      if (status !== "unknown" && status !== "newer") continue;
      found.set(key, { scope, file, value, newer: status === "newer" }); // later (stronger) scans win
    }
  };
  const repoSection = (store: StoreFile) =>
    typeof identity === "string" && identity !== "" ? store.repos[identity] : undefined;

  if (stores.org) scan("org", stores.org.file, stores.org.global);
  if (stores.team) scan("team", stores.team.file, stores.team.global);
  scan("user", stores.user.file, stores.user.global);
  if (stores.org) scan("org.repo", stores.org.file, repoSection(stores.org));
  if (stores.team) scan("team.repo", stores.team.file, repoSection(stores.team));
  scan("user.repo", stores.user.file, repoSection(stores.user));
  scan("machine", stores.machine.file, stores.machine.global);
  scan("machine.repo", stores.machine.file, repoSection(stores.machine));

  return [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, hit]) => {
      if (hit.newer) {
        emitSettingsWarning(`rt: "${key}" in ${hit.file} was written by a newer rt; ignoring it (this rt may be older than the store)`);
      } else {
        emitSettingsWarning(
          `rt: unregistered setting "${key}" in ${hit.file}, ignoring it (this rt may be older than the store)`,
        );
      }
      return {
        key,
        value: hit.value,
        provenance: [{ scope: hit.scope, file: hit.file }],
        migrated: false,
        unregistered: true as const,
        ...(hit.newer ? { newer: true as const } : {}),
      };
    });
}

/**
 * The org store's own value for `key` (its repo section when `repoIdentity` is
 * given), migrated but never merged or expanded; undefined when absent or
 * invalid. A read-modify-write at `scope: "org"` starts from this, so the
 * active team's overrides are never copied into the org layer.
 */
export function getOrgSetting<T>(key: string, opts: { repoIdentity?: string } = {}): T | undefined {
  const def = getDef(key);
  if (!def) throw unknownKey(key);
  const org = readStores({ team: null }).org;
  if (org === null) return undefined;
  const section = opts.repoIdentity !== undefined ? org.repos[opts.repoIdentity] : org.global;
  const read = readSection(def, section, { layer: true });
  if (!read.present || !validateForScope(def, "org", read.value).ok) return undefined;
  return read.value as T;
}

/**
 * One row per reachable rung, weakest-first, with `value` migrated to the
 * current shape and `authored` as stored. Repo rungs are omitted entirely
 * when the key is not repoScoped or no identity was supplied... showing rungs
 * that could never apply would be noise, not honesty.
 */
export function explainSetting(key: string, opts: ResolveOpts = {}): ExplainRow[] {
  const def = getDef(key);
  if (!def) throw unknownKey(key);
  return resolveDef(def, readStores({ team: opts.team }), opts).rows;
}
