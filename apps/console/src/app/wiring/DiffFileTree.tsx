import { useEffect, useMemo, type CSSProperties } from 'react';
import { useColorScheme } from '@mattstack/app-kit/hooks';
import type { FileTreeRowDecorationRenderer } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';

import type { DiffFile } from './CommitDiff';

/** The tree renders in a shadow root; console tokens reach it as inherited
    custom properties through its override slots. */
const TREE_STYLE = {
  height: '100%',
  // Tighter than the library's defaults, so deep folders keep their names.
  '--trees-padding-inline-override': '8px',
  '--trees-level-gap-override': '6px',
  '--trees-indent-guide-bg-override': 'var(--tk-border-soft)',
  '--trees-bg-override': 'var(--tk-card)',
  '--trees-bg-muted-override': 'var(--tk-raised)',
  '--trees-fg-override': 'var(--tk-text-1)',
  '--trees-fg-muted-override': 'var(--tk-text-3)',
  '--trees-accent-override': 'var(--tk-fill-accent)',
  '--trees-border-color-override': 'var(--tk-border-soft)',
  '--trees-focus-ring-color-override': 'var(--tk-fill-accent)',
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
  const counts = useMemo(
    () => new Map(files.map(file => [file.path, file])),
    [files]
  );
  const decorate: FileTreeRowDecorationRenderer = ({ item }) => {
    const file = counts.get(item.path);
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
    paths: files.map(file => file.path),
    flattenEmptyDirectories: true,
    initialExpansion: 'open',
    initialSelectedPaths: selected ? [selected] : [],
    gitStatus: files.map(file => ({
      path: file.path,
      status: statusOf(file.patch),
    })),
    renderRowDecoration: decorate,
    onSelectionChange: paths => {
      const path = paths.at(-1);
      if (path && counts.has(path)) onSelect(path);
    },
    stickyFolders: true,
  });

  useEffect(() => {
    if (selected) model.scrollToPath(selected, { focus: false });
  }, [model, selected]);

  return (
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
  );
}
