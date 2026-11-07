import { useEffect, useMemo, type CSSProperties } from 'react';
import { useColorScheme } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import type { FileTreeRowDecorationRenderer } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';

import type { DiffFile } from './CommitDiff';
import classes from './DiffFileTree.module.css';

/** The tree renders in a shadow root; console tokens reach it as inherited
    custom properties through its override slots. */
const TREE_STYLE = {
  height: '100%',
  // Tighter than the library's defaults, so deep folders keep their names.
  '--trees-padding-inline-override': '8px',
  '--trees-level-gap-override': '6px',
  '--trees-indent-guide-bg-override': 'var(--tk-border-soft)',
  '--trees-bg-override': 'var(--tk-card)',
  // Hover reads as a faint step toward the selection, not a grey slab.
  '--trees-bg-muted-override':
    'color-mix(in srgb, var(--tk-fill-accent) 6%, transparent)',
  '--trees-fg-override': 'var(--tk-text-1)',
  '--trees-fg-muted-override': 'var(--tk-text-3)',
  '--trees-accent-override': 'var(--tk-fill-accent)',
  '--trees-border-color-override': 'var(--tk-border-soft)',
  '--trees-focus-ring-color-override': 'var(--tk-fill-accent)',
  // The picked row's fill is enough; no ring around it once it has focus.
  '--trees-selected-focused-border-color-override': 'transparent',
  // The library's own status hues are too light on a light card; the
  // console's text steps clear 4.5 in both schemes.
  '--trees-status-added-override': 'var(--tk-text-ok)',
  '--trees-git-added-color-override': 'var(--tk-text-ok)',
  '--trees-status-untracked-override': 'var(--tk-text-ok)',
  '--trees-git-untracked-color-override': 'var(--tk-text-ok)',
  '--trees-status-deleted-override': 'var(--tk-text-bad)',
  '--trees-git-deleted-color-override': 'var(--tk-text-bad)',
  '--trees-status-modified-override': 'var(--tk-text-accent)',
  '--trees-git-modified-color-override': 'var(--tk-text-accent)',
  '--trees-status-renamed-override': 'var(--tk-text-purple)',
  '--trees-git-renamed-color-override': 'var(--tk-text-purple)',
} as CSSProperties;

function statusOf(patch: string) {
  if (/^new file mode/m.test(patch)) return 'added' as const;
  if (/^deleted file mode/m.test(patch)) return 'deleted' as const;
  if (/^rename from/m.test(patch)) return 'renamed' as const;
  return 'modified' as const;
}

/** The folder every changed file sits under, with its trailing slash, or ''
    when they share none. */
export function sharedFolder(paths: string[]): string {
  if (paths.length === 0) return '';
  const dirs = paths.map(p => p.split('/').slice(0, -1));
  const first = dirs[0]!;
  let n = 0;
  while (n < first.length && dirs.every(d => d[n] === first[n])) n++;
  return n === 0 ? '' : `${first.slice(0, n).join('/')}/`;
}

type Dir = { dirs: Map<string, Dir>; files: string[] };

/** One row's label for a chain of single-folder directories: a short chain
    in full, a long one by its first folder and its last two, which name
    what changed. The division slash keeps the tree from
    splitting it back into rows. */
function chainLabel(chain: string[]): string {
  const shown = chain.length > 4 ? [chain[0]!, '…', ...chain.slice(-2)] : chain;
  return shown.join(' \u2215 ');
}

/** Each path as the tree should draw it, with every chain of folders that
    hold only one folder drawn as one row. */
export function compactPaths(paths: string[]): Map<string, string> {
  const root: Dir = { dirs: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split('/');
    let at = root;
    for (const dir of parts.slice(0, -1)) {
      let next = at.dirs.get(dir);
      if (!next) at.dirs.set(dir, (next = { dirs: new Map(), files: [] }));
      at = next;
    }
    at.files.push(path);
  }
  const shown = new Map<string, string>();
  const walk = (dir: Dir, prefix: string) => {
    for (const file of dir.files)
      shown.set(file, prefix + file.split('/').at(-1)!);
    for (const [name, child] of dir.dirs) {
      const chain = [name];
      let at = child;
      while (at.files.length === 0 && at.dirs.size === 1) {
        const [next, nextDir] = [...at.dirs][0]!;
        chain.push(next);
        at = nextDir;
      }
      walk(at, `${prefix}${chainLabel(chain)}/`);
    }
  };
  walk(root, '');
  return shown;
}

/** The changed files of a range as a tree, each row carrying its +/- counts
    and change status; picking a row opens its diff. */
export default function DiffFileTree({
  files,
  selected,
  onSelect,
}: {
  files: DiffFile[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const { computedColorScheme } = useColorScheme();
  // A deep shared folder reads as one path above the tree; the tree draws
  // only what lies under it, each folder on its own row.
  const shared = useMemo(() => sharedFolder(files.map(f => f.path)), [files]);
  const shown = useMemo(
    () => compactPaths(files.map(f => f.path.slice(shared.length))),
    [files, shared]
  );
  const real = useMemo(
    () => new Map([...shown].map(([path, label]) => [label, shared + path])),
    [shown, shared]
  );
  const local = (path: string) =>
    shown.get(path.slice(shared.length)) ?? path.slice(shared.length);
  const counts = useMemo(
    () => new Map(files.map(file => [file.path, file])),
    [files]
  );
  const decorate: FileTreeRowDecorationRenderer = ({ item }) => {
    const file = counts.get(real.get(item.path) ?? '');
    if (!file) return null;
    const parts = [
      ...(file.added > 0
        ? [{ text: `+${file.added}`, color: 'var(--tk-text-ok)' }]
        : []),
      ...(file.removed > 0
        ? [{ text: ` −${file.removed}`, color: 'var(--tk-text-bad)' }]
        : []),
    ];
    return parts.length > 0
      ? { text: parts.map(p => p.text).join(''), parts }
      : null;
  };
  const { model } = useFileTree({
    paths: files.map(file => local(file.path)),
    flattenEmptyDirectories: false,
    initialExpansion: 'open',
    initialSelectedPaths: selected ? [local(selected)] : [],
    gitStatus: files.map(file => ({
      path: local(file.path),
      status: statusOf(file.patch),
    })),
    renderRowDecoration: decorate,
    onSelectionChange: paths => {
      const path = paths.at(-1);
      const picked = path ? real.get(path) : undefined;
      if (picked) onSelect(picked);
    },
    stickyFolders: true,
  });

  useEffect(() => {
    const at = selected ? shown.get(selected.slice(shared.length)) : null;
    if (at) model.scrollToPath(at, { focus: false });
  }, [model, selected, shared, shown]);

  return (
    <div className={classes.wrap}>
      {shared && (
        <div className={classes.shared} title={shared}>
          <Icon name="folder" size={13} />
          <span className={classes.sharedPath}>
            <bdi>{shared.slice(0, -1)}</bdi>
          </span>
        </div>
      )}
      <FileTree
        model={model}
        style={{
          ...TREE_STYLE,
          colorScheme: computedColorScheme,
          // Mantine ScrollArea's thumb, so this bar matches the sidebar's.
          ['--trees-scrollbar-thumb-override' as string]:
            computedColorScheme === 'dark'
              ? 'rgba(255, 255, 255, 0.4)'
              : 'rgba(0, 0, 0, 0.4)',
        }}
        data-testid="diff-file-tree"
      />
    </div>
  );
}
