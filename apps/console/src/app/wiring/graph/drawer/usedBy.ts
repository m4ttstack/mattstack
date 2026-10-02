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
  /** The slot a fill is bound at; null for a partial. */
  slot: string | null;
  /** The template line the skill pastes it at; null where rt names none: a
      board skill, whose template is not in this pack, or an rt that predates
      `targets`. */
  line: number | null;
  /** The focus key that puts the skill on the canvas; null for a skill the
      focus list does not show, which nothing can focus. */
  focus: string | null;
  label: string;
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

/** `ref` is the manifest ref a binding site names; a target has none. */
type Site = {
  skill: string;
  slot: string | null;
  line: number | null;
  ref: string | null;
};

function includeSites(composition: SkillsComposition, name: string): Site[] {
  if (!composition.targets)
    return composition.verbs
      .filter(verb => verb.includes?.includes(name))
      .map(verb => ({ skill: verb.name, slot: null, line: null, ref: null }));
  return composition.targets.flatMap(target => {
    const at = target.placeholders.find(
      p => p.kind === 'include' && p.arg === name
    );
    return at
      ? [{ skill: target.name, slot: null, line: at.line, ref: null }]
      : [];
  });
}

function fillSites(composition: SkillsComposition, binding: string): Site[] {
  const lineOf = (skill: string, slot: string) =>
    composition.targets
      ?.find(target => target.name === skill)
      ?.placeholders.find(p => p.kind === 'slot' && p.arg === slot)?.line ??
    null;
  return (invertBindings(composition)[binding] ?? []).map(site => {
    const external = site.kind === 'external';
    const skill = external ? site.ref : (site.verb ?? suffixOf(site.ref));
    return {
      skill,
      slot: site.slot,
      line: external ? null : lineOf(skill, site.slot),
      ref: site.ref,
    };
  });
}

/** A board skill by its ref, any other placed skill by its file; a skill the
    focus list does not show by the ref its binding names, else its name. */
function labelOf(site: Site, place: Place | undefined): string {
  if (!place) return site.ref ?? site.skill;
  return place.group === 'BOARD' ? site.skill : `${site.skill}/SKILL.md`;
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
          slot: site.slot,
          line: site.line,
          focus: place?.focus ?? null,
          label: labelOf(site, place),
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
