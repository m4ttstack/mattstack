import { layerLabel } from '../../layerLabel';
import {
  blockOf,
  engineRefOf,
  invertBindings,
  leadsAPipeline,
  ORCHESTRATOR_VERB,
  overrideOf,
  pluginOf,
  propKey,
  splitPropKey,
  suffixOf,
  type SkillsCheck,
  type SkillsComposition,
} from '../../outline';
import { ownerOf, type Owner } from '../../owner';
import type { SkillsAnatomy, SkillsChanges } from '../../useWiring';
import { copyLabelOf, copyLinkLabelOf, stepLabel } from './focusModel';

export type RowState =
  | 'ok'
  | 'optional-unbound'
  | 'required-unbound'
  | 'no-matching-fill'
  | 'resolve-error'
  | 'referenced'
  | 'unsynced';

export type PlaceholderKind = 'include' | 'prop' | 'verb.path' | 'variable';
export type LineRange = [number, number];

/**
 * A `row:<id>` select names a row by its `id`. `line` is the first template
 * line, or the first rendered line for an engine with no template trace, so
 * rows can share a line in two different line spaces; `id` stays unique, and
 * is the bare line for the first row at that line, which keeps an older
 * `row:<line>` link resolving.
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
      /** A prop's contract; null for every other placeholder. */
      contract: string | null;
      /** What a prop is filled from, by name; null when nothing fills it. */
      fill: string | null;
      /** The binding a prop names, found or not; null when nothing is bound. */
      boundTo: string | null;
      /** rt's message for a prop it could not resolve. */
      resolveError: string | null;
      /** Which layer chose the binding: `pack`, `override` or `base:<name>`. */
      layer: string | null;
    };

export type InputCard = {
  id: string;
  rowId: string;
  title: string;
  subtitle: string;
  /** `fileX` for a prop rt could not load a fill file for. */
  icon: 'fileText' | 'cpu' | 'fileX';
  path: string | null;
  subtitleTone: 'dimmed' | 'accent' | 'warn' | 'bad';
  state: RowState;
  /** Skills in this pack that paste this partial in, or bind this fill. */
  usedBy: number;
  /** Who owns the fill, set only for a skill another app owns, whose card has
      no anatomy part to read it from. */
  owner?: Owner;
  /** The team sections a prop's fill renders, in rendered order. */
  sections: SectionCard[];
};

export type SectionCard = {
  id: string;
  title: string;
  /** `<team plugin>:pack/sections/<name>.md`. */
  source: string;
  /** Changed since the last compile, so the skill is stale on team values. */
  changed: boolean;
};

/** `unknown` is check having no row for the skill: rt said nothing, which is
    not the same as in sync. */
export type SkillStatus = 'in-sync' | 'stale' | 'never-compiled' | 'unknown';

