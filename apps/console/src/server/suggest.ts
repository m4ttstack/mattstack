import {
  getSetting,
  readProjectMRs,
  serializeIdentity,
} from '@mattstack/rt-client';

export interface SuggestDeps {
  setting: <T>(key: string) => T | undefined;
  /** The daemon's cached CODEOWNERS sections for one repo identity, or null
      when it has none yet. Never starts a sync. */
  knownSections: (repoId: string) => Promise<string[] | null>;
}

const realDeps: SuggestDeps = {
  setting: <T>(key: string) => getSetting<T>(key).value,
  knownSections: async repoId => {
    const res = await readProjectMRs(repoId);
    return res.ok ? (res.data?.scope?.knownSections ?? null) : null;
  },
};

/** Named suggestion lists a settings field asks for with `suggest`. Each
    answers `values` (sorted, deduped) or `null` when the source cannot say
    yet, so a field shows no "not one of these" note on an unknown list. */
export const SUGGESTERS: Record<
  string,
  (deps: SuggestDeps) => Promise<string[] | null>
> = {
  /** Every CODEOWNERS section header rt has seen in the board's projects,
      the same daemon read the board itself uses. */
  'codeowners-sections': async deps => {
    const host = deps
      .setting<string>('board.gitlabHost')
      ?.replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
      .toLowerCase();
    const projects = deps.setting<string[]>('board.projects') ?? [];
    if (!host || projects.length === 0) return null;
    const lists = await Promise.all(
      projects.map(project =>
        deps
          .knownSections(
            serializeIdentity({ kind: 'remote', id: `${host}/${project}` })
          )
          .catch(() => null)
      )
    );
    if (lists.every(l => l === null)) return null;
    return [...new Set(lists.flatMap(l => l ?? []))].sort();
  },
};

export async function suggestValues(
  source: string,
  deps: SuggestDeps = realDeps
): Promise<string[] | null | undefined> {
  if (!Object.hasOwn(SUGGESTERS, source)) return undefined;
  try {
    return await SUGGESTERS[source]!(deps);
  } catch {
    return null;
  }
}
