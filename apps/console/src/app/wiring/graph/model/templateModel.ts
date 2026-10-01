import { layerLabel } from '../../layerLabel';
import {
  invertBindings,
  ORCHESTRATOR_VERB,
  pluginOf,
  suffixOf,
  type SkillsCheck,
  type SkillsComposition,
} from '../../outline';
import type { SkillsAnatomy, SkillsChanges } from '../../useWiring';
import { stepLabel } from './focusModel';

export type RowState =
  | 'ok'
  | 'optional-unbound'
  | 'required-unbound'
  | 'no-matching-fill'
  | 'resolve-error'
  | 'referenced'
  | 'unsynced';

export type PlaceholderKind = 'include' | 'slot' | 'verb.path' | 'variable';
export type LineRange = [number, number];

/**
 * `line` is what a `row:<line>` select names: the first template line, or
 * the first rendered line for an engine with no template trace (whose
 * template ranges are null).
 */
export type TemplateRow =
  | {
      id: string;
      line: number;
      kind: 'text';
      gutter: string;
      label: string;
      templateLines: LineRange | null;
      renderedLines: LineRange | null;
    }
  | {
      id: string;
      line: number;
      kind: 'placeholder';
      placeholder: PlaceholderKind;
      gutter: string;
      code: string;
      templateLine: number | null;
      renderedLines: LineRange | null;
      state: RowState;
      name: string | null;
      /** A slot's contract; null for every other placeholder. */
      contract: string | null;
    };

export type InputCard = {
  id: string;
  rowId: string;
  title: string;
  subtitle: string;
  icon: 'fileText' | 'cpu';
  path: string | null;
  subtitleTone: 'dimmed' | 'accent';
  state: RowState;
  /** Skills in this pack that paste this partial in, or bind this fill. */
  usedBy: number;
};

/** `unknown` is check having no row for the skill: rt said nothing, which is
    not the same as in sync. */
export type SkillStatus = 'in-sync' | 'stale' | 'never-compiled' | 'unknown';

export type LinkCard = {
  id: string;
  rowId: string;
  skill: string;
  title: string;
  subtitle: string;
  status: SkillStatus;
};

export type OutputPart = {
  id: string;
  label: string;
  lines: number;
  share: number;
  own: boolean;
};

export type OutputLink = {
  label: string;
  path: string;
  /** The compile target the link resolves to, when it is one. */
  skill: string | null;
};

export type OutputCard = {
  step: number | null;
  title: string;
  lines: number;
  status: SkillStatus | 'unsynced';
  /** Why check calls it stale, in words; null unless stale. */
  reason: string | null;
  parts: OutputPart[];
  links: OutputLink[];
};

export type TextNoun = 'orchestrator' | 'step' | 'verb';

export type TemplateView = {
  skill: string;
  templateFile: string;
  templateMeta: string;
  rows: TemplateRow[];
  inputs: InputCard[];
  links: LinkCard[];
  output: OutputCard | null;
  textNoun: TextNoun;
};

type AnatomyPart = SkillsAnatomy['parts'][number];
type DriftCause = SkillsAnatomy['staleBecause'][number];
type CheckRow = SkillsCheck['verbs'][number];

type SlotFacts = {
  contract: string | null;
  required: boolean | null;
  boundTo: string | null;
  resolveError: string | null;
  layer: string | null;
};

const OWN_TEXT_ID = 'text';

const STALE_REASONS: [DriftCause, string][] = [
  ['source', 'its template changed'],
  ['include', 'a pasted file changed'],
  ['fill', 'its pack text changed'],
  ['frontmatter', 'its header changed'],
  ['structure', 'its files changed'],
  ['vendored', 'its files changed'],
];

/** The first cause in the order a reader would fix them; null for an rt that
    names none. */
function staleReason(causes: readonly DriftCause[] | undefined): string | null {
  return STALE_REASONS.find(([cause]) => causes?.includes(cause))?.[1] ?? null;
}