export type LinkCard = {
  id: string;
  rowId: string;
  skill: string;
  title: string;
  /** The linked file, `stage-plan/SKILL.md`; the title too unless the step
      is a stage copy. */
  file: string;
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
  /** The path the rendered text names; null for a fill it names by its
      binding instead, as a referenced prop renders. */
  path: string | null;
  /** The compile target the link resolves to, when it is one. */
  skill: string | null;
  /** What choosing the link selects: the linked file, or the prop row. */
  select: string;
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
/** An anatomy part, or a placeholder rt names only in composition: a step
    link (`verb.path`) or a run variable, which anatomy carries no part for. */
type RowSource = Omit<AnatomyPart, 'kind'> & {
  kind: AnatomyPart['kind'] | 'verb.path' | 'variable';
};
type BindingChange = SkillsChanges['bindings'][number];
type DriftCause = SkillsAnatomy['staleBecause'][number];
type CheckRow = SkillsCheck['verbs'][number];

/** What a row says about the prop value it pastes. */
export type PropFacts = {
  contract: string | null;
  required: boolean | null;
  boundTo: string | null;
  resolveError: string | null;
  layer: string | null;
};

type ValueFacts = Pick<PropFacts, 'boundTo' | 'resolveError' | 'layer'>;
/** An add prop takes several values, one anatomy part each. */
type DeclaredFacts = Pick<PropFacts, 'contract' | 'required'> & {
  values: ValueFacts[];
};

const OWN_TEXT_ID = 'text';

/** What changed for each cause, in the order a reader would fix them.
    `own` marks the skill's own part, which a card words as "its template". */
const STALE_CHANGES: [DriftCause, { what: string; own: boolean }][] = [
  ['source', { what: 'template', own: true }],
  ['include', { what: 'a pasted file', own: false }],
  ['fill', { what: 'pack text', own: true }],
  ['team', { what: 'team values', own: false }],
  ['frontmatter', { what: 'header', own: true }],
  ['structure', { what: 'files', own: true }],
  ['vendored', { what: 'files', own: true }],
];

/** Why check calls a skill stale, from the first cause a reader would fix:
    "its template changed", or "template changed" where the skill is already
    named. Null for an rt that names no cause. */
export function staleReason(
  causes: readonly DriftCause[] | undefined,
  { its = true }: { its?: boolean } = {}
): string | null {
  const change = STALE_CHANGES.find(([cause]) => causes?.includes(cause))?.[1];
  if (!change) return null;
  return `${its && change.own ? 'its ' : ''}${change.what} changed`;
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

/** A team section renders inside the prop whose lines hold it, and rt lists
    it right after that prop: it has no row of its own. */
export function withoutSections(anatomy: SkillsAnatomy): SkillsAnatomy {
  return {
    ...anatomy,
    parts: anatomy.parts.filter(part => part.kind !== 'section'),
  };
}

/** Whether rt placed a section inside a prop's rendered range; a stale file
    may not place it at all, and then rt's order is all there is. */
function holds(prop: RowSource, section: RowSource): boolean {
  const outer = prop.renderedLines;
  const inner = section.renderedLines;
  if (!inner) return true;
  return outer !== null && outer[0] <= inner[0] && inner[1] <= outer[1];
}

/** A fill can paste one section twice; the second takes its place as `@n`. */
function sectionCard(part: RowSource, card: InputCard): SectionCard {
  const name = part.name ?? '';
  const base = partKey(part);
  const repeats = card.sections.filter(
    section => section.id.split('@')[0] === base
  ).length;
  return {
    id: repeats === 0 ? base : `${base}@${repeats + 1}`,
    title: name,
    source: part.source?.ref ?? `pack/sections/${name}.md`,
    changed: part.changed,
  };
}

export function partKey(part: RowSource): string {
  return `${part.kind}:${part.name ?? ''}`;
}

/**
 * Lines a pasted part occupies in the rendered file: its placed range when rt
 * located it, else the size of its source. rt gives every placeholder on one
 * template line that line's whole rendered range, so a range shared with
 * another part says nothing about this part's size and its source decides.
 * A section sits inside its prop's range and shares nothing with it.
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
      other.kind !== 'block' &&
      other.kind !== 'section' &&
      other.renderedLines?.[0] === range[0] &&
      other.renderedLines[1] === range[1]
  ).length;
  return sharing > 1 ? (part.source?.lines ?? 0) : spanOf(range);
}

/** What an output part is called: an include by its name, a prop by the fill
    that fills it. */
export function partLabel(part: RowSource): string {
  if (part.kind === 'prop' && part.source) return suffixOf(part.source.ref);
  return part.name ?? part.kind;
}

export function shareOf(lines: number, total: number): number {
  return total > 0 ? Math.round((lines / total) * 100) : 0;
}

function textLabel(lines: number, noun: TextNoun): string {
  if (lines > 3) return `${lines} lines of ${noun} text`;
  return countOf(lines, 'line', 'lines');
}

/** The placeholder as the template writes it: a prop by its own name, which
    its block's text names. */
function codeOf(part: RowSource): string {
  if (part.kind === 'variable') return `{{${part.name}}}`;
  if (part.kind === 'prop')
    return `{{props.${splitPropKey(part.name ?? '').name}}}`;
  return `{{${part.kind}:${part.name}}}`;
}

/** A prop of the skill's own root block by its name; a nested block's by
    `<block>.<prop>`, since two blocks can name a prop alike. */
function propTitle(key: string, root: string): string {
  const { block, name } = splitPropKey(key);
  return `${block === root ? name : key} prop`;
}

/** The placeholders rt fills per run, as their template writes them. */
const VARIABLE_KINDS = new Set(['stage.fields', 'run-start.flags']);

/**
 * The step links and run variables a skill's template names, from its
 * composition target. A `{{pipeline.table}}` reaches it already expanded to
 * one `verb.path` per stage the pipeline runs.
 */
function placeholderSources(
  composition: Pick<SkillsComposition, 'targets'>,
  skill: string
): RowSource[] {
  const targets = composition.targets ?? [];
  const placeholders =
    targets.find(target => target.name === skill)?.placeholders ?? [];
  return placeholders.flatMap((placeholder): RowSource[] => {
    const at = {
      templateLines: [placeholder.line, placeholder.line] as LineRange,
      renderedLines: null,
      mode: null,
      source: null,
      changed: false,
    };
    if (placeholder.kind === 'verb.path' && placeholder.arg) {
      const linked = targets.find(target => target.name === placeholder.arg);
      return [
        {
          ...at,
          kind: 'verb.path',
          name: placeholder.arg,
          target: {
            skill: placeholder.arg,
            path: linked?.artifactPath ?? `${placeholder.arg}/SKILL.md`,
            lines: null,
          },
        },
      ];
    }
    if (VARIABLE_KINDS.has(placeholder.kind)) {
      return [
        {
          ...at,
          kind: 'variable',
          name: placeholder.arg
            ? `${placeholder.kind}:${placeholder.arg}`
            : placeholder.kind,
          target: null,
        },
      ];
    }
    return [];
  });
}

/**
 * The anatomy parts with the composition-only placeholders among them. Where
 * anatomy traces template lines, each placeholder goes before the first part
 * at or past its line; rt's own anatomy places parts by rendered line only, which
 * a template line cannot be ordered against, so there they lead.
 */
function rowSourcesOf(
  anatomy: SkillsAnatomy,
  composition: Pick<SkillsComposition, 'targets'>
): RowSource[] {
  const extra = placeholderSources(composition, anatomy.skill).sort(
    (a, b) => a.templateLines![0] - b.templateLines![0]
  );
  if (!anatomy.parts.some(part => part.templateLines))
    return [...extra, ...anatomy.parts];
  const out: RowSource[] = [];
  for (const part of anatomy.parts) {
    const start = part.kind === 'section' ? null : part.templateLines?.[0];
    while (
      start != null &&
      extra.length > 0 &&
      extra[0]!.templateLines![0] <= start
    )
      out.push(extra.shift()!);
    out.push(part);
  }
  return [...out, ...extra];
}

function variableTitle(name: string): string {
  if (name === 'stage.fields') return 'run fields';
  if (name.startsWith('run-start.flags')) return 'run flags';
  return name;
}

/**
 * What the payload says about each of a skill's props, keyed `<block>.<prop>`.
 * A roster verb states them all; anything else has the props its template
 * declares and its blocks' binders, and a binding the template does not
 * declare is known only by the contract its fill provides.
 */
function propFactsOf(
  composition: SkillsComposition,
  skill: string,
  ref: string,
  workType: string | null = null
): Map<string, DeclaredFacts> {
  const facts = new Map<string, DeclaredFacts>();
  const provides = new Map(
    composition.fills.map(fill => [fill.binding, fill.provides] as const)
  );
  const target = composition.targets?.find(t => t.name === skill);
  const pipeline = target?.pipeline ?? workType;
  const plugin = pluginOf(ref);
  const binders = composition.binders.filter(
    b => engineRefOf(b.ref) === engineRefOf(ref)
  );
  /** The binder's fill and the layer that chose it, in this pipeline. */
  const binding = (block: string, name: string) => {
    const prop = binders
      .find(b => b.ref === `${plugin}:${block}`)
      ?.props.find(candidate => candidate.name === name);
    if (!prop) return null;
    const override = overrideOf(prop, pipeline);
    return {
      boundTo: (override?.boundTo ?? prop.boundTo) || null,
      layer: (override ? override.layer : prop.layer) ?? null,
      overridden: override !== undefined,
    };
  };
  const bound = (block: string, name: string): ValueFacts[] => {
    const own = binding(block, name);
    return own?.boundTo
      ? [{ boundTo: own.boundTo, resolveError: null, layer: own.layer }]
      : [];
  };

  const verb = composition.verbs.find(v => v.name === skill);
  for (const [block, props] of Object.entries(verb?.props ?? {})) {
    for (const prop of props) {
      const own = binding(block, prop.name);
      facts.set(propKey(block, prop.name), {
        contract: prop.contract,
        required: prop.required,
        values: own?.overridden
          ? bound(block, prop.name)
          : prop.values.map(value => ({
              boundTo: value.boundTo,
              resolveError: value.resolveError ?? null,
              layer: value.layer,
            })),
      });
    }
  }
  for (const [block, props] of Object.entries(target?.props ?? {})) {
    for (const prop of props) {
      const key = propKey(block, prop.name);
      if (facts.has(key)) continue;
      facts.set(key, {
        contract: prop.contract,
        required: prop.required,
        values: bound(block, prop.name),
      });
    }
  }
  for (const binder of binders) {
    const block = blockOf(binder.ref);
    for (const prop of binder.props) {
      const key = propKey(block, prop.name);
      if (facts.has(key)) continue;
      const values = bound(block, prop.name);
      if (values.length === 0) continue;
      facts.set(key, {
        contract: provides.get(values[0]!.boundTo!) ?? null,
        required: null,
        values,
      });
    }
  }
  return facts;
}

/** The facts of the one value a part pastes: the value its source names,
    else the prop's first. */
function partFacts(
  declared: DeclaredFacts | undefined,
  part: RowSource
): PropFacts | undefined {
  if (!declared) return undefined;
  const value =
    declared.values.find(v => v.boundTo === part.source?.ref) ??
    declared.values[0];
  return {
    contract: declared.contract,
    required: declared.required,
    boundTo: value?.boundTo ?? null,
    resolveError: value?.resolveError ?? null,
    layer: value?.layer ?? null,
  };
}

function propState(
  part: RowSource,
  facts: PropFacts | undefined,
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
  // A stage copy pastes what its engine pastes; the engine counts for both.
  const includeUses = (name: string) =>
    composition.targets
      ? composition.targets.filter(
          target =>
            target.engine === undefined &&
            target.placeholders.some(
              p => p.kind === 'include' && p.arg === name
            )
        ).length
      : composition.verbs.filter(v => v.includes?.includes(name)).length;
  const fillUses = (ref: string) => sites[ref]?.length ?? 0;
  return { includeUses, fillUses };
}

export function textNounOf(
  anatomy: SkillsAnatomy,
  composition?: Pick<SkillsComposition, 'verbs' | 'targets'>
): TextNoun {
  if (anatomy.kind === 'stage') return 'step';
  const verb = composition?.verbs.find(v => v.name === anatomy.skill);
  if (
    anatomy.skill === ORCHESTRATOR_VERB ||
    (verb !== undefined && leadsAPipeline(verb)) ||
    composition?.targets
      ?.find(target => target.name === anatomy.skill)
      ?.placeholders.some(placeholder => placeholder.kind === 'verb.path')
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
  const { composition, check, changes, step, anatomy } = input;
  const stepOf = stepNumbers(composition, input.workType ?? null);
  const pack = anatomy.pack;
  const textNoun = textNounOf(anatomy, composition);
  const propFacts = propFactsOf(
    composition,
    anatomy.skill,
    anatomy.template.ref,
    input.workType ?? null
  );
  const root = suffixOf(anatomy.template.ref);
  const { includeUses, fillUses } = usageCounts(composition);
  const checkRows = new Map<string, CheckRow>(
    (check?.verbs ?? []).map(row => [row.name, row] as const)
  );
  // A default change rebuilds the shown skill only where its pipeline does
  // not override the prop.
  const shownPipeline =
    composition.targets?.find(target => target.name === anatomy.skill)
      ?.pipeline ??
    input.workType ??
    null;
  const overriddenHere = (change: BindingChange) =>
    overrideOf(
      composition.binders
        .find(binder => binder.ref === change.engineRef)
        ?.props.find(candidate => candidate.name === change.slot) ?? {},
      shownPipeline
    ) !== undefined;
  const pendingProps = new Set(
    (changes?.bindings ?? [])
      .filter(
        change =>
          engineRefOf(change.engineRef) === anatomy.template.ref &&
          (change.pipeline
            ? change.pipeline === shownPipeline
            : !overriddenHere(change))
      )
      .map(change => propKey(blockOf(change.engineRef), change.slot))
  );

  const rows: TemplateRow[] = [];
  const inputs: InputCard[] = [];
  const links: LinkCard[] = [];
  const rowsAtLine = new Map<number, number>();
  const cardIds = new Set<string>();
  /** A repeat of a card id takes its row's id too: row ids are unique, and a
      node and a select both key on the card id. */
  const cardIdFor = (base: string, rowId: string) => {
    const cardId = cardIds.has(base) ? `${base}@${rowId}` : base;
    cardIds.add(cardId);
    return cardId;
  };

  let prop: { part: RowSource; card: InputCard } | null = null;
  for (const part of rowSourcesOf(anatomy, composition)) {
    if (part.kind === 'section') {
      if (prop && holds(prop.part, part))
        prop.card.sections.push(sectionCard(part, prop.card));
      continue;
    }
    if (part.kind === 'prop') prop = null;
    const anchor = part.templateLines ?? part.renderedLines;
    if (!anchor) continue;
    const line = anchor[0];
    const nth = (rowsAtLine.get(line) ?? 0) + 1;
    rowsAtLine.set(line, nth);
    const id = nth === 1 ? String(line) : `${line}.${nth}`;
    const gutter = part.templateLines
      ? gutterOf(part.templateLines)
      : `rendered ${gutterOf(anchor)}`;

    if (part.kind === 'text' || part.kind === 'block') {
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
      part.kind === 'prop'
        ? partFacts(propFacts.get(part.name ?? ''), part)
        : undefined;
    const state =
      part.kind === 'prop'
        ? propState(part, facts, pendingProps.has(part.name ?? ''))
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
      fill: part.kind === 'prop' && part.source ? partLabel(part) : null,
      boundTo: facts?.boundTo ?? null,
      resolveError: facts?.resolveError ?? null,
      layer: facts?.layer ?? null,
    });

    if (part.kind === 'verb.path') {
      const skill = part.target?.skill ?? part.name ?? '';
      links.push(
        linkCard(
          part,
          cardIdFor(`link:${skill}`, id),
          skill,
          id,
          stepOf(skill),
          checkRows.get(skill),
          copyLinkLabelOf(composition, skill)
        )
      );
      continue;
    }
    if (state === 'optional-unbound') continue;

    const card: InputCard = {
      id: cardIdFor(partKey(part), id),
      rowId: id,
      ...cardFace(part, state, facts, pack, root),
      state,
      usedBy:
        part.kind === 'include'
          ? includeUses(part.name ?? '')
          : part.kind === 'prop' && facts?.boundTo
            ? fillUses(facts.boundTo)
            : 0,
      sections: [],
    };
    inputs.push(card);
    if (part.kind === 'prop') prop = { part, card };
  }

  const pendingSkill =
    pendingProps.size > 0 ||
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
            rows,
            checkRows.get(anatomy.skill),
            pendingSkill,
            step,
            textNoun
          ),
    textNoun,
  };
}

