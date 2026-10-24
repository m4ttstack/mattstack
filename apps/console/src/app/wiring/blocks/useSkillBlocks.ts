import { useMemo } from 'react';

import type { BlocksPayload } from '../../../server/blocksPayload';
import type { FocusItem } from '../graph/model/focusModel';
import type { SkillsComposition } from '../outline';
import { useBlocks, useSkillSource } from '../useWiring';
import { headingTree } from './model/headingTree';

export type SkillBlocks =
  | { state: 'loading' }
  | {
      state: 'error';
      message: string;
      retry: () => void;
      retrying: boolean;
    }
  /** Not a block tree, and no file to read its headings from. */
  | { state: 'note'; message: string }
  | {
      state: 'ready';
      payload: BlocksPayload;
      /** Read from a hand-written file's headings. */
      readOnly: boolean;
      /** The file the Rendered view reads, whose lines `renderedLines`
          count. */
      renderedPath: string | null;
    };

/** The compiled file a skill renders to. */
function artifactOf(
  composition: SkillsComposition | undefined,
  skill: string
): string | null {
  const target = composition?.targets?.find(t => t.name === skill);
  if (target) return target.artifactPath;
  const verb = composition?.verbs.find(v => v.name === skill);
  if (!verb) return null;
  return verb.artifactPath.endsWith('.md')
    ? verb.artifactPath
    : `${verb.artifactPath}/SKILL.md`;
}

/** A board skill is the app's own installed SKILL.md, never a block tree of
    this pack. Every engine rt compiles is a block tree, so a board skill is
    the one kind read from its headings. */
function boardSkillFile(
  composition: SkillsComposition | undefined,
  item: FocusItem
): string | null {
  return (
    composition?.binders.find(
      binder => binder.ref === item.skill && binder.kind === 'external'
    )?.skillFile ?? null
  );
}

/**
 * The focused skill as a block tree: rt's own, or for a board skill, its
 * file's headings read as a read-only tree.
 */
export function useSkillBlocks(
  pack: string,
  item: FocusItem | null,
  composition: SkillsComposition | undefined
): SkillBlocks {
  const board = item?.icon === 'layoutDashboard';
  const blocksQuery = useBlocks(pack, item && !board ? item.skill : null);
  const notBlocks = board || blocksQuery.data === null;
  const sourcePath = item && board ? boardSkillFile(composition, item) : null;
  const sourceQuery = useSkillSource(pack, sourcePath);
  const content = sourceQuery.data?.content;
  const tree = useMemo(
    () =>
      item && content !== undefined && sourcePath
        ? headingTree(content, item.skill, sourcePath)
        : null,
    [item, content, sourcePath]
  );

  if (!item) return { state: 'loading' };
  if (!notBlocks) {
    if (blocksQuery.isError) {
      return {
        state: 'error',
        message: (blocksQuery.error as Error).message,
        retry: () => void blocksQuery.refetch(),
        retrying: blocksQuery.isFetching,
      };
    }
    if (!blocksQuery.data) return { state: 'loading' };
    return {
      state: 'ready',
      payload: blocksQuery.data,
      readOnly: false,
      renderedPath: artifactOf(composition, item.skill),
    };
  }
  if (!composition) return { state: 'loading' };
  if (!sourcePath) {
    return {
      state: 'note',
      message: `${item.label} is not built from blocks, and rt names no file of it to read its headings from.`,
    };
  }
  if (sourceQuery.isError) {
    return {
      state: 'error',
      message: (sourceQuery.error as Error).message,
      retry: () => void sourceQuery.refetch(),
      retrying: sourceQuery.isFetching,
    };
  }
  if (!tree) return { state: 'loading' };
  return {
    state: 'ready',
    payload: tree,
    readOnly: true,
    renderedPath: sourcePath,
  };
}