export const spanOf = ([from, to]: LineRange) => to - from + 1;

export function gutterOf([from, to]: LineRange): string {
  return from === to ? `L${from}` : `L${from}-${to}`;
}

/** `gates/SKILL.md` for any path to it: the file and the folder that names it. */
export function fileLabelOf(path: string): string {
  return path.split('/').filter(Boolean).slice(-2).join('/');
}

export function countOf(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `dir/../x` resolved the way a reader of the rendered file would follow it. */
export function resolveFrom(file: string, relative: string): string {
  const segments = file.split('/').slice(0, -1);
  for (const segment of relative.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment !== '.' && segment !== '') segments.push(segment);
  }
  return segments.join('/');
}

export function partKey(part: AnatomyPart): string {
  return `${part.kind}:${part.name ?? ''}`;
}

/**
 * Lines a pasted part occupies in the rendered file: its placed range when rt
 * located it, else the size of its source. rt gives every placeholder on one
 * template line that line's whole rendered range, so a range shared with
 * another part says nothing about this part's size and its source decides.
 */
export function pastedLines(
  part: AnatomyPart,
  parts: readonly AnatomyPart[]
): number {
  const range = part.renderedLines;
  if (!range) return part.source?.lines ?? 0;
  const sharing = parts.filter(
    other =>
      other.kind !== 'text' &&
      other.renderedLines?.[0] === range[0] &&
      other.renderedLines[1] === range[1]
  ).length;
  return sharing > 1 ? (part.source?.lines ?? 0) : spanOf(range);
}

/** What an output part is called: an include by its name, a slot by the fill
    that fills it. */
export function partLabel(part: AnatomyPart): string {
  if (part.kind === 'slot' && part.source) return suffixOf(part.source.ref);
  return part.name ?? part.kind;
}

export function shareOf(lines: number, total: number): number {
  return total > 0 ? Math.round((lines / total) * 100) : 0;
}

function textLabel(lines: number, noun: TextNoun): string {
  if (lines > 3) return `${lines} lines of ${noun} text`;
  return countOf(lines, 'line', 'lines');
}

function codeOf(part: AnatomyPart): string {
  return part.kind === 'variable'
    ? `{{${part.name}}}`
    : `{{${part.kind}:${part.name}}}`;
}

function variableTitle(name: string): string {
  if (name === 'stage.fields') return 'run fields';
  if (name.startsWith('run-start.flags')) return 'run flags';
  return name;
}

function slotFactsFor(
  anatomy: SkillsAnatomy,
  composition: SkillsComposition
): Map<string, SlotFacts> {
  const facts = new Map<string, SlotFacts>();
  const provides = new Map(
    composition.fills.map(fill => [fill.binding, fill.provides] as const)
  );
  const verb = composition.verbs.find(v => v.name === anatomy.skill);
  for (const slot of verb?.slots ?? []) {
    facts.set(slot.name, {
      contract: slot.contract,
      required: slot.required,
      boundTo: slot.boundTo,
      resolveError: slot.resolveError ?? null,
      layer: slot.layer ?? null,
    });
  }
  const binder = composition.binders.find(b => b.ref === anatomy.template.ref);
  for (const slot of binder?.slots ?? []) {
    if (facts.has(slot.name)) continue;
    facts.set(slot.name, {
      contract: provides.get(slot.boundTo) ?? null,
      required: null,
      boundTo: slot.boundTo,
      resolveError: null,
      layer: null,
    });
  }
  return facts;
}

function slotState(
  part: AnatomyPart,
  facts: SlotFacts | undefined,
  pending: boolean
): RowState {
  if (facts?.resolveError) return 'resolve-error';
  const boundTo = facts?.boundTo ?? null;
  if (!part.source && !boundTo)
    return facts?.required ? 'required-unbound' : 'optional-unbound';
  if (!part.source) return 'no-matching-fill';
  if (pending) return 'unsynced';
  if (part.mode === 'reference') return 'referenced';
  return 'ok';
}

