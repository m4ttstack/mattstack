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
      /** What a slot is filled from, by name; null when nothing fills it. */
      fill: string | null;
      /** The binding a slot names, found or not; null when nothing is bound. */
      boundTo: string | null;
      /** rt's message for a slot it could not resolve. */
      resolveError: string | null;
    };

export type InputCard = {
  id: string;
  rowId: string;
  title: string;
  subtitle: string;
  /** `fileX` for a slot rt could not load a fill file for. */
  icon: 'fileText' | 'cpu' | 'fileX';
  path: string | null;
  subtitleTone: 'dimmed' | 'accent' | 'warn' | 'bad';
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
  /** The path the rendered text names; null for a fill it names by its
      binding instead, as a referenced slot renders. */
  path: string | null;
  /** The compile target the link resolves to, when it is one. */
  skill: string | null;
  /** What choosing the link selects: the linked file, or the slot row. */
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
  /** The app that owns the skill (`board` for `board:doctor`), when it is
      not this pack's own and the view shows only the slots the pack fills. */
  app?: string;
};

type AnatomyPart = SkillsAnatomy['parts'][number];
type DriftCause = SkillsAnatomy['staleBecause'][number];
type CheckRow = SkillsCheck['verbs'][number];

export type SlotFacts = {
  contract: string | null;
  required: boolean | null;
  boundTo: string | null;
  resolveError: string | null;
  layer: string | null;
};

const OWN_TEXT_ID = 'text';

/** What changed for each cause, in the order a reader would fix them.
    `own` marks the skill's own part, which a card words as "its template". */
