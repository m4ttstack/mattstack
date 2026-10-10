/**
 * Framework-neutral settings routes over @mattstack/rt-client.
 *
 * Hosts call `settingsHandler(req)` early in their fetch handler; `null`
 * means "not a settings route, fall through". Works identically under a
 * hand-rolled `Bun.serve` switch and a Hono `app.all` catch-all, so one
 * implementation serves every mattstack app.
 *
 * Settings run through rt-client IN PROCESS — no daemon, no spawned rt.
 * `setSetting` throws its refusals as `rt: …` errors; those are "rt said no"
 * conditions the client should read, so they answer 400 here rather than
 * bubbling as a host 500.
 */

import {
  activeTeam,
  allDefs,
  checkSchema,
  explainSetting,
  getDef,
  hasSchema,
  isMigrated,
  listStoreRepoIdentities,
  listOrgs,
  listTeamFolders,
  listUnregisteredSettings,
  pruneStoreName,
  readOrgRoles,
  readOrgRoster,
  repoSectionsFor,
  roleOf,
  sameUser,
  setSetting,
  unsetSetting,
  validateValue,
  validateWrite,
  type ActiveTeam,
  type ExplainRow,
  type JsonSchema,
  type OrgRoles,
  type RosterEntry,
  type SchemaIssue,
  type SettingDef,
  type SettingScope,
} from "@mattstack/rt-client";
import { overlay } from "./overlay.ts";
import { SHAPES } from "./shapes.ts";

export interface SettingDefWire {
  key: string;
  type: SettingDef["type"];
  scopes: SettingDef["scopes"];
  merge: SettingDef["merge"];
  secret: boolean;
  teamLocked: boolean;
  repoScoped: boolean;
  /** Only repo sections may hold it; a client never offers a global write. */
  repoOnly?: boolean;
  /** Computed once, server-side: migrated AND not secret AND (not composite,
      or composite writes admitted by `allowComposite`). Every client edit
      affordance keys off this instead of re-deriving it. */
  writable: boolean;
  description: string;
  hasDefault: boolean;
  defaultValue: unknown;
  effective: EffectiveWire;
  storeVersion: number;
  schema?: JsonSchema;
  layerSchema?: JsonSchema;
  issues?: WireIssue[];
  mergedIssues?: SchemaIssue[];
  repos?: { identity: string; scopes: string[] }[];
}

/** A schema or path-guard problem on one store rung, flattened for a client
    that never sees `ExplainRow`. `message` is already secret-safe (see
    `issuesFromRows`); never derive a second copy from the raw row. A
    `kind: "diverged"` issue is an older store name edited after the current
    one was written; it carries `storeName` (the older name), and, unless
    the def is secret, `olderValue` and `currentValue`. */
export type WireIssue = {
  scope: string;
  file: string | null;
  repo?: string;
  kind: string;
  path: (string | number)[];
  message: string;
  [extra: string]: unknown;
};

/** One older store name beside the current one; values omitted for a secret def. */
export type OlderNameWire = { storeName: string; storedVersion: number; label: string; value?: unknown; authored?: unknown };

export type ExplainRowWire = Pick<
  ExplainRow,
  "scope" | "file" | "present" | "shadowed" | "invalid" | "nonconforming" | "storeName" | "storedVersion" | "olderLabel"
> & {
  value?: unknown;
  /** As stored on this rung, before migration; never confuse with `EffectiveWire.authored`, the winning deep-merge overlay. */
  authored?: unknown;
  olderNames?: OlderNameWire[];
};

/** The winning layer, precomputed server-side so a list view renders and
    patches rows without a per-key explain round trip. `scope` is the winning
    layer's scope, "default" when the registry default wins, null when
    nothing is set and there is no default. `value` is the winning layer's
    value, except for a `merge: "deep"` object key, where it is the merged
    value (registry default, then each live valid layer overlaid in order),
    and a `merge: "add"` array key, where it is every live valid layer's
    items, weakest first, without duplicates. `value` is absent for secrets,
    for an invalid winning layer, and when scope is null. An edit of a
    deep-merged or add key must start from the target layer's own value (its
    explain row), never from this `value`, or it bakes the default and weaker
    layers into that store. */