function usageCounts(composition: SkillsComposition) {
  const sites = invertBindings(composition);
  const includeUses = (name: string) =>
    composition.targets
      ? composition.targets.filter(target =>
          target.placeholders.some(p => p.kind === 'include' && p.arg === name)
        ).length
      : composition.verbs.filter(v => v.includes?.includes(name)).length;
  const fillUses = (ref: string) => sites[ref]?.length ?? 0;
  return { includeUses, fillUses };
}

function textNounOf(anatomy: SkillsAnatomy): TextNoun {
  if (anatomy.kind === 'stage') return 'step';
  if (
    anatomy.skill === ORCHESTRATOR_VERB ||
    anatomy.parts.some(part => part.kind === 'verb.path')
  )
    return 'orchestrator';
  return 'verb';
}

export function buildTemplateView(input: {
  anatomy: SkillsAnatomy;
  composition: SkillsComposition;
  check: SkillsCheck | undefined;
  changes: SkillsChanges | undefined;
  step: number | null;
  /** The focused pipeline; absent or unknown reads the pack's first. */
  workType?: string | null;
}): TemplateView {
  const { anatomy, composition, check, changes, step } = input;
  const stepOf = stepNumbers(composition, input.workType ?? null);
  const pack = anatomy.pack;
  const textNoun = textNounOf(anatomy);
  const slotFacts = slotFactsFor(anatomy, composition);
  const { includeUses, fillUses } = usageCounts(composition);
  const checkRows = new Map<string, CheckRow>(
    (check?.verbs ?? []).map(row => [row.name, row] as const)
  );
  const pendingSlots = new Set(
    (changes?.bindings ?? [])
      .filter(change => change.engineRef === anatomy.template.ref)
      .map(change => change.slot)
  );

  const rows: TemplateRow[] = [];
  const inputs: InputCard[] = [];
  const links: LinkCard[] = [];
  const rowsAtLine = new Map<number, number>();
  const cardIds = new Set<string>();

  for (const part of anatomy.parts) {
    const anchor = part.templateLines ?? part.renderedLines;
    if (!anchor) continue;
    const line = anchor[0];
    const nth = (rowsAtLine.get(line) ?? 0) + 1;
    rowsAtLine.set(line, nth);
    const id = nth === 1 ? String(line) : `${line}.${nth}`;
    const gutter = part.templateLines
      ? gutterOf(part.templateLines)
      : `rendered ${gutterOf(anchor)}`;

    if (part.kind === 'text') {
      rows.push({
        id,
        line,
        kind: 'text',
        gutter,
        label: textLabel(spanOf(anchor), textNoun),
        templateLines: part.templateLines,
        renderedLines: part.renderedLines,
      });
      continue;
    }

    const facts =
      part.kind === 'slot' ? slotFacts.get(part.name ?? '') : undefined;
    const state =
      part.kind === 'slot'
        ? slotState(part, facts, pendingSlots.has(part.name ?? ''))
        : 'ok';
    rows.push({
      id,
      line,
      kind: 'placeholder',
      placeholder: part.kind,
      gutter,
      code: codeOf(part),
      templateLine: part.templateLines?.[0] ?? null,
      renderedLines: part.renderedLines,
      state,
      name: part.name,
      contract: facts?.contract ?? null,
    });

    if (part.kind === 'verb.path') {
      const skill = part.target?.skill ?? part.name ?? '';
      links.push(
        linkCard(part, skill, id, stepOf(skill), checkRows.get(skill))
      );
      continue;
    }
    if (state === 'optional-unbound') continue;

    const key = partKey(part);
    const cardId = cardIds.has(key) ? `${key}@${line}` : key;
    cardIds.add(cardId);
    inputs.push({
      id: cardId,
      rowId: id,
      ...cardFace(part, state, facts, pack),
      state,
      usedBy:
        part.kind === 'include'
          ? includeUses(part.name ?? '')
          : part.kind === 'slot' && facts?.boundTo
            ? fillUses(facts.boundTo)
            : 0,
    });
  }

  const pendingSkill =
    pendingSlots.size > 0 ||
    (changes?.surface ?? []).some(change => change.skill === anatomy.skill);

  return {
    skill: anatomy.skill,
    templateFile: fileLabelOf(anatomy.template.path),
    templateMeta: templateMeta(anatomy, links.length > 0),
    rows,
    inputs,
    links,
    output:
      links.length > 0
        ? null
        : outputCard(
            anatomy,
            composition,
            checkRows.get(anatomy.skill),
            pendingSkill,
            step,
            textNoun
          ),
    textNoun,
  };
}

