import {
  invertBindings,
  suffixOf,
  type SkillsComposition,
} from '../../outline';
import type { FocusGroups, FocusItem } from '../model/focusModel';

export type UsedByGroup =
  'PIPELINE STEPS' | 'ON-DEMAND' | 'BOARD' | 'NOT WIRED INTO ANYTHING';

export const USED_BY_GROUPS: readonly UsedByGroup[] = [
  'PIPELINE STEPS',
  'ON-DEMAND',
  'BOARD',
  'NOT WIRED INTO ANYTHING',
];

/** A partial by its include name, or a fill by its binding. */
export type UsedByRef = { kind: 'include' | 'fill'; name: string };

export type UsedBySite = {
  group: UsedByGroup;
  skill: string;
  /** The template line the skill pastes it at; null where rt names none: a
      board skill, whose template is not in this pack, or an rt that predates
      `targets`. */
  line: number | null;
  /** The focus key that puts the skill on the canvas. */
  focus: string;
};

type Place = { group: UsedByGroup; focus: string; rank: number };

/** Where the focus list puts each skill, in its order. A skill several
    pipelines run takes the first. */
function placesOf(groups: FocusGroups): Map<string, Place> {
  const places = new Map<string, Place>();
  const place = (group: UsedByGroup) => (item: FocusItem) => {
    if (!places.has(item.skill))
      places.set(item.skill, { group, focus: item.key, rank: places.size });
  };
  for (const pipeline of groups.pipelines) {
    place('PIPELINE STEPS')(pipeline);
    pipeline.children.forEach(place('PIPELINE STEPS'));
  }
  groups.onDemand.forEach(place('ON-DEMAND'));
  groups.board.forEach(place('BOARD'));
  groups.unwired.items.forEach(place('NOT WIRED INTO ANYTHING'));
  return places;
}

type Site = { skill: string; line: number | null };

function includeSites(composition: SkillsComposition, name: string): Site[] {
  if (!composition.targets)
    return composition.verbs
      .filter(verb => verb.includes?.includes(name))
      .map(verb => ({ skill: verb.name, line: null }));
  return composition.targets.flatMap(target => {
    const at = target.placeholders.find(
      p => p.kind === 'include' && p.arg === name
    );
    return at ? [{ skill: target.name, line: at.line }] : [];
  });
}

function fillSites(composition: SkillsComposition, binding: string): Site[] {
  const lineOf = (skill: string, slot: string) =>
    composition.targets
      ?.find(target => target.name === skill)
      ?.placeholders.find(p => p.kind === 'slot' && p.arg === slot)?.line ??
    null;
  return (invertBindings(composition)[binding] ?? []).map(site => {
    if (site.kind === 'external') return { skill: site.ref, line: null };
    const skill = site.verb ?? suffixOf(site.ref);
    return { skill, line: lineOf(skill, site.slot) };
  });
}

/**
 * Every skill in the pack that pastes a partial in or binds a fill, grouped
 * and ordered as the focus list shows them. A skill the focus list does not
 * show is wired into nothing, so it closes the list.
 */
export function usedBySites(
  composition: SkillsComposition,
  groups: FocusGroups,
  ref: UsedByRef
): UsedBySite[] {
  const places = placesOf(groups);
  const sites =
    ref.kind === 'include'
      ? includeSites(composition, ref.name)
      : fillSites(composition, ref.name);
  return sites
    .map((site, order) => {
      const place = places.get(site.skill);
      return {
        site: {
          group: place?.group ?? 'NOT WIRED INTO ANYTHING',
          skill: site.skill,
          line: site.line,
          focus: place?.focus ?? site.skill,
        } satisfies UsedBySite,
        rank: place?.rank ?? places.size + order,
      };
    })
    .sort(
      (a, b) =>
        USED_BY_GROUPS.indexOf(a.site.group) -
          USED_BY_GROUPS.indexOf(b.site.group) || a.rank - b.rank
    )
    .map(({ site }) => site);
}
