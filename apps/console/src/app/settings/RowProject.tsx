import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Select } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import {
  SettingsRepoContext,
  useKeyExplain,
  useRepos,
} from './useConsoleSettings';
import { repoLabel } from './view';

interface RowProject {
  repo: string | null;
  pick: (repo: string) => void;
}

const RowProjectContext = createContext<RowProject | null>(null);

/** The project a per-project row reads and writes, or null outside one. */
export function useRowProject(): RowProject | null {
  return useContext(RowProjectContext);
}

/** A link that opens a row on one project (a Fix on that project's layer)
    names it here; every other row starts on no project. */
export const SettingsSeedRepoContext = createContext<string | null>(null);

/** A per-project row picks its own project: its controls, its panel and
    its writes all read that project's sections, while the rest of the
    page reads none. The row's value is that project's, read from
    /explain, until a project is picked. */
export function RowProjectScope({
  def,
  seed,
  children,
}: {
  def: SettingDefWire;
  seed: string | null;
  children: (def: SettingDefWire, project: RowProject) => ReactNode;
}) {
  const [repo, setRepo] = useState<string | null>(seed);
  useEffect(() => {
    if (seed) setRepo(seed);
  }, [seed]);
  // Each new def from the page follows a write or a reload, so the
  // project's own value is read again with it.
  const [revision, setRevision] = useState(0);
  useEffect(() => setRevision(r => r + 1), [def]);
  const explained = useKeyExplain(def.key, repo, revision, repo !== null);
  const shown =
    repo !== null && explained.def
      ? { ...def, effective: explained.def.effective }
      : def;
  const project: RowProject = { repo, pick: setRepo };
  return (
    <SettingsRepoContext.Provider value={repo}>
      <RowProjectContext.Provider value={project}>
        {children(shown, project)}
      </RowProjectContext.Provider>
    </SettingsRepoContext.Provider>
  );
}

/** The projects a row can name: every repo rt knows, plus any project a
    store already holds a section for. */
export function useProjectOptions(def: SettingDefWire) {
  const { repos } = useRepos();
  const known = new Map(repos.map(r => [r.identity, r.label]));
  for (const r of def.repos ?? [])
    if (!known.has(r.identity)) known.set(r.identity, repoLabel(r.identity));
  return [...known.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));
}

export function ProjectPicker({
  def,
  value,
  onPick,
  exclude = [],
  placeholder = 'Pick a project',
  label = 'project',
}: {
  def: SettingDefWire;
  value: string | null;
  onPick: (repo: string) => void;
  exclude?: string[];
  placeholder?: string;
  label?: string;
}) {
  const options = useProjectOptions(def).filter(
    o => o.value === value || !exclude.includes(o.value)
  );
  return (
    <Select
      size="sm"
      w={220}
      aria-label={label}
      placeholder={placeholder}
      searchable
      allowDeselect={false}
      leftSection={<Icon name="folder" size={14} />}
      data={options}
      value={value}
      onChange={v => v && onPick(v)}
      nothingFoundMessage="No project matches"
    />
  );
}