function cardFace(
  part: AnatomyPart,
  state: RowState,
  facts: SlotFacts | undefined,
  pack: string
): Pick<InputCard, 'title' | 'subtitle' | 'icon' | 'path' | 'subtitleTone'> {
  if (part.kind === 'variable') {
    return {
      title: variableTitle(part.name ?? ''),
      subtitle: 'variable · rt fills this in for each run',
      icon: 'cpu',
      path: null,
      subtitleTone: 'dimmed',
    };
  }
  const file = {
    icon: 'fileText' as const,
    path: part.source?.path ?? null,
    subtitleTone: 'dimmed' as const,
  };
  const sourceTitle = part.source
    ? fileLabelOf(part.source.path)
    : `${part.name}/SKILL.md`;

  if (part.kind === 'include') {
    return {
      ...file,
      title: sourceTitle,
      subtitle: part.source
        ? `partial · ${pluginOf(part.source.ref)} · ${part.source.lines} lines`
        : 'partial',
    };
  }

  const slotTitle = `${part.name} slot`;
  switch (state) {
    case 'required-unbound':
      return { ...file, title: slotTitle, subtitle: 'required, nothing bound' };
    case 'resolve-error':
      return { ...file, title: slotTitle, subtitle: facts?.resolveError ?? '' };
    case 'no-matching-fill':
      return {
        ...file,
        title: `${suffixOf(facts?.boundTo ?? '')}/SKILL.md`,
        subtitle: `no fill named ${facts?.boundTo} in this pack`,
      };
    case 'referenced':
      return {
        ...file,
        title: sourceTitle,
        subtitle: 'referenced: the rendered text links to it',
      };
  }
  const source = part.source!;
  const plugin = pluginOf(source.ref);
  return plugin === pack
    ? {
        ...file,
        title: sourceTitle,
        subtitle: `written by ${pack} · ${source.lines} lines`,
        subtitleTone: 'accent',
      }
    : {
        ...file,
        title: sourceTitle,
        subtitle: `${plugin} default${pickedBy(facts?.layer ?? null)}`,
      };
}

/** Who chose a default fill, for the layers rt names a chooser for. */
function pickedBy(layer: string | null): string {
  if (layer === 'pack' || layer === 'override' || layer?.startsWith('base:'))
    return ` · picked by ${layerLabel(layer)}`;
  return '';
}

/** A stage's 1-based place in the pipeline, null for a skill it does not run. */
function stepNumbers(composition: SkillsComposition, workType: string | null) {
  const pipelines = composition.pipelines ?? {};
  const order =
    (workType !== null ? pipelines[workType] : undefined) ??
    Object.values(pipelines)[0] ??
    [];
  return (skill: string): number | null => {
    const at = order.findIndex(ref => suffixOf(ref) === skill);
    return at === -1 ? null : at + 1;
  };
}

const LINK_STATUS_WORDS: Record<SkillStatus, string | null> = {
  'in-sync': 'rendered',
  stale: 'stale',
  'never-compiled': 'never compiled',
  unknown: null,
};

