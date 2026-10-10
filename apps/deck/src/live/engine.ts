import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

import {
  MATTSTACK_TLD,
  readRoutes,
  readServices,
} from '../../core/discover.ts';
import { setAppRoutesPort } from '../../core/routes-writer.ts';
import {
  clearLive,
  clearOverride,
  getLive,
  getOverride,
  setLive,
  type LiveState,
} from '../../core/settings.ts';
import { isDevMode } from '../api/dev-mode.ts';
import { getPlatformSettings } from '../api/platform-settings.ts';
import { logsDir } from '../api/state.ts';
import { allocatePort } from '../registry/allocate.ts';
import {
  liveProcessIds,
  readDeckManifest,
  startArgv,
  type LiveProcess,
} from '../registry/deck-manifest.ts';
import {
  getRecord,
  isMattstackOwned,
  listRecords,
  type AppRecord,
} from '../registry/records.ts';
import { readLinkedManifest } from '../registry/serve-shape.ts';
import { serviceEnv } from '../registry/service-env.ts';
import { composeCommandPath, resolveProgram } from '../services/exec-env.ts';
import { installedMatches } from '../services/installed.ts';
import { agentsDir } from '../services/launchd.ts';
import {
  isPlatformManagedBy,
  type ServiceManager,
  type ServiceSpec,
} from '../services/manager.ts';
import { isLiveLabel, liveLabel, liveLabelPrefix } from './labels.ts';
import {
  clearSetup,
  recordSetupFailure,
  runSetup,
  setupFor,
  type SetupDeps,
} from './setup.ts';
import {
  appDirIn,
  branchOf,
  listLiveSources,
  sharedRootFor,
  type SourcesDeps,
} from './sources.ts';

export interface LiveDeps {
  devMode?: () => boolean;
  sources?: SourcesDeps;
  setup?: SetupDeps;
  now?: () => Date;
  installedLabels?: () => Promise<string[]>;
  onRouteWrite?: () => void;
  tlds?: () => string[];
  reinstall?: () => Promise<unknown>;
}

export type LiveResult = { status: number; body: unknown };

const refuse = (status: number, error: string): LiveResult => ({
  status,
  body: { error },
});

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

function tldsOf(deps: LiveDeps): string[] {
  if (deps.tlds) return deps.tlds();
  return [...new Set([...getPlatformSettings().tlds, MATTSTACK_TLD])];
}

async function installedLabelsOf(deps: LiveDeps): Promise<string[]> {
  if (deps.installedLabels) return deps.installedLabels();
  let files: string[];
  try {
    files = readdirSync(agentsDir());
  } catch {
    return [];
  }
  return files
    .filter(f => f.endsWith('.plist'))
    .map(f => f.slice(0, -'.plist'.length))
    .filter(isLiveLabel);
}

const locks = new Map<string, Promise<unknown>>();

/** Serializes every live operation on one app (go-live, stop, the tick, the
    sweep), so none installs services or writes routes over another. Not
    reentrant: code already holding the lock calls the unlocked helpers. */
export function withLiveLock<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const run = (locks.get(name) ?? Promise.resolve()).then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  locks.set(name, tail);
  void tail.then(() => {
    if (locks.get(name) === tail) locks.delete(name);
  });
  return run;
}

export function liveRefusal(
  record: AppRecord | undefined,
  devMode: boolean
): string | null {
  if (!record) return 'unknown app';
  if (!devMode) return 'live mode only runs in the dev app';
  if (isPlatformManagedBy(record.managedBy))
    return 'deck itself cannot go live';
  if (!isMattstackOwned(record)) return 'only mattstack apps can go live';
  if (readLinkedManifest(record).state !== 'linked')
    return `${record.name} has no linked source`;
  return null;
}

export function liveManifestAt(
  appDir: string
): { ok: true; live: LiveProcess[] } | { ok: false; error: string } {
  const parsed = readDeckManifest(appDir);
  if (!parsed) return { ok: false, error: 'no mattstack.deck.json there' };
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.manifest.liveError)
    return { ok: false, error: `can't go live: ${parsed.manifest.liveError}` };
  if (!parsed.manifest.live)
    return { ok: false, error: "can't go live: the manifest has no live list" };
  return { ok: true, live: parsed.manifest.live };
}

