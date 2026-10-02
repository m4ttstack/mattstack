import { pluginOf } from '../../outline';
import type { SkillsAnatomy } from '../../useWiring';
import type { DrawerTab, WiringView } from '../useWiringUrl';
import { STATUS_TONE, type StatusTone } from './statusTone';
import {
  countOf,
  fileLabelOf,
  gutterOf,
  partKey,
  partLabel,
  pastedLines,
  resolveFrom,
  shareOf,
  spanOf,
  textNounOf,
  type InputCard,
  type LineRange,
  type OutputCard,
  type TemplateRow,
  type TemplateView,
} from './templateModel';

export type { DrawerTab } from '../useWiringUrl';

export type DrawerTarget =
  | { kind: 'row'; line: number }
  | { kind: 'input'; id: string }
  | { kind: 'output'; part: string | null }
  | { kind: 'link'; path: string };

export type DrawerBadge = 'partial' | 'pack text' | 'rendered';

/** What the Used by tab lists the sites of: a partial by its include name,
    or a fill by its binding, with the plugin that owns its file. */
export type DrawerUsedBy = {
  kind: 'include' | 'fill';
  name: string;
  plugin: string;
};

export type DrawerBand = {
  from: number;
  to: number;
  label: string;
  tone: 'accent' | 'muted';
};

export type DrawerContent = {
  filePath: string;
  fileLabel: string;
  /** Null over a skill's template, where the Template | Rendered toggle
      already says which file this is. */
  badge: DrawerBadge | null;
  /** Owner and version of a source file, and whether it is the installed
      copy; null for the rendered file. */
  meta: string | null;
  canToggle: boolean;
  view: WiringView;
  chip: string | null;
  /** The output's status beside its sentence; null everywhere else. */
  dot: StatusTone | null;
  sentence: string;
  highlight: { template: LineRange | null; rendered: LineRange | null };
  /** Only in the Rendered view, where each pasted part gets one. */
  bands: DrawerBand[];
  tabs: DrawerTab[];
  /** `bound` is whether the slot names a binding (its `boundTo`, which the
      rebind panel reads too), even one rt cannot find. */
  slot: { name: string; contract: string | null; bound: boolean } | null;
  usedBy: DrawerUsedBy | null;
  /** rt's message for a slot it could not resolve, whole. */
  error: string | null;
};

type AnatomyPart = SkillsAnatomy['parts'][number];
type AnatomySource = SkillsAnatomy['template'];
type PlaceholderRow = Extract<TemplateRow, { kind: 'placeholder' }>;

const POSITIVE_INT = /^[1-9]\d*$/;
const VENDORED_PART = /(^|\/)parts\//;
const NO_HIGHLIGHT = { template: null, rendered: null };

/** `row:140`, `input:include:gate-protocol`, `output`,
    `output:include:gate-protocol` or `link:<path>`; anything else is null. */
export function parseTarget(select: string | null): DrawerTarget | null {
  if (!select) return null;
  const colon = select.indexOf(':');
  const head = colon === -1 ? select : select.slice(0, colon);
  const rest = colon === -1 ? null : select.slice(colon + 1);
  switch (head) {
    case 'row':
      return rest !== null && POSITIVE_INT.test(rest)
        ? { kind: 'row', line: Number(rest) }
        : null;
    case 'input':
      return rest ? { kind: 'input', id: rest } : null;
    case 'output':
      if (rest === null) return { kind: 'output', part: null };
      return rest ? { kind: 'output', part: rest } : null;
    case 'link':
      return rest ? { kind: 'link', path: rest } : null;
    default:
      return null;
  }
}

/** Null when the view holds no such row, card, part or link, so a stale
    `select` leaves the drawer closed. */
export function drawerContent(
  target: DrawerTarget,
  view: TemplateView,
  anatomy: SkillsAnatomy,
  requestedView: WiringView | null
): DrawerContent | null {
  switch (target.kind) {
    case 'row': {
      const row = view.rows.find(r => r.line === target.line);
      return row ? rowContent(row, view, anatomy, requestedView) : null;
    }
    case 'input': {
      const card = view.inputs.find(c => c.id === target.id);
      const row = card && view.rows.find(r => r.id === card.rowId);
      if (!card || !row) return null;
      const part = partOf(row, anatomy);
      return part?.source && card.path && row.kind === 'placeholder'
        ? inputContent(card, row, part, part.source, anatomy)
        : rowContent(row, view, anatomy, requestedView);
    }
    case 'output':
      return outputContent(target.part, view, anatomy, requestedView);
    case 'link':
      return linkContent(target.path, view, anatomy);
  }
}