export interface EffectiveWire {
  scope: string | null;
  value?: unknown;
  /** For a `merge: "deep"` object key, the overlay of every present, valid,
      non-default layer, weakest to strongest (arrays replace). Omitted when
      no store layer sets the key; never set for secrets. */
  authored?: unknown;
  file: string | null;
  invalid?: string;
}

/** Who is looking and which teams' settings they may open. `team` is this
    Mac's own team; `teams` lists every team the role reaches, `team`
    included. `role: "none"` is a Mac with no org. */
export interface ViewerWire {
  username: string | null;
  name: string | null;
  role: "admin" | "owner" | "member" | "unknown" | "none";
  team: string | null;
  teams: string[];
  /** Each reachable team's owners, by roster name (username when the
      roster names none). */
  owners: Record<string, string[]>;
}

/** An admin reaches every team folder, an owner the teams they own, and
    anyone else only their own team. */
export function viewerFrom(input: { active: ActiveTeam; roles: OrgRoles; roster: RosterEntry[]; folders: string[] }): ViewerWire {
  const { active, roles, roster, folders } = input;
  if (active.org === null) return { username: null, name: null, role: "none", team: null, teams: [], owners: {} };
  const role = roleOf(active.username, roles);
  const own = active.team === null ? [] : [active.team];
  const reach = role.kind === "admin" ? folders : role.kind === "owner" ? role.teams.filter((t) => folders.includes(t)) : [];
  const name = active.username === null ? null : (roster.find((r) => sameUser(r.username, active.username!))?.name ?? null);
  const teams = [...new Set([...reach, ...own])].sort();
  const display = (u: string) => roster.find((r) => sameUser(r.username, u))?.name ?? u;
  const owners = Object.fromEntries(teams.map((t) => [t, (roles.teams[t]?.owners ?? []).map(display)]));
  return { username: active.username, name, role: role.kind, team: active.team, teams, owners };
}

function readViewer(rt: Pick<RtSettingsApi, "activeTeam">): ViewerWire {
  const active = rt.activeTeam();
  if (active.org === null) return viewerFrom({ active, roles: { admins: [], teams: {} }, roster: [], folders: [] });
  return viewerFrom({ active, roles: readOrgRoles(active.org), roster: readOrgRoster(active.org), folders: listTeamFolders(active.org) });
}

const PERSONAL = new Set(["user", "machine", "user.repo", "machine.repo"]);

/** While someone views another team, the page shows what that team's members
    get, so this Mac's own layers never reach the wire. */
function withoutPersonal<T extends { scope: string }>(rows: T[], other: boolean): T[] {
  return other ? rows.filter((r) => !PERSONAL.has(r.scope)) : rows;
}

/** The slice of rt-client the handler consumes — injectable so tests fake it
    without `mock.module`, which mutates the shared module registry and
    poisons every later test importing rt-client in the same process. */
export interface RtSettingsApi {
  allDefs: typeof allDefs;
  getDef: typeof getDef;
  isMigrated: typeof isMigrated;
  explainSetting: typeof explainSetting;
  validateValue: typeof validateValue;
  validateWrite: typeof validateWrite;
  setSetting: typeof setSetting;
  unsetSetting: typeof unsetSetting;
  pruneStoreName: typeof pruneStoreName;
  listUnregisteredSettings: typeof listUnregisteredSettings;
  repoSectionsFor: typeof repoSectionsFor;
  listStoreRepoIdentities: typeof listStoreRepoIdentities;
  listOrgs: typeof listOrgs;
  activeTeam: typeof activeTeam;
  /** Who is looking; defaults to this Mac's forge user, org roles and roster. */
  viewer?: () => ViewerWire;
  /** Repo identities known to the host app (e.g. its own repo registry), merged
      with the store-derived list on `GET {base}/repos`. Optional: a host with
      no such registry answers from stores alone. */
  listRepos?: () => Promise<string[]>;
}

export interface SettingsHandlerOptions {
  /** Route prefix the handler answers under. Default "/api/settings". */
  basePath?: string;
  /** Admit composite (object/array) keys to the write path. `true` admits
      every composite as a whole-JSON replacement. `"shaped"` admits only a
      key with a JSON Schema whose `SHAPES` kind is not `external`; the value
      itself is checked by `validateWrite`, not by a shape match. */
  allowComposite?: boolean | "shaped";
  /** Override the rt-client functions (tests, instrumentation). */
  rt?: Partial<RtSettingsApi>;
  /**
   * Write gate. The default admits only requests whose Host is loopback or a
   * deck-local TLD (localhost, 127.0.0.1, [::1], *.localhost, *.mattstack) —
   * a Host-header check, because a standard `Request` carries no peer
   * address. A host app that knows the real peer (e.g. Bun's
   * `server.requestIP`) should pass its own stricter predicate; an app with
   * any non-local exposure (relay, peer sync) MUST.
   */
  allowWrite?: (req: Request) => boolean;
}