/**
 * The output part a canvas selection names, or null: the part itself
 * (`output:<part>`), or the include or prop row or card that pastes it in.
 * A repeated card's `@<row>` suffix names the same part.
 */
export function selectedPartId(
  view: TemplateView,
  select: string | null
): string | null {
  if (!select || !view.output) return null;
  const [kind, ...rest] = select.split(':');
  const ref = rest.join(':');
  let id: string | null = null;
  if (kind === 'output' || kind === 'input') id = ref.split('@')[0] ?? null;
  if (kind === 'row') {
    const row = view.rows.find(candidate => `row:${candidate.id}` === select);
    if (
      row?.kind === 'placeholder' &&
      (row.placeholder === 'include' || row.placeholder === 'prop')
    )
      id = `${row.placeholder}:${row.name ?? ''}`;
  }
  return view.output.parts.some(part => part.id === id && !part.own)
    ? id
    : null;
}

function cardFace(
  part: RowSource,
  state: RowState,
  facts: PropFacts | undefined,
  pack: string,
  root: string
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
    subtitleTone: 'dimmed' as InputCard['subtitleTone'],
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

  const propName = part.name ?? '';
  const title = propTitle(propName, root);
  switch (state) {
    case 'required-unbound':
      return {
        ...file,
        title,
        subtitle: 'Not bound',
        subtitleTone: 'warn',
      };
    case 'resolve-error':
      return {
        ...file,
        icon: 'fileX',
        title,
        subtitle: causeOf(
          facts?.resolveError ?? '',
          splitPropKey(propName).name
        ),
        subtitleTone: 'bad',
      };
    case 'no-matching-fill':
      return {
        ...file,
        icon: 'fileX',
        title,
        subtitle: `no fill named ${facts?.boundTo} in this pack`,
        subtitleTone: 'warn',
      };
    case 'referenced':
      return {
        ...file,
        title: sourceTitle,
        subtitle: 'referenced: the rendered text links to it',
      };
  }
  const source = part.source!;
  const owner = ownerOf(source.ref, source, pack);
  switch (owner.kind) {
    case 'pack':
      return {
        ...file,
        title: sourceTitle,
        subtitle: `written by ${pack} · ${source.lines} lines`,
        subtitleTone: 'accent',
      };
    case 'base':
      return {
        ...file,
        title: sourceTitle,
        subtitle: `${owner.name} · org base${pickedBy(facts?.layer ?? null)}`,
      };
    case 'plugin':
      return {
        ...file,
        title: sourceTitle,
        subtitle: `${owner.name} default${pickedBy(facts?.layer ?? null)}`,
      };
  }
}