/** Rows are built from parts in order, one per anchored part, and a row's id
    carries `.<n>` when it is the n-th part anchored at the same line. */
function partOf(row: TemplateRow, anatomy: SkillsAnatomy): AnatomyPart | null {
  const atLine = anatomy.parts.filter(
    part => (part.templateLines ?? part.renderedLines)?.[0] === row.line
  );
  const dot = row.id.indexOf('.');
  const nth = dot === -1 ? 0 : Number(row.id.slice(dot + 1)) - 1;
  return atLine[nth] ?? null;
}

function scopeOf(view: TemplateView): string {
  return view.textNoun === 'step' ? 'this step' : 'this skill';
}

function ownerMeta(source: AnatomySource, pack: string): string {
  const plugin = pluginOf(source.ref);
  return plugin === pack
    ? `${pack} ${source.version}`
    : `${plugin} ${source.version} · installed copy, read only`;
}

/** A skill with no rendered file only ever shows its template. */
function pickView(
  fallback: WiringView,
  requested: WiringView | null,
  anatomy: SkillsAnatomy
): WiringView {
  const shown = requested ?? fallback;
  return shown === 'rendered' && !anatomy.rendered.exists ? 'template' : shown;
}

function fileFace(
  shown: WiringView,
  view: TemplateView,
  anatomy: SkillsAnatomy
): Pick<
  DrawerContent,
  'filePath' | 'fileLabel' | 'badge' | 'meta' | 'tabs' | 'canToggle' | 'view'
> {
  return shown === 'template'
    ? {
        filePath: anatomy.template.path,
        fileLabel: view.templateFile,
        badge: null,
        meta: ownerMeta(anatomy.template, anatomy.pack),
        tabs: ['text'],
        canToggle: true,
        view: shown,
      }
    : {
        filePath: anatomy.rendered.path,
        fileLabel: fileLabelOf(anatomy.rendered.path),
        badge: 'rendered',
        meta: null,
        tabs: ['text', 'history'],
        canToggle: true,
        view: shown,
      };
}

function chipOf(part: AnatomyPart): string | null {
  const { templateLines: from, renderedLines: to } = part;
  if (from && to) return `${gutterOf(from)} → ${gutterOf(to)}`;
  if (from) return gutterOf(from);
  if (to) return `rendered ${gutterOf(to)}`;
  return null;
}

/** The file's own text bands as one run wherever its parts' lines touch,
    the lines above it as the header, and each pasted part by name. Lines no
    part accounts for (a fill that changed since the build) get no band. */