function linkCard(
  part: AnatomyPart,
  skill: string,
  rowId: string,
  step: number | null,
  row: CheckRow | undefined
): LinkCard {
  const lines = part.target?.lines ?? null;
  const status: SkillStatus =
    row?.status ?? (lines === null ? 'never-compiled' : 'unknown');
  const reason = status === 'stale' ? staleReason(row?.staleBecause) : null;
  const subtitle = [
    step === null ? null : `step ${step}`,
    reason ? `stale: ${reason}` : LINK_STATUS_WORDS[status],
    lines === null || status === 'never-compiled' ? null : `${lines} lines`,
  ]
    .filter(phrase => phrase !== null)
    .join(' · ');
  return {
    id: `link:${skill}`,
    rowId,
    skill,
    title: part.target ? fileLabelOf(part.target.path) : `${skill}/SKILL.md`,
    subtitle,
    status,
  };
}

function templateMeta(anatomy: SkillsAnatomy, links: boolean): string {
  const { template, rendered } = anatomy;
  if (links && rendered.exists)
    return `${template.lines} lines → renders ${rendered.lines}`;
  if (!rendered.exists || template.builtVersion === null)
    return `${template.lines} lines · never compiled`;
  return `${template.lines} lines · ${pluginOf(template.ref)} ${template.builtVersion}`;
}

function outputCard(
  anatomy: SkillsAnatomy,
  composition: SkillsComposition,
  row: CheckRow | undefined,
  pending: boolean,
  step: number | null,
  textNoun: TextNoun
): OutputCard {
  const { rendered } = anatomy;
  const status: OutputCard['status'] = pending
    ? 'unsynced'
    : (row?.status ??
      (anatomy.status === 'never-compiled' || !rendered.exists
        ? 'never-compiled'
        : 'unknown'));
  const built = rendered.exists && rendered.lines > 0;

  return {
    step,
    title: stepLabel(anatomy.skill),
    lines: rendered.lines,
    status,
    reason: status === 'stale' ? staleReason(row?.staleBecause) : null,
    parts: built ? outputParts(anatomy, textNoun) : [],
    links: built ? outputLinks(anatomy, composition) : [],
  };
}

function outputParts(anatomy: SkillsAnatomy, textNoun: TextNoun): OutputPart[] {
  const total = anatomy.rendered.lines;
  const pasted = anatomy.parts
    .filter(
      part =>
        (part.kind === 'include' || part.kind === 'slot') &&
        part.mode !== 'reference' &&
        pastedLines(part, anatomy.parts) > 0
    )
    .map(part => {
      const lines = pastedLines(part, anatomy.parts);
      return {
        id: partKey(part),
        label: partLabel(part),
        lines,
        share: shareOf(lines, total),
        own: false,
      };
    });
  const placedText = anatomy.parts.filter(
    part => part.kind === 'text' && part.renderedLines
  );
  // A stale skill places no text on disk, so its own text is what the pasted
  // parts leave over.
  const ownLines =
    placedText.length > 0
      ? placedText.reduce((sum, part) => sum + spanOf(part.renderedLines!), 0)
      : Math.max(0, total - pasted.reduce((sum, part) => sum + part.lines, 0));
  return [
    {
      id: OWN_TEXT_ID,
      label: `${textNoun} text`,
      lines: ownLines,
      share: shareOf(ownLines, total),
      own: true,
    },
    ...pasted,
  ];
}

function outputLinks(
  anatomy: SkillsAnatomy,
  composition: SkillsComposition
): OutputLink[] {
  const targetByPath = new Map(
    (composition.targets ?? []).map(t => [t.artifactPath, t.name] as const)
  );
  return anatomy.links.map(link => ({
    label: fileLabelOf(link.path),
    path: link.path,
    skill:
      targetByPath.get(resolveFrom(anatomy.rendered.path, link.path)) ?? null,
  }));
}