const COMPOSITE_COPY = "composite value — edit the file";

function isComposite(def: SettingDef): boolean {
  return def.type === "object" || def.type === "array";
}

type CompositeMode = boolean | "shaped";

function compositeAllowed(def: SettingDef, mode: CompositeMode): boolean {
  if (!isComposite(def) || mode === true) return true;
  if (mode !== "shaped") return false;
  return hasSchema(def) && SHAPES[def.key]?.kind !== "external";
}

function isWritable(def: SettingDef, migrated: (def: SettingDef) => boolean = isMigrated, mode: CompositeMode = false): boolean {
  return migrated(def) && def.secret !== true && compositeAllowed(def, mode);
}

function isJsonBody(req: Request): boolean {
  const type = req.headers.get("content-type");
  return type !== null && type.split(";", 1)[0]!.trim().toLowerCase() === "application/json";
}

/** The one place "" becomes "no repo": every reader (query param, body field)
    funnels through this so validateWrite and setSetting see the same opts. */
function normalizeRepo(value: string | null | undefined): string | undefined {
  return value ? value : undefined;
}

export function defToWire(def: SettingDef, migrated: ((def: SettingDef) => boolean) | undefined, effective: EffectiveWire, composites: CompositeMode = false): SettingDefWire {
  const wire: SettingDefWire = {
    key: def.key,
    type: def.type,
    scopes: def.scopes,
    merge: def.merge,
    secret: def.secret === true,
    teamLocked: def.teamLocked === true,
    repoScoped: def.repoScoped === true,
    repoOnly: def.repoOnly === true,
    writable: isWritable(def, migrated, composites),
    description: def.description,
    hasDefault: "default" in def,
    defaultValue: def.default ?? null,
    effective,
    storeVersion: def.storeVersion ?? 1,
  };
  if (hasSchema(def)) {
    wire.schema = def.schema;
    if (def.merge === "deep" && def.type === "object" && def.layerSchema) wire.layerSchema = def.layerSchema;
  }
  return wire;
}

/**
 * Secret values must never reach the wire — presence and file only. This is
 * the ONLY place explain rows are serialized, so stripping here is the whole
 * guarantee; a second serialization path would reopen the leak.
 */
export function sanitizeRows(def: SettingDef, rows: ExplainRow[]): ExplainRowWire[] {
  return rows.map((row) => {
    const wire: ExplainRowWire = {
      scope: row.scope,
      file: row.file,
      present: row.present,
    };
    if (row.shadowed) wire.shadowed = row.shadowed;
    if (row.invalid) wire.invalid = def.secret === true ? "refused" : row.invalid;
    if (row.nonconforming) {
      wire.nonconforming = def.secret === true
        ? row.nonconforming.map((issue) => ({ path: issue.path, message: "does not match the schema" }))
        : row.nonconforming;
    }
    if (def.secret !== true && "value" in row) wire.value = row.value;
    if (row.storeName !== undefined) wire.storeName = row.storeName;
    if (row.storedVersion !== undefined) wire.storedVersion = row.storedVersion;
    if (row.olderLabel) wire.olderLabel = row.olderLabel;
    if (row.olderNames) {
      wire.olderNames = row.olderNames.map((o) =>
        def.secret === true
          ? { storeName: o.storeName, storedVersion: o.storedVersion, label: o.label }
          : { storeName: o.storeName, storedVersion: o.storedVersion, label: o.label, value: o.value, authored: o.authored },
      );
    }
    if (def.secret !== true && "authored" in row) wire.authored = row.authored;
    return wire;
  });
}

/** Flattens explain rows into wire issues. A secret's message is replaced
    outright, never derived from the row's own text: `row.invalid` for a
    path-guard rejection quotes the literal it refused. `repo` is stamped
    only on a row from a repo-section rung (`*.repo`): a global rung's issue
    applies with no repo in play, even when the request asked for one. */