const STALE_CHANGES: [DriftCause, { what: string; own: boolean }][] = [
  ['source', { what: 'template', own: true }],
  ['include', { what: 'a pasted file', own: false }],
  ['fill', { what: 'pack text', own: true }],
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

/**
 * What the payload says about each of a skill's slots. A roster verb states
 * them all; anything else has the slots its template declares and the
 * binder's bindings, and a binding the template does not declare is known
 * only by the contract its fill provides.
 */
export function slotFactsOf(
  composition: SkillsComposition,
  skill: string,
  ref: string
): Map<string, SlotFacts> {
  const facts = new Map<string, SlotFacts>();
  const provides = new Map(
    composition.fills.map(fill => [fill.binding, fill.provides] as const)
  );
  const verb = composition.verbs.find(v => v.name === skill);
  for (const slot of verb?.slots ?? []) {
    facts.set(slot.name, {
      contract: slot.contract,
      required: slot.required,
      boundTo: slot.boundTo,
      resolveError: slot.resolveError ?? null,
      layer: slot.layer ?? null,
    });
  }
  const binder = composition.binders.find(b => b.ref === ref);
  const bound = new Map(binder?.slots.map(slot => [slot.name, slot]));
  const target = composition.targets?.find(t => t.name === skill);
  for (const slot of target?.slots ?? []) {
    if (facts.has(slot.name)) continue;
    const binding = bound.get(slot.name);
    facts.set(slot.name, {
      contract: slot.contract,
      required: slot.required,
      boundTo: binding?.boundTo ?? null,
      resolveError: null,
      layer: binding?.layer ?? null,
    });
  }
  for (const slot of binder?.slots ?? []) {
    if (facts.has(slot.name)) continue;
    facts.set(slot.name, {
      contract: provides.get(slot.boundTo) ?? null,
      required: null,
      boundTo: slot.boundTo,
      resolveError: null,
      layer: slot.layer ?? null,
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

export function textNounOf(anatomy: SkillsAnatomy): TextNoun {
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
  const slotFacts = slotFactsOf(
    composition,
    anatomy.skill,
    anatomy.template.ref
  );
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
  /** A repeat of a card id takes its row's id too: row ids are unique, and a
      node and a select both key on the card id. */
  const cardIdFor = (base: string, rowId: string) => {
    const cardId = cardIds.has(base) ? `${base}@${rowId}` : base;
    cardIds.add(cardId);
    return cardId;
  };

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
      fill: part.kind === 'slot' && part.source ? partLabel(part) : null,
      boundTo: facts?.boundTo ?? null,
      resolveError: facts?.resolveError ?? null,
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
          checkRows.get(skill)
        )
      );
      continue;
    }
    if (state === 'optional-unbound') continue;

    inputs.push({
      id: cardIdFor(partKey(part), id),
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
 * (`output:<part>`), or the include or slot row or card that pastes it in.
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
    const row = view.rows.find(candidate => `row:${candidate.line}` === select);
    if (
      row?.kind === 'placeholder' &&
      (row.placeholder === 'include' || row.placeholder === 'slot')
    )
      id = `${row.placeholder}:${row.name ?? ''}`;
  }
  return view.output.parts.some(part => part.id === id && !part.own)
    ? id
    : null;
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

  const slotTitle = `${part.name} slot`;
  switch (state) {
    case 'required-unbound':
      return {
        ...file,
        title: slotTitle,
        subtitle: 'required, nothing bound',
        subtitleTone: 'warn',
      };
    case 'resolve-error':
      return {
        ...file,
        icon: 'fileX',
        title: slotTitle,
        subtitle: causeOf(facts?.resolveError ?? '', part.name ?? ''),
        subtitleTone: 'bad',
      };
    case 'no-matching-fill':
      return {
        ...file,
        icon: 'fileX',
        title: slotTitle,
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

/** rt's message without the `<step>: slot "<name>": ` it opens with, which
    the card's title already says. */
function causeOf(message: string, slot: string): string {
  const marker = `: slot "${slot}": `;
  const at = message.indexOf(marker);
  return at > 0 && !/\s/.test(message.slice(0, at))
    ? message.slice(at + marker.length)
    : message;
}

/**
 * A skill another app owns, such as the board's `board:doctor`, which this
 * pack only fills: rt has no anatomy for it, so the view is the slots the
 * pack's binders fill and a card per fill. The anatomy is a stand-in that
 * carries the pack and the skill's description, with no file of its own.
 */
export function appSkillView(
  composition: SkillsComposition,
  ref: string,
  pack: string
): { view: TemplateView; anatomy: SkillsAnatomy } | null {
  const binder = composition.binders.find(
    b => b.ref === ref && b.kind === 'external'
  );
  if (!binder) return null;
  const app = pluginOf(ref);
  const fills = new Map(composition.fills.map(fill => [fill.binding, fill]));
  const rows: TemplateRow[] = [];
  const inputs: InputCard[] = [];
  binder.slots.forEach((slot, index) => {
    const id = String(index + 1);
    const fill = fills.get(slot.boundTo);
    const state: RowState = fill ? 'ok' : 'no-matching-fill';
    rows.push({
      id,
      line: index + 1,
      kind: 'placeholder',
      placeholder: 'slot',
      gutter: 'slot',
      code: `{{slot:${slot.name}}}`,
      templateLine: null,
      renderedLines: null,
      state,
      name: slot.name,
      contract: fill?.provides ?? null,
      fill: slot.boundTo,
      boundTo: slot.boundTo,
      resolveError: null,
    });
    const plugin = pluginOf(slot.boundTo);
    inputs.push({
      id: `slot:${slot.name}`,
      rowId: id,
      state,
      usedBy: composition.binders.filter(other =>
        other.slots.some(s => s.boundTo === slot.boundTo)
      ).length,
      ...(fill
        ? {
            title: fileLabelOf(fill.sourcePath),
            icon: 'fileText' as const,
            path: fill.sourcePath,
            ...(plugin === pack
              ? {
                  subtitle: `written by ${pack}`,
                  subtitleTone: 'accent' as const,
                }
              : {
                  subtitle: `${plugin} default${pickedBy(slot.layer ?? null)}`,
                  subtitleTone: 'dimmed' as const,
                }),
          }
        : {
            title: `${slot.name} slot`,
            icon: 'fileX' as const,
            path: null,
            subtitle: `no fill named ${slot.boundTo} in this pack`,
            subtitleTone: 'warn' as const,
          }),
    });
  });
  const slots = countOf(binder.slots.length, 'slot', 'slots');
  return {
    view: {
      skill: ref,
      templateFile: ref,
      templateMeta: `${app} app · ${slots}`,
      rows,
      inputs,
      links: [],
      output: null,
      textNoun: 'verb',
      app,
    },
    anatomy: {
      pack,
      skill: ref,
      kind: 'verb',
      public: false,
      description: `Lives in the ${app} app. ${pack} fills its ${slots}.`,
      template: { ref, path: '', version: '', builtVersion: null, lines: 0 },
      rendered: { path: '', exists: false, lines: 0 },
      status: 'in-sync',
      staleBecause: [],
      parts: [],
      links: [],
    },
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
  cardId: string,
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
    id: cardId,
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
    title: stepLabel(anatomy.skill),
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

/** What the rendered text links to, in the order it reads: the paths it
    names, and the fills a referenced slot names by their binding. */
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
  // that the slot still renders as a reference; the mode comes from the part.
  const referenced = new Set(
    anatomy.parts
      .filter(part => part.kind === 'slot' && part.mode === 'reference')
      .map(part => part.name)
  );
  const byBinding = rows.flatMap(row =>
    row.kind === 'placeholder' &&
    row.placeholder === 'slot' &&
    referenced.has(row.name) &&
    row.fill
      ? [
          {
            line: row.renderedLines?.[0] ?? 0,
            link: {
              label: row.fill,
              path: null,
              skill: null,
              select: `row:${row.line}`,
            } satisfies OutputLink,
          },
        ]
      : []
  );
  return [...byPath, ...byBinding]
    .sort((a, b) => a.line - b.line)
    .map(({ link }) => link);
}
