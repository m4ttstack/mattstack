import {
  focusUnder,
  workTypeOf,
  type FocusGroups,
  type FocusItem,
} from '../../graph/model/focusModel';
import { stageCopyOf, type SkillsComposition } from '../../outline';

export type UsedByGroup =
  'PIPELINE STEPS' | 'STANDALONE' | 'BOARD' | 'NOT WIRED INTO ANYTHING';

export const USED_BY_GROUPS: readonly UsedByGroup[] = [
  'PIPELINE STEPS',
  'STANDALONE',
  'BOARD',
  'NOT WIRED INTO ANYTHING',
];

export type UsedBySite = {
  group: UsedByGroup;
  skill: string;
  /** The template line the skill pastes it at; null where rt names none. */
  line: number | null;
  /** The focus key that opens the skill; null for a skill the focus list
      does not show, which nothing can focus. */
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
  groups.standalone.forEach(place('STANDALONE'));
  groups.board.forEach(place('BOARD'));
  groups.unwired.items.forEach(place('NOT WIRED INTO ANYTHING'));
  return places;
}

type Site = { skill: string; line: number | null };

/** A roster verb's own `includes` names what it pastes; the compile targets
    add the stages and the line. A stage copy pastes what its engine pastes,
    so the engine's site stands for both. rt lists direct includes only, so a
    skill that pastes this one through another include is not named. */
function includeSites(composition: SkillsComposition, name: string): Site[] {
  const sites = new Map<string, Site>();
  for (const target of composition.targets ?? []) {
    if (target.engine !== undefined) continue;
    const at = target.placeholders.find(
      p => p.kind === 'include' && p.arg === name
    );
    if (at) sites.set(target.name, { skill: target.name, line: at.line });
  }
  for (const verb of composition.verbs) {
    if (verb.includes?.includes(name) && !sites.has(verb.name))
      sites.set(verb.name, { skill: verb.name, line: null });
  }
  return [...sites.values()];
}

function labelOf(site: Site, place: Place | undefined): string {
  if (!place) return site.skill;
  return place.group === 'BOARD' ? site.skill : `${site.skill}/SKILL.md`;
}

/**
 * Every skill in the pack that pastes the shared block `name` in, grouped
 * and ordered as the focus list shows them. A skill the focus list does not
 * show is wired into nothing, so it closes the list. A step `pipeline` runs
 * opens as that pipeline's step.
 */
export function usedBySites(
  composition: SkillsComposition,
  groups: FocusGroups,
  name: string,
  pipeline: FocusItem | null = null
): UsedBySite[] {
  const places = placesOf(groups);
  const workType = pipeline ? workTypeOf(pipeline.key) : null;
  return includeSites(composition, name)
    .map((site, order) => {
      const place = places.get(site.skill);
      return {
        site: {
          group: place?.group ?? 'NOT WIRED INTO ANYTHING',
          skill: site.skill,
          line: site.line,
          focus: place
            ? focusUnder(
                pipeline,
                stageCopyOf(composition.targets, site.skill, workType)?.name ??
                  site.skill,
                place.focus
              )
            : null,
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
