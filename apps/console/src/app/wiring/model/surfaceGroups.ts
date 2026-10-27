import type { FocusGroups } from '../graph/model/focusModel';
import { suffixOf, type SkillsComposition } from '../outline';
import type { SkillsSurfaceRow } from '../useWiring';

export type SurfaceGroupId =
  'commands' | 'stages' | 'fills' | 'unwired' | 'base';

export const SURFACE_GROUP_ORDER: SurfaceGroupId[] = [
  'commands',
  'stages',
  'fills',
  'unwired',
  'base',
];

/**
 * Which group a pack skill lists under on the Surface tab, read from the
 * same focus groups the Graph sidebar draws so the two tabs agree. First
 * match wins: the parent pack's copies, a pipeline's stages, the pack's
 * verbs, the standard skills a binding plugs in, then whatever nothing uses.
 */
export function surfaceGroupsOf(
  rows: readonly SkillsSurfaceRow[],
  groups: FocusGroups | null,
  composition: Pick<SkillsComposition, 'fills'> | undefined
): Map<string, SurfaceGroupId> {
  const stages = new Set(
    groups?.pipelines.flatMap(pipeline =>
      pipeline.children.map(stage => stage.skill)
    ) ?? []
  );
  const commands = new Set([
    ...(groups?.pipelines.map(pipeline => pipeline.skill) ?? []),
    ...(groups?.standalone.map(item => item.skill) ?? []),
  ]);
  const unwired = new Set(groups?.unwired.items.map(item => item.skill) ?? []);
  const fills = new Set(
    (composition?.fills ?? []).map(fill => suffixOf(fill.binding))
  );

  const out = new Map<string, SurfaceGroupId>();
  for (const row of rows) {
    out.set(
      row.name,
      row.base !== undefined
        ? 'base'
        : stages.has(row.name)
          ? 'stages'
          : commands.has(row.name)
            ? 'commands'
            : fills.has(row.name) && !unwired.has(row.name)
              ? 'fills'
              : row.kind === 'compiled'
                ? 'commands'
                : 'unwired'
    );
  }
  return out;
}
