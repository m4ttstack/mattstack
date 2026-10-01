import {
  buildSpine,
  needsAttention,
  ORCHESTRATOR_VERB,
  suffixOf,
  type OutlineCheck,
  type PipelineState,
  type SkillsCheck,
  type SkillsComposition,
  type SpineEntry,
} from '../../outline';

export type FocusIcon =
  'workflow' | 'squareTerminal' | 'lock' | 'layoutDashboard';

export type FocusItem = {
  key: string;
  label: string;
  skill: string;
  icon: FocusIcon;
  step: number | null;
  attention: boolean;
  children: FocusItem[];
};

export type FocusGroups = {
  pipelines: FocusItem[];
  onDemand: FocusItem[];
  board: FocusItem[];
  /** `count` is the unwired verbs plus the fills nothing binds; `items` holds
      only the verbs, since a fill has no template to focus. */
  unwired: { count: number; attention: boolean; items: FocusItem[] };
  /** `rt-without-pipelines` is an rt whose composition predates the field;
      `no-pipeline` is a pack whose manifest declares none. */
  empty: 'no-pipeline' | 'rt-without-pipelines' | null;
};

const STAGE_PREFIX = 'stage-';
const PIPELINE_PREFIX = 'pipeline:';
const NO_CHECK: OutlineCheck = { verbs: [] };
const EMPTY_BY_STATE: Record<PipelineState, FocusGroups['empty']> = {
  ok: null,
  empty: 'no-pipeline',
  absent: 'rt-without-pipelines',
};

/** A step's name without the `stage-` every stage file carries. */
export function stepLabel(skill: string): string {
  return skill.startsWith(STAGE_PREFIX)
    ? skill.slice(STAGE_PREFIX.length)
    : skill;
}

export function buildFocusGroups(
  composition: SkillsComposition,
  check: SkillsCheck | undefined
): FocusGroups {
  const outlineCheck = check ?? NO_CHECK;
  const statusByName = new Map(
    outlineCheck.verbs.map(row => [row.name, row.status] as const)
  );
  // A stage has no roster verb, so the spine never attaches its check row;
  // its drift is read here by the stage's own name.
  const attentionOf = (entry: SpineEntry, skill: string) => {
    const status = statusByName.get(skill);
    return (
      needsAttention(entry) || status === 'stale' || status === 'never-compiled'
    );
  };
  const skillOf = (entry: SpineEntry) =>
    entry.verb ?? suffixOf(entry.ref ?? entry.key);
  const itemFor = (entry: SpineEntry): FocusItem => {
    const skill = skillOf(entry);
    return {
      key: skill,
      label: skill,
      skill,
      icon: entry.invocable ? 'squareTerminal' : 'lock',
      step: null,
      attention: attentionOf(entry, skill),
      children: [],
    };
  };

  const first = buildSpine(composition, outlineCheck);
  const stageRefs = new Set(
    first.workTypes.flatMap(type => composition.pipelines?.[type] ?? [])
  );

  const pipelines = first.workTypes.map(workType => {
    const spine =
      workType === first.workType
        ? first
        : buildSpine(composition, outlineCheck, workType);
    const children = spine.stages.map(stage => ({
      ...itemFor(stage),
      label: stepLabel(skillOf(stage)),
      step: stage.step,
    }));
    const lead = spine.orchestrator;
    const skill = lead ? skillOf(lead) : ORCHESTRATOR_VERB;
    return {
      key: `${PIPELINE_PREFIX}${workType}`,
      label: `${lead?.label ?? skill} · ${workType}`,
      skill,
      icon: 'workflow',
      step: null,
      attention:
        (lead !== null && attentionOf(lead, skill)) ||
        children.some(child => child.attention),
      children,
    } satisfies FocusItem;
  });

  const onDemand = first.outside
    .filter(
      entry =>
        !entry.external &&
        !entry.unwired &&
        !(entry.ref !== null && stageRefs.has(entry.ref))
    )
    .map(itemFor);
  if (pipelines.length === 0 && first.orchestrator)
    onDemand.unshift(itemFor(first.orchestrator));

  const board = [
    ...new Set(
      composition.binders
        .filter(binder => binder.kind === 'external')
        .map(binder => binder.ref)
    ),
  ].map((ref): FocusItem => ({
    key: ref,
    label: ref,
    skill: ref,
    icon: 'layoutDashboard',
    step: null,
    attention: false,
    children: [],
  }));

  const unwiredItems = first.outside
    .filter(entry => entry.unwired)
    .map(itemFor);

  return {
    pipelines,
    onDemand,
    board,
    unwired: {
      count: unwiredItems.length + first.orphans.length,
      attention: unwiredItems.some(item => item.attention),
      items: unwiredItems,
    },
    empty: EMPTY_BY_STATE[first.pipelineState],
  };
}

const flagged = (items: FocusItem[]) => items.filter(item => item.attention);

export function onlyAttention(groups: FocusGroups): FocusGroups {
  return {
    ...groups,
    pipelines: flagged(groups.pipelines).map(pipeline => ({
      ...pipeline,
      children: flagged(pipeline.children),
    })),
    onDemand: flagged(groups.onDemand),
    board: flagged(groups.board),
    unwired: groups.unwired.attention
      ? { ...groups.unwired, items: flagged(groups.unwired.items) }
      : { count: 0, attention: false, items: [] },
  };
}

/** By key first; failing that, by skill, so a bare `work` (Health's open-skill
    link) lands on the pipeline its orchestrator leads. */
export function findFocus(groups: FocusGroups, key: string): FocusItem | null {
  const all = [
    ...groups.pipelines.flatMap(pipeline => [pipeline, ...pipeline.children]),
    ...groups.onDemand,
    ...groups.board,
    ...groups.unwired.items,
  ];
  return (
    all.find(item => item.key === key) ??
    all.find(item => item.skill === key) ??
    null
  );
}

/** What the canvas shows when the URL names no focus: the first pipeline,
    else the first skill listed. */
export function firstFocus(groups: FocusGroups): FocusItem | null {
  return (
    groups.pipelines[0] ??
    groups.onDemand[0] ??
    groups.board[0] ??
    groups.unwired.items[0] ??
    null
  );
}

/** The pipeline an item is, or runs as a step of; null for anything else. */
export function pipelineOf(
  groups: FocusGroups,
  item: FocusItem
): FocusItem | null {
  return (
    groups.pipelines.find(
      pipeline =>
        pipeline.key === item.key ||
        pipeline.children.some(child => child.key === item.key)
    ) ?? null
  );
}

/** `feature` for `pipeline:feature`; null for any other key. */
export function workTypeOf(key: string): string | null {
  return key.startsWith(PIPELINE_PREFIX)
    ? key.slice(PIPELINE_PREFIX.length)
    : null;
}
