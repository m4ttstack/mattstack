import { checkHealth, type LaunchdService } from '../../core/discover.ts';
import { getLive } from '../../core/settings.ts';
import { liveProcessIds, type LiveKind } from '../registry/deck-manifest.ts';
import { isMattstackOwned, type AppRecord } from '../registry/records.ts';
import { readLinkedManifest } from '../registry/serve-shape.ts';
import { isPlatformManagedBy } from '../services/manager.ts';
import { liveManifestAt } from './engine.ts';
import { liveLabel } from './labels.ts';
import { setupFor } from './setup.ts';
import { appDirIn, branchOf, sharedRootFor } from './sources.ts';

export interface LiveRow {
  branch: string | null;
  main: boolean;
  startedAt: string;
  uiPort: number | null;
  movedFrom: string | null;
  processes: Array<{
    id: string;
    kind: LiveKind;
    command: string;
    port: number | null;
    running: boolean;
  }>;
}

export interface LiveRowFields {
  live?: LiveRow;
  liveSetup?: {
    state: 'running' | 'failed';
    branch: string | null;
    log: string[];
  };
  /** null: the app can go live; a string: why it cannot; absent: live controls do not apply. */
  liveBlocked?: string | null;
}

/** A server or ui is up when its port answers; a worker has no port, so its process decides. */
export async function liveRowFields(
  record: AppRecord | undefined,
  opts: { devMode: boolean; local: boolean },
  services: LaunchdService[],
  portUp: (port: number) => Promise<boolean> = async port =>
    (await checkHealth(port)).ok
): Promise<LiveRowFields> {
  if (!record || !opts.devMode || !opts.local) return {};
  if (!isMattstackOwned(record) || isPlatformManagedBy(record.managedBy))
    return {};
  const out: LiveRowFields = {};
  const setup = setupFor(record.name);
  if (setup)
    out.liveSetup = {
      state: setup.state,
      branch: setup.branch,
      log: setup.log,
    };
  const state = getLive(record.name);
  const sharedRoot = state ? sharedRootFor(record) : null;
  const dir =
    state && sharedRoot ? appDirIn(record, state.source, sharedRoot) : null;
  if (state && sharedRoot && dir) {
    const manifest = liveManifestAt(dir);
    const live = manifest.ok ? manifest.live : [];
    const ids = liveProcessIds(live);
    out.live = {
      branch: branchOf(state.source),
      main: state.source === sharedRoot,
      startedAt: state.startedAt,
      uiPort: state.uiPort ?? null,
      movedFrom: state.movedFrom ?? null,
      processes: await Promise.all(
        live.map(async (p, i) => {
          const port =
            p.kind === 'server'
              ? record.port
              : p.kind === 'ui'
                ? (state.uiPort ?? null)
                : null;
          return {
            id: ids[i]!,
            kind: p.kind,
            command: p.start,
            port,
            running:
              port !== null
                ? await portUp(port)
                : services.find(
                    s => s.label === liveLabel(record.name, ids[i]!)
                  )?.pid != null,
          };
        })
      ),
    };
    return out;
  }
  const link = readLinkedManifest(record);
  if (link.state !== 'linked') return out;
  out.liveBlocked =
    link.manifest.liveError ??
    (link.manifest.live ? null : 'no live list in the manifest');
  return out;
}