/** The command PATH, not the service PATH: `Helpers/bun` cannot load the
    native addon vite needs, so the user's bun has to win. */
export function liveSpecs(
  record: AppRecord,
  live: LiveProcess[],
  appDir: string,
  uiPort: number | null
): ServiceSpec[] {
  const base = serviceEnv(record);
  const path = composeCommandPath({ inherited: base.PATH ?? process.env.PATH });
  const ids = liveProcessIds(live);
  return live.map((proc, i) => {
    const id = ids[i]!;
    const [argv0, ...rest] = startArgv(proc.start);
    const program = resolveProgram(argv0!, path);
    if (!program) throw new Error(`couldn't find ${argv0}`);
    const environment: Record<string, string> = {
      ...base,
      PATH: path,
      SERVER_PORT: String(record.port),
    };
    if (proc.kind === 'ui') environment.PORT = String(uiPort);
    else if (proc.kind === 'worker') delete environment.PORT;
    return {
      label: liveLabel(record.name, id),
      programArguments: [program, ...rest],
      workingDirectory: appDir,
      environment,
      stdoutPath: join(logsDir(), `${record.name}.live.${id}.out.log`),
      stderrPath: join(logsDir(), `${record.name}.live.${id}.err.log`),
    };
  });
}

export async function uninstallLive(
  name: string,
  manager: ServiceManager,
  deps: LiveDeps = {},
  keep: Set<string> = new Set()
): Promise<void> {
  const prefix = liveLabelPrefix(name);
  for (const label of await installedLabelsOf(deps))
    if (label.startsWith(prefix) && !keep.has(label))
      await manager.uninstall(label);
}

function routeTo(record: AppRecord, port: number, deps: LiveDeps): void {
  if (setAppRoutesPort(record.name, port, tldsOf(deps)).length)
    deps.onRouteWrite?.();
}

/** Installs only what differs from the installed plists, so a sweep over an
    app that is already live restarts nothing. */
export async function installLive(
  record: AppRecord,
  state: LiveState,
  manager: ServiceManager,
  deps: LiveDeps = {}
): Promise<string | null> {
  const sharedRoot = sharedRootFor(record);
  if (!sharedRoot)
    return `${record.name}'s linked source is not a git checkout`;
  const appDir = appDirIn(record, state.source, sharedRoot)!;
  if (!existsSync(appDir)) return `that checkout has no apps/${record.name}`;
  const manifest = liveManifestAt(appDir);
  if (!manifest.ok) return manifest.error;
  const hasUi = manifest.live.some(p => p.kind === 'ui');
  if (hasUi && state.uiPort === undefined) return 'no live UI port recorded';
  let specs: ServiceSpec[];
  try {
    specs = liveSpecs(record, manifest.live, appDir, state.uiPort ?? null);
  } catch (err) {
    return messageOf(err);
  }
  try {
    await uninstallLive(
      record.name,
      manager,
      deps,
      new Set(specs.map(s => s.label))
    );
    for (const spec of specs) {
      if (installedMatches(spec.label, spec)) continue;
      await manager.uninstall(spec.label);
      await manager.install(spec);
    }
  } catch (err) {
    return messageOf(err);
  }
  routeTo(record, hasUi ? state.uiPort! : record.port, deps);
  return null;
}

async function freeUiPort(): Promise<number | null> {
  return allocatePort(listRecords(), readRoutes(), await readServices());
}

/** Per-app go-live waiting on setup; a stop or a newer go-live replaces it,
    so a setup that finishes late activates nothing. */
const pending = new Map<string, symbol>();

async function rollback(
  name: string,
  manager: ServiceManager,
  deps: LiveDeps
): Promise<void> {
  try {
    await stopLiveUnlocked(name, manager, deps);
  } catch {}
  try {
    await deps.reinstall?.();
  } catch {}
}

