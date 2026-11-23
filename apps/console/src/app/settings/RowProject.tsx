import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Group, Select } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import classes from './RowProject.module.css';
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

/** Told the project an open row picks, so a host can keep it in its URL. */
export const SettingsPickRepoContext = createContext<
  ((repo: string) => void) | null
>(null);

/** A per-project row picks its own project: its controls, its panel and
    its writes all read that project's sections, while the rest of the
    page reads none. The row's value is that project's, read from
    /explain, until a project is picked. */
export function RowProjectScope({
  def,
  open,
  seed,
  children,
}: {
  def: SettingDefWire;
  open: boolean;
  seed: string | null;
  children: (def: SettingDefWire, project: RowProject) => ReactNode;
}) {
  const [repo, setRepo] = useState<string | null>(seed);
  useEffect(() => {
    if (seed) setRepo(seed);
  }, [seed]);
  // A project picked while open must not linger in the closed header,
  // where its control would write to a repo no longer on screen.
  useEffect(() => {
    if (!open) setRepo(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on close only
  }, [open]);
  // Each new def from the page follows a write or a reload, so the
  // project's own value is read again with it.
  const [revision, setRevision] = useState(0);
  useEffect(() => setRevision(r => r + 1), [def]);
  const explained = useKeyExplain(def.key, repo, revision, repo !== null);
  const shown =
    repo !== null && explained.def
      ? { ...def, effective: explained.def.effective }
      : def;
  const onPick = useContext(SettingsPickRepoContext);
  const project: RowProject = {
    repo,
    pick: picked => {
      setRepo(picked);
      if (open) onPick?.(picked);
    },
  };
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

const ownerOf = (label: string) => {
  const at = label.lastIndexOf('/');
  return at < 0 ? '' : label.slice(0, at);
};

/** Mantine scrolls the picked option only as far as the list's edge;
    this runs after it and puts that option in the middle instead. */
function centerChecked(input: HTMLInputElement | null) {
  setTimeout(() => {
    const listId = input?.getAttribute('aria-controls');
    const list = listId ? document.getElementById(listId) : null;
    const option = list?.querySelector<HTMLElement>('[data-checked]');
    const viewport = option?.closest<HTMLElement>(
      '.mantine-ScrollArea-viewport'
    );
    if (!option || !viewport) return;
    const top =
      option.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top +
      viewport.scrollTop;
    viewport.scrollTop =
      top - (viewport.clientHeight - option.offsetHeight) / 2;
  }, 0);
}

const nameOf = (label: string) => label.slice(label.lastIndexOf('/') + 1);

/** The options grouped under their owner, so a long list reads as a few
    short ones and each row shows only the repo's own name. */
function byOwner(options: { value: string; label: string }[]) {
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const o of options) {
    const owner = ownerOf(o.label);
    groups.set(owner, [...(groups.get(owner) ?? []), o]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, items]) => ({
      group,
      items: [...items].sort((a, b) =>
        nameOf(a.label).localeCompare(nameOf(b.label))
      ),
    }));
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
  const input = useRef<HTMLInputElement>(null);
  return (
    <Select
      ref={input}
      onDropdownOpen={() => centerChecked(input.current)}
      size="sm"
      w={220}
      aria-label={label}
      placeholder={placeholder}
      searchable
      allowDeselect={false}
      leftSection={<Icon name="folder" size={14} />}
      data={byOwner(options)}
      renderOption={({ option, checked }) => (
        <Group gap={6} wrap="nowrap">
          {checked && <Icon name="check" size={14} />}
          {nameOf(option.label)}
        </Group>
      )}
      comboboxProps={{ width: 280, position: 'bottom-end' }}
      maxDropdownHeight={320}
      classNames={{ groupLabel: classes.groupLabel, option: classes.option }}
      value={value}
      onChange={v => v && onPick(v)}
      nothingFoundMessage="No project matches"
    />
  );
}