function bandsOf(
  anatomy: SkillsAnatomy,
  selected: string | null
): DrawerBand[] {
  const tone = (on: boolean) => (on ? 'accent' : 'muted');
  const isPasted = (part: AnatomyPart) =>
    (part.kind === 'include' || part.kind === 'slot') &&
    part.mode !== 'reference';
  const pasted = anatomy.parts.flatMap(part =>
    isPasted(part) && part.renderedLines
      ? [
          {
            from: part.renderedLines[0],
            to: part.renderedLines[1],
            label: partLabel(part),
            tone: tone(partKey(part) === selected),
          } satisfies DrawerBand,
        ]
      : []
  );
  const ownRanges = anatomy.parts
    .flatMap(part =>
      !isPasted(part) && part.renderedLines ? [part.renderedLines] : []
    )
    .sort((a, b) => a[0] - b[0]);
  if (!anatomy.parts.some(p => p.kind === 'text' && p.renderedLines))
    return pasted;

  const runs: LineRange[] = [];
  for (const [from, to] of ownRanges) {
    const last = runs[runs.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else runs.push([from, to]);
  }
  const chosen = anatomy.parts.find(part => partKey(part) === selected);
  const chosenOwn = chosen && !isPasted(chosen) ? chosen.renderedLines : null;
  const own = `${textNounOf(anatomy)} text`;
  const ownBands = runs.map(([from, to]): DrawerBand => ({
    from,
    to,
    label: own,
    tone: tone(
      chosenOwn !== null && chosenOwn[0] >= from && chosenOwn[1] <= to
    ),
  }));
  const firstOwn = runs[0][0];
  const header: DrawerBand[] =
    firstOwn > 1
      ? [{ from: 1, to: firstOwn - 1, label: 'header', tone: 'muted' }]
      : [];
  return [...header, ...ownBands, ...pasted].sort((a, b) => a.from - b.from);
}

function rowContent(
  row: TemplateRow,
  view: TemplateView,
  anatomy: SkillsAnatomy,
  requested: WiringView | null
): DrawerContent | null {
  const part = partOf(row, anatomy);
  if (!part) return null;
  const traced = part.templateLines !== null;
  // A stale skill's text and link parts are not placed in the file on disk,
  // so its rows open where their line numbers are certain.
  const fallback: WiringView = !traced
    ? 'rendered'
    : anatomy.status === 'stale' || part.kind === 'text' || !part.renderedLines
      ? 'template'
      : 'rendered';
  const shown = pickView(fallback, requested, anatomy);
  return {
    ...fileFace(shown, view, anatomy),
    chip: chipOf(part),
    dot: null,
    sentence: rowSentence(row, part, view, anatomy),
    highlight: { template: part.templateLines, rendered: part.renderedLines },
    bands: shown === 'rendered' ? bandsOf(anatomy, partKey(part)) : [],
    slot:
      row.kind === 'placeholder' && part.kind === 'slot'
        ? {
            name: part.name ?? '',
            contract: row.contract,
            bound: !!row.boundTo,
          }
        : null,
    usedBy: null,
    error: row.kind === 'placeholder' ? row.resolveError : null,
  };
}

function rowSentence(
  row: TemplateRow,
  part: AnatomyPart,
  view: TemplateView,
  anatomy: SkillsAnatomy
): string {
  if (row.kind === 'text') {
    if (!part.templateLines)
      return `${countOf(spanOf(part.renderedLines!), 'line', 'lines')} of ${view.textNoun} text.`;
    return `${countOf(spanOf(part.templateLines), 'line', 'lines')} of ${view.textNoun} text, as written in the template.`;
  }
  switch (part.kind) {
    case 'include':
      return includeSentence(part, view, anatomy);
    case 'slot':
      return slotSentence(row, part, anatomy);
    case 'variable':
      return part.renderedLines
        ? `A variable rt fills in for each run: ${countOf(spanOf(part.renderedLines), 'line', 'lines')} here.`
        : 'A variable rt fills in for each run.';
    default: {
      const link = view.links.find(l => l.rowId === row.id);
      return `This line points the agent at ${link?.title ?? `${part.name}/SKILL.md`}.`;
    }
  }
}

function includeSentence(
  part: AnatomyPart,
  view: TemplateView,
  anatomy: SkillsAnatomy
): string {
  const lines = pastedLines(part, anatomy.parts);
  if (!anatomy.rendered.exists)
    return `${part.name} is pasted here: ${countOf(lines, 'line', 'lines')}.`;
  const share = shareOf(lines, anatomy.rendered.lines);
  return `${part.name} is pasted here: ${countOf(lines, 'line', 'lines')}, ${share}% of what the agent reads in ${scopeOf(view)}.`;
}

function slotSentence(
  row: PlaceholderRow,
  part: AnatomyPart,
  anatomy: SkillsAnatomy
): string {
  const slot = `The ${part.name} slot.`;
  const fill = partLabel(part);
  switch (row.state) {
    case 'optional-unbound':
      return `${slot} It is optional, and nothing is bound to it.`;
    case 'required-unbound':
      return `${slot} It is required, and nothing is bound to it.`;
    case 'no-matching-fill':
      return `${slot} The fill it names is missing from this pack.`;
    case 'resolve-error':
      return `${slot} rt could not resolve it.`;
    case 'referenced':
      return `${slot} This pack links it to ${fill} rather than pasting it in.`;
    default:
      return `${slot} This pack fills it with ${fill}: ${countOf(pastedLines(part, anatomy.parts), 'line', 'lines')}.`;
  }
}

function inputContent(
  card: InputCard,
  row: PlaceholderRow,
  part: AnatomyPart,
  source: AnatomySource,
  anatomy: SkillsAnatomy
): DrawerContent {
  const plugin = pluginOf(source.ref);
  const packText = part.kind === 'slot' && plugin === anatomy.pack;
  const one = card.usedBy === 1;
  const skills = `${countOf(card.usedBy, 'skill', 'skills')} in this pack`;
  const sentence =
    part.kind === 'include'
      ? `A ${plugin} partial. ${skills} ${one ? 'pastes' : 'paste'} it in.`
      : packText
        ? `Written by ${anatomy.pack}. ${skills} ${one ? 'uses' : 'use'} it.`
        : `A ${plugin} default. ${skills} ${one ? 'uses' : 'use'} it.`;
  return {
    filePath: source.path,
    fileLabel: card.title,
    badge: packText ? 'pack text' : 'partial',
    meta: ownerMeta(source, anatomy.pack),
    canToggle: false,
    view: 'template',
    chip: null,
    dot: null,
    sentence,
    highlight: NO_HIGHLIGHT,
    bands: [],
    tabs: ['text', 'used-by', 'history'],
    slot:
      part.kind === 'slot'
        ? { name: part.name ?? '', contract: row.contract, bound: true }
        : null,
    usedBy:
      part.kind === 'include'
        ? { kind: 'include', name: part.name ?? '', plugin }
        : { kind: 'fill', name: source.ref, plugin },
    error: null,
  };
}

function outputSentence(output: OutputCard, anatomy: SkillsAnatomy): string {
  switch (output.status) {
    case 'unsynced':
      return 'Rebuilt here, not synced yet.';
    case 'stale':
      return output.reason ? `Stale: ${output.reason}.` : 'Stale.';
    case 'never-compiled':
      return 'Never compiled.';
    case 'unknown':
      return 'Status unmeasured.';
    case 'in-sync': {
      const sources = new Set(
        anatomy.parts.flatMap(part =>
          (part.kind === 'include' || part.kind === 'slot') && part.source
            ? [part.source.path]
            : []
        )
      );
      return `In sync. ${countOf(output.lines, 'line', 'lines')}, rendered from ${countOf(sources.size + 1, 'file', 'files')}.`;
    }
  }
}

function outputContent(
  partId: string | null,
  view: TemplateView,
  anatomy: SkillsAnatomy,
  requested: WiringView | null
): DrawerContent | null {
  const output = view.output;
  if (!output) return null;
  const shown = pickView('rendered', requested, anatomy);
  const whole = {
    ...fileFace(shown, view, anatomy),
    chip: null,
    dot: null,
    highlight: NO_HIGHLIGHT,
    slot: null,
    usedBy: null,
    error: null,
  };

  if (partId === null) {
    return {
      ...whole,
      dot: STATUS_TONE[output.status],
      sentence: outputSentence(output, anatomy),
      bands: shown === 'rendered' ? bandsOf(anatomy, null) : [],
    };
  }
  const listed = output.parts.find(p => p.id === partId);
  if (!listed) return null;
  if (listed.own) {
    return {
      ...whole,
      sentence: `${countOf(listed.lines, 'line', 'lines')} of ${view.textNoun} text, ${listed.share}% of what the agent reads in ${scopeOf(view)}.`,
      bands: shown === 'rendered' ? bandsOf(anatomy, null) : [],
    };
  }
  const row = view.rows.find(r => {
    const part = r.kind === 'placeholder' ? partOf(r, anatomy) : null;
    return part !== null && partKey(part) === partId;
  });
  return row ? rowContent(row, view, anatomy, shown) : null;
}

function linkContent(
  path: string,
  view: TemplateView,
  anatomy: SkillsAnatomy
): DrawerContent | null {
  const link = view.output?.links.find(l => l.path === path);
  const at = anatomy.links.find(l => l.path === path);
  if (!link || !at) return null;
  const owner = view.textNoun === 'step' ? "This step's" : "This skill's";
  return {
    filePath: resolveFrom(anatomy.rendered.path, path),
    fileLabel: link.label,
    badge: link.skill
      ? 'rendered'
      : VENDORED_PART.test(path)
        ? 'partial'
        : 'pack text',
    meta: null,
    canToggle: false,
    view: link.skill ? 'rendered' : 'template',
    chip: null,
    dot: null,
    sentence: `${owner} text links to it at line ${at.line}.`,
    highlight: NO_HIGHLIGHT,
    bands: [],
    tabs: ['text'],
    slot: null,
    usedBy: null,
    error: null,
  };
}