async function activate(
  record: AppRecord,
  source: string,
  live: LiveProcess[],
  manager: ServiceManager,
  deps: LiveDeps
): Promise<string | null> {
  let err: string | null;
  try {
    const previous = getLive(record.name);
    const hasUi = live.some(p => p.kind === 'ui');
    const uiPort = hasUi
      ? (previous?.uiPort ?? (await freeUiPort()))
      : undefined;
    if (hasUi && uiPort == null) return 'no free port for the live UI';
    if (!previous) {
      if (record.label) await manager.uninstall(record.label);
      if (getOverride(record.name)) clearOverride(record.name);
    }
    setLive(record.name, {
      source,
      branch: branchOf(source),
      startedAt: (deps.now ?? (() => new Date()))().toISOString(),
      ...(uiPort != null && { uiPort }),
    });
    err = await installLive(record, getLive(record.name)!, manager, deps);
  } catch (e) {
    err = messageOf(e);
  }
  if (err) await rollback(record.name, manager, deps);
  return err;
}

function afterSetup(
  record: AppRecord,
  source: string,
  branch: string | null,
  live: LiveProcess[],
  manager: ServiceManager,
  deps: LiveDeps
): void {
  const token = Symbol(record.name);
  pending.set(record.name, token);
  const fail = (reason: string) =>
    recordSetupFailure(record.name, source, branch, [
      `setup finished, but going live failed: ${reason}`,
    ]);
  void runSetup(record.name, source, branch, deps.setup)
    .then(async ok => {
      if (pending.get(record.name) !== token) return;
      pending.delete(record.name);
      if (!ok) return;
      const err = await withLiveLock(record.name, () =>
        activate(record, source, live, manager, deps)
      );
      if (err) fail(err);
    })
    .catch(e => {
      if (pending.get(record.name) === token) pending.delete(record.name);
      fail(messageOf(e));
    });
}

export async function goLive(
  name: string,
  source: string,
  manager: ServiceManager,
  deps: LiveDeps = {}
): Promise<LiveResult> {
  const record = getRecord(name);
  const refusal = liveRefusal(record, (deps.devMode ?? isDevMode)());
  if (refusal) return refuse(refusal === 'unknown app' ? 404 : 400, refusal);
  if (setupFor(name)?.state === 'running')
    return refuse(409, `${name} is still setting up`);
  pending.delete(name);
  const sharedRoot = sharedRootFor(record!);
  if (!sharedRoot)
    return refuse(400, `${name}'s linked source is not a git checkout`);
  const { sources } = await listLiveSources(sharedRoot, deps.sources);
  const picked = sources.find(s => s.path === source);
  if (!picked)
    return refuse(400, 'pick the shared checkout or one of your worktrees');
  const appDir = appDirIn(record!, source, sharedRoot)!;
  if (!existsSync(appDir))
    return refuse(400, `that checkout has no apps/${name}`);
  const manifest = liveManifestAt(appDir);
  if (!manifest.ok) return refuse(400, manifest.error);
  if (picked.needsSetup) {
    afterSetup(record!, source, picked.branch, manifest.live, manager, deps);
    return { status: 202, body: { ok: true, setup: 'running' } };
  }
  const err = await withLiveLock(name, () =>
    activate(record!, source, manifest.live, manager, deps)
  );
  return err ? refuse(500, err) : { status: 200, body: { ok: true } };
}

export function stopLive(
  name: string,
  manager: ServiceManager,
  deps: LiveDeps = {}
): Promise<LiveResult> {
  return withLiveLock(name, () => stopLiveUnlocked(name, manager, deps));
}

/** For callers already holding the app's live lock. */
export async function stopLiveUnlocked(
  name: string,
  manager: ServiceManager,
  deps: LiveDeps = {}
): Promise<LiveResult> {
  const record = getRecord(name);
  if (!record) return refuse(404, 'unknown app');
  pending.delete(name);
  clearSetup(name);
  await uninstallLive(name, manager, deps);
  routeTo(record, record.port, deps);
  clearLive(name);
  return { status: 200, body: { ok: true } };
}
