import { kindOf } from '../graph/FocusHeader';
import type { FocusItem } from '../graph/model/focusModel';

/** The block view names a public verb by how it runs, as its boards do: on
    demand, not as a step of a pipeline. */
export function skillKindOf(
  item: FocusItem,
  pipeline: FocusItem | null
): string {
  const kind = kindOf(item, pipeline);
  return kind === 'public verb' ? 'on-demand' : kind;
}

const blocks = (n: number) => `${n} ${n === 1 ? 'block' : 'blocks'}`;

/** The switcher's one meta line, short enough for the sidebar: a stage by
    its place in its pipeline, which the header names in full. */
export function switcherMetaOf(
  item: FocusItem,
  pipeline: FocusItem | null,
  count: number | null
): string {
  const kind =
    pipeline && item.step !== null
      ? `stage ${item.step} of ${pipeline.children.length}`
      : skillKindOf(item, pipeline);
  return count === null ? kind : `${kind} · ${blocks(count)}`;
}
