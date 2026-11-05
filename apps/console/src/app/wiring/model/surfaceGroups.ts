import type { FocusGroups } from '../graph/model/focusModel';
import { suffixOf, type SkillsComposition } from '../outline';
import type { SkillsSurfaceRow } from '../useWiring';

export type SurfaceGroupId = 'commands' | 'reference' | 'stages' | 'fills';

export const SURFACE_GROUP_ORDER: SurfaceGroupId[] = [
  'commands',
  'reference',
  'stages',
  'fills',
];

export function isBuiltIn(group: SurfaceGroupId): boolean {
  return group === 'stages' || group === 'fills';
}

/**
 * Which group a pack skill lists under on the Surface tab, read from the
 * same focus groups the Graph sidebar draws so the two tabs agree. First
 * match wins: a base fill, a base reference skill, a pipeline's stages, the
 * pack's verbs, the standard skills a binding plugs in, then the rest. A
 * stage or team fill that is already public lists with what agents see, so
 * it can be turned off.
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
      row.fill
        ? 'fills'
        : row.base !== undefined
          ? 'reference'
          : stages.has(row.name)
            ? row.status === 'public'
              ? 'commands'
              : 'stages'
            : commands.has(row.name)
              ? 'commands'
              : fills.has(row.name) && !unwired.has(row.name)
                ? row.status === 'public'
                  ? 'reference'
                  : 'fills'
                : row.kind === 'compiled'
                  ? 'commands'
                  : 'reference'
    );
  }
  return out;
}