function issuesFromRows(def: SettingDef, rows: ExplainRow[], repo?: string): WireIssue[] {
  const out: WireIssue[] = [];
  for (const row of rows) {
    const rowRepo = repo && row.scope.endsWith(".repo") ? repo : undefined;
    if (row.invalid) {
      const issue: WireIssue = { scope: row.scope, file: row.file, kind: "invalid", path: [], message: def.secret === true ? "refused" : row.invalid };
      if (rowRepo) issue.repo = rowRepo;
      out.push(issue);
    }
    if (row.nonconforming) {
      for (const nc of row.nonconforming) {
        const issue: WireIssue = { scope: row.scope, file: row.file, kind: "nonconforming", path: nc.path, message: def.secret === true ? "does not match the schema" : nc.message };
        if (rowRepo) issue.repo = rowRepo;
        out.push(issue);
      }
    }
    for (const o of row.olderNames ?? []) {
      if (o.label !== "diverged") continue;
      const issue: WireIssue = {
        scope: row.scope,
        file: row.file,
        kind: "diverged",
        path: [],
        message: `older store name "${o.storeName}" changed after "${row.storeName ?? def.key}" was written`,
        storeName: o.storeName,
      };
      if (def.secret !== true) {
        issue.olderValue = o.value;
        issue.currentValue = row.value;
      }
      if (rowRepo) issue.repo = rowRepo;
      out.push(issue);
    }
  }
  return out;
}

/** Winning layer from explain rows, which arrive weakest-first: the last
    present, un-shadowed row wins. A deep-merged object and an add list
    report the merged value, not the winning layer's slice. Secrets omit the
    value. */
export function effectiveFromRows(def: SettingDef, rows: ExplainRow[]): EffectiveWire {
  // A repo-only key's global layer is refused outright, never in effect,
  // unlike a type-invalid layer the page still names as the effective one.
  const live = rows.filter((r) => r.present && !r.shadowed && !(def.repoOnly && !r.scope.endsWith(".repo") && r.scope !== "default"));
  const top = live.at(-1);
  if (!top) {
    if ("default" in def) {
      const wire: EffectiveWire = { scope: "default", file: null };
      if (def.secret !== true) wire.value = def.default;
      return wire;
    }
    return { scope: null, file: null };
  }
  const wire: EffectiveWire = { scope: top.scope, file: top.file };
  if (top.invalid) wire.invalid = def.secret === true ? "refused" : top.invalid;
  if (def.secret === true) return wire;
  if (def.merge === "deep" && def.type === "object") {
    let merged: unknown = undefined;
    let authored: unknown = undefined;
    for (const r of live) {
      if (r.invalid || !("value" in r)) continue;
      merged = merged === undefined ? r.value : overlay(merged, r.value);
      if (r.scope !== "default") authored = authored === undefined ? r.value : overlay(authored, r.value);
    }
    if (!top.invalid) wire.value = merged;
    if (authored !== undefined) wire.authored = authored;
  } else if (def.merge === "add" && def.type === "array") {
    const merged: unknown[] = [];
    const seen = new Set<string>();
    for (const r of live) {
      if (r.invalid || !Array.isArray(r.value)) continue;
      for (const item of r.value) {
        const id = JSON.stringify(item);
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(item);
      }
    }
    wire.value = merged;
  } else if (!top.invalid && "value" in top) {
    wire.value = top.value;
  }
  return wire;
}