/** rt's message without the `<step>: prop "<name>": ` it opens with, which
    the card's title already says. */
function causeOf(message: string, prop: string): string {
  const marker = `: prop "${prop}": `;
  const at = message.indexOf(marker);
  return at > 0 && !/\s/.test(message.slice(0, at))
    ? message.slice(at + marker.length)
    : message;
}

/** Who chose a default fill, for the layers rt names a chooser for. */
function pickedBy(layer: string | null): string {
  if (layer?.startsWith('base:')) return ' · picked by the org base';
  if (layer === 'pack' || layer === 'override')
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
  const engines = new Map(
    (composition.targets ?? []).flatMap(target =>
      target.engine !== undefined ? [[target.name, target.engine] as const] : []
    )
  );
  return (skill: string): number | null => {
    const stage = engines.get(skill) ?? skill;
    const at = order.findIndex(ref => suffixOf(ref) === stage);
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
  part: RowSource,
  cardId: string,
  skill: string,
  rowId: string,
  step: number | null,
  row: CheckRow | undefined,
  copyLabel: string | null
): LinkCard {
  const lines = part.target?.lines ?? null;
  const status: SkillStatus = row?.status ?? 'unknown';
  const reason = status === 'stale' ? staleReason(row?.staleBecause) : null;
  const subtitle = [
    step === null ? null : `step ${step}`,
    reason ? `stale: ${reason}` : LINK_STATUS_WORDS[status],
    lines === null || status === 'never-compiled' ? null : `${lines} lines`,
  ]
    .filter(phrase => phrase !== null)
    .join(' · ');
  const file = part.target
    ? fileLabelOf(part.target.path)
    : `${skill}/SKILL.md`;
  return {
    id: cardId,
    rowId,
    skill,
    title: copyLabel ?? file,
    file,
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
  rows: readonly TemplateRow[],
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
    title: copyLabelOf(composition, anatomy.skill) ?? stepLabel(anatomy.skill),
    lines: rendered.lines,
    status,
    reason: status === 'stale' ? staleReason(row?.staleBecause) : null,
    parts: built ? outputParts(anatomy, textNoun) : [],
    links: built ? outputLinks(anatomy, composition, rows) : [],
  };
}

function outputParts(anatomy: SkillsAnatomy, textNoun: TextNoun): OutputPart[] {
  const total = anatomy.rendered.lines;
  const pasted = anatomy.parts
    .filter(
      part =>
        (part.kind === 'include' || part.kind === 'prop') &&
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
    part =>
      (part.kind === 'text' || part.kind === 'block') && part.renderedLines
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

/** What the rendered text links to, in the order it reads: the paths it
    names, and the fills a referenced prop names by their binding. */
function outputLinks(
  anatomy: SkillsAnatomy,
  composition: SkillsComposition,
  rows: readonly TemplateRow[]
): OutputLink[] {
  const targetByPath = new Map(
    (composition.targets ?? []).map(t => [t.artifactPath, t.name] as const)
  );
  const byPath = anatomy.links.map(link => ({
    line: link.line,
    link: {
      label: fileLabelOf(link.path),
      path: link.path,
      skill:
        targetByPath.get(resolveFrom(anatomy.rendered.path, link.path)) ?? null,
      select: `link:${link.path}`,
    } satisfies OutputLink,
  }));
  // A row's state names only its loudest fact, so an unsynced rebind hides
  // that the prop still renders as a reference; the mode comes from the part.
  const referenced = new Set(
    anatomy.parts
      .filter(part => part.kind === 'prop' && part.mode === 'reference')
      .map(part => part.name)
  );
  const byBinding = rows.flatMap(row =>
    row.kind === 'placeholder' &&
    row.placeholder === 'prop' &&
    referenced.has(row.name) &&
    row.fill
      ? [
          {
            line: row.renderedLines?.[0] ?? 0,
            link: {
              label: row.fill,
              path: null,
              skill: null,
              select: `row:${row.id}`,
            } satisfies OutputLink,
          },
        ]
      : []
  );
  return [...byPath, ...byBinding]
    .sort((a, b) => a.line - b.line)
    .map(({ link }) => link);
}