function defaultAllowWrite(req: Request): boolean {
  let host: string;
  try {
    host = new URL(req.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    host.endsWith(".mattstack")
  );
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

type View = { team: string | null; other: boolean; viewer: ViewerWire };

/** The team a request reads or writes: the one it names, else this Mac's.
    Naming a team the viewer's role does not reach answers a 403. */
function resolveView(rt: RtSettingsApi, named: string | undefined): View | Response {
  const viewer = rt.viewer ? rt.viewer() : readViewer(rt);
  if (!named || named === viewer.team) return { team: viewer.team, other: false, viewer };
  if (!viewer.teams.includes(named)) return json({ error: `you can't open the ${named} team's settings` }, 403);
  return { team: named, other: true, viewer };
}

/** Another team's values reach only a local caller, the same as a write:
    over an edge an admin's Mac would otherwise serve every team's settings. */
function otherTeamRemote(): Response {
  return json({ error: "another team's settings are local-only" }, 403);
}

function explainOpts(view: View, repo: string | undefined) {
  return view.other ? { repoIdentity: repo ?? null, team: view.team } : { repoIdentity: repo ?? null };
}

/**
 * Answers:
 *   GET  {base}/defs[?prefix=board.][?repo=host/owner/name]  → { defs: SettingDefWire[], unregistered, org, activeTeam }
 *   GET  {base}/explain/{key}[?repo=host/owner/name]         → { def, rows }
 *   GET  {base}/repos                                        → { repos: { identity, label }[] }
 *   POST {base}/set                                          → { rows, effective } | { error, issues? }
 *   POST {base}/unset                                        → { rows, effective } | { error }
 *   POST {base}/prune                                        → { rows, effective } | { error }
 * Returns null for anything else so the host's routing continues.
 */
export async function settingsHandler(
  req: Request,
  opts: SettingsHandlerOptions = {},
): Promise<Response | null> {
  const base = (opts.basePath ?? "/api/settings").replace(/\/+$/, "");
  const rt: RtSettingsApi = {
    allDefs,
    getDef,
    isMigrated,
    explainSetting,
    validateValue,
    validateWrite,
    setSetting,
    unsetSetting,
    pruneStoreName,
    listUnregisteredSettings,
    repoSectionsFor,
    listStoreRepoIdentities,
    listOrgs,
    activeTeam,
    ...opts.rt,
  };
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return null;
  }
  const path = url.pathname;
  if (
    path !== `${base}/defs` &&
    path !== `${base}/viewer` &&
    !path.startsWith(`${base}/explain/`) &&
    path !== `${base}/set` &&
    path !== `${base}/unset` &&
    path !== `${base}/prune` &&
    path !== `${base}/repos`
  ) {
    return null;
  }

  // Who you are and where, without the defs: what an app's top bar shows.
  if (path === `${base}/viewer` && req.method === "GET") {
    const active = rt.activeTeam();
    return json({
      org: active.org,
      activeTeam: active.team,
      viewer: rt.viewer ? rt.viewer() : readViewer(rt),
    });
  }

  if (path === `${base}/defs` && req.method === "GET") {
    const prefix = url.searchParams.get("prefix") ?? "";
    const repo = normalizeRepo(url.searchParams.get("repo"));
    const view = resolveView(rt, url.searchParams.get("team") ?? undefined);
    if (view instanceof Response) return view;
    if (view.other && !(opts.allowWrite ?? defaultAllowWrite)(req)) return otherTeamRemote();
    const mode = opts.allowComposite ?? false;
    const defs = rt.allDefs()
      .filter((d) => d.key.startsWith(prefix))
      .map((d) => {
        const rows = withoutPersonal(rt.explainSetting(d.key, explainOpts(view, repo)), view.other);
        const effective = effectiveFromRows(d, rows);
        const wire = defToWire(d, rt.isMigrated, effective, mode);
        wire.issues = issuesFromRows(d, rows, repo);
        if (hasSchema(d) && d.secret !== true && "value" in effective) {
          wire.mergedIssues = checkSchema(d, effective.value, { layer: false });
        }
        if (d.repoScoped === true) {
          wire.repos = view.other
            ? rt.repoSectionsFor(d.key, { team: view.team })
                .map((s) => ({ ...s, scopes: s.scopes.filter((sc) => !PERSONAL.has(sc)) }))
                .filter((s) => s.scopes.length > 0)
            : rt.repoSectionsFor(d.key);
          // With no repo picked the resolver reads no repo rung, so a broken
          // repo override would stay invisible; sweep each section's rungs.
          if (!repo) {
            for (const section of wire.repos) {
              const sectionRows = withoutPersonal(rt.explainSetting(d.key, explainOpts(view, section.identity)), view.other);
              wire.issues.push(...issuesFromRows(d, sectionRows.filter((r) => r.scope.endsWith(".repo")), section.identity));
            }
          }
        }
        return wire;
      });
    const active = rt.activeTeam();
    return json({
      defs,
      // Read from this Mac's own team and personal stores, so it never rides
      // along with another team's view.
      unregistered: view.other ? [] : rt.listUnregisteredSettings(),
      org: active.org,
      activeTeam: active.team,
      viewing: view.team,
      viewer: view.viewer,
    });
  }

  if (path.startsWith(`${base}/explain/`) && req.method === "GET") {
    const key = decodeURIComponent(path.slice(`${base}/explain/`.length));
    const def = rt.getDef(key);
    if (!def) return json({ error: `unknown setting "${key}"` }, 404);
    const repo = normalizeRepo(url.searchParams.get("repo"));
    const view = resolveView(rt, url.searchParams.get("team") ?? undefined);
    if (view instanceof Response) return view;
    if (view.other && !(opts.allowWrite ?? defaultAllowWrite)(req)) return otherTeamRemote();
    const rows = withoutPersonal(rt.explainSetting(key, explainOpts(view, repo)), view.other);
    return json({
      def: defToWire(def, rt.isMigrated, effectiveFromRows(def, rows), opts.allowComposite ?? false),
      rows: sanitizeRows(def, rows),
    });
  }

  if (path === `${base}/repos` && req.method === "GET") {
    const ids = new Set<string>(rt.listStoreRepoIdentities());
    if (rt.listRepos) {
      try {
        for (const id of await rt.listRepos()) ids.add(id);
      } catch {
        // A host registry outage must not blank the identities already known from stores.
      }
    }
    const repos = [...ids].sort().map((identity) => ({ identity, label: identity.slice(identity.indexOf("/") + 1) }));
    return json({ repos });
  }

  if (path === `${base}/set` && req.method === "POST") {
    const allow = opts.allowWrite ?? defaultAllowWrite;
    if (!allow(req)) return json({ error: "settings writes are local-only" }, 403);
    if (!isJsonBody(req)) return json({ error: "expected application/json" }, 415);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const key = typeof body?.key === "string" ? body.key : "";
    const scope = (typeof body?.scope === "string" ? body.scope : "") as SettingScope;
    const team = typeof body?.team === "string" ? body.team : undefined;
    const repo = normalizeRepo(typeof body?.repo === "string" ? body.repo : undefined);
    const view = resolveView(rt, team);
    if (view instanceof Response) return view;
    if (view.other && PERSONAL.has(scope)) {
      return json({ error: `your ${scope} settings are hidden while you view the ${view.team} team` }, 400);
    }
    const value = body?.value;

    const def = rt.getDef(key);
    if (!def) return json({ error: `unknown setting "${key}"` }, 404);
    if (def.secret === true) return json({ error: "secret keys are not writable here" }, 400);
    const mode = opts.allowComposite ?? false;
    if (!compositeAllowed(def, mode)) {
      return json({ error: mode === "shaped" ? `"${key}" has no editable shape` : COMPOSITE_COPY }, 400);
    }
    if (!def.scopes.includes(scope)) {
      return json(
        { error: `"${key}" cannot be set in the ${scope} store (allowed: ${def.scopes.join(", ")})` },
        400,
      );
    }
    if (!isWritable(def, rt.isMigrated, mode)) {
      return json({ error: `"${key}" is not writable through the resolver yet` }, 400);
    }
    try {
      const check = rt.validateWrite(def, value, { scope, repoIdentity: repo, team });
      if (!check.ok) return json({ error: check.reason, issues: check.issues }, 400);
    } catch (err) {
      return json({ error: (err as Error).message }, 400);
    }

    const writeOpts: { team?: string; repoIdentity?: string } = {};
    if (team) writeOpts.team = team;
    if (repo) writeOpts.repoIdentity = repo;
    try {
      rt.setSetting(key, value, scope, writeOpts);
    } catch (err) {
      return json({ error: (err as Error).message }, 400);
    }
    const after = withoutPersonal(rt.explainSetting(key, explainOpts(view, repo)), view.other);
    return json({ rows: sanitizeRows(def, after), effective: effectiveFromRows(def, after) });
  }

  if (path === `${base}/unset` && req.method === "POST") {
    const allow = opts.allowWrite ?? defaultAllowWrite;
    if (!allow(req)) return json({ error: "settings writes are local-only" }, 403);
    if (!isJsonBody(req)) return json({ error: "expected application/json" }, 415);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const key = typeof body?.key === "string" ? body.key : "";
    const scope = (typeof body?.scope === "string" ? body.scope : "") as SettingScope;
    const team = typeof body?.team === "string" ? body.team : undefined;
    const repo = normalizeRepo(typeof body?.repo === "string" ? body.repo : undefined);
    const view = resolveView(rt, team);
    if (view instanceof Response) return view;
    if (view.other && PERSONAL.has(scope)) {
      return json({ error: `your ${scope} settings are hidden while you view the ${view.team} team` }, 400);
    }

    // Same ladder as set, minus the value check: removal has no value. The
    // writable/composite gates stay: a row the UI renders read-only must not
    // be clearable through the API either.
    const def = rt.getDef(key);
    if (!def) return json({ error: `unknown setting "${key}"` }, 404);
    if (def.secret === true) return json({ error: "secret keys are not writable here" }, 400);
    const mode = opts.allowComposite ?? false;
    if (!compositeAllowed(def, mode)) {
      return json({ error: mode === "shaped" ? `"${key}" has no editable shape` : COMPOSITE_COPY }, 400);
    }
    if (!def.scopes.includes(scope)) {
      return json(
        { error: `"${key}" cannot be unset in the ${scope} store (allowed: ${def.scopes.join(", ")})` },
        400,
      );
    }
    if (!isWritable(def, rt.isMigrated, mode)) {
      return json({ error: `"${key}" is not writable through the resolver yet` }, 400);
    }

    const unsetOpts: { team?: string; repoIdentity?: string } = {};
    if (team) unsetOpts.team = team;
    if (repo) unsetOpts.repoIdentity = repo;
    try {
      rt.unsetSetting(key, scope, unsetOpts);
    } catch (err) {
      return json({ error: (err as Error).message }, 400);
    }
    const after = withoutPersonal(rt.explainSetting(key, explainOpts(view, repo)), view.other);
    return json({ rows: sanitizeRows(def, after), effective: effectiveFromRows(def, after) });
  }

  if (path === `${base}/prune` && req.method === "POST") {
    const allow = opts.allowWrite ?? defaultAllowWrite;
    if (!allow(req)) return json({ error: "settings writes are local-only" }, 403);
    if (!isJsonBody(req)) return json({ error: "expected application/json" }, 415);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const key = typeof body?.key === "string" ? body.key : "";
    const scope = (typeof body?.scope === "string" ? body.scope : "") as SettingScope;
    const team = typeof body?.team === "string" ? body.team : undefined;
    const repo = normalizeRepo(typeof body?.repo === "string" ? body.repo : undefined);
    const view = resolveView(rt, team);
    if (view instanceof Response) return view;
    if (view.other && PERSONAL.has(scope)) {
      return json({ error: `your ${scope} settings are hidden while you view the ${view.team} team` }, 400);
    }
    const storeName = typeof body?.storeName === "string" ? body.storeName : "";

    const def = rt.getDef(key);
    if (!def) return json({ error: `unknown setting "${key}"` }, 404);
    if (def.secret === true) return json({ error: "secret keys are not writable here" }, 400);
    const mode = opts.allowComposite ?? false;
    if (!compositeAllowed(def, mode)) {
      return json({ error: mode === "shaped" ? `"${key}" has no editable shape` : COMPOSITE_COPY }, 400);
    }
    if (!def.scopes.includes(scope)) {
      return json(
        { error: `"${key}" cannot be pruned in the ${scope} store (allowed: ${def.scopes.join(", ")})` },
        400,
      );
    }
    if (!isWritable(def, rt.isMigrated, mode)) {
      return json({ error: `"${key}" is not writable through the resolver yet` }, 400);
    }
    if (!storeName) return json({ error: "storeName is required" }, 400);

    const pruneOpts: { team?: string; repoIdentity?: string; force: boolean } = { force: body?.force === true };
    if (team) pruneOpts.team = team;
    if (repo) pruneOpts.repoIdentity = repo;
    try {
      const { removed } = rt.pruneStoreName(key, storeName, scope, pruneOpts);
      if (!removed) return json({ error: `"${storeName}" is not in the ${scope} store` }, 400);
    } catch (err) {
      return json({ error: (err as Error).message }, 400);
    }
    const after = withoutPersonal(rt.explainSetting(key, explainOpts(view, repo)), view.other);
    return json({ rows: sanitizeRows(def, after), effective: effectiveFromRows(def, after) });
  }

  return json({ error: "method not allowed" }, 405);
}
