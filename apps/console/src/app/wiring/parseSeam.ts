/**
 * The seams `rt skills compile` writes into a compiled SKILL.md, and the
 * split of a compiled body along them.
 *
 * rt emits five shapes, one per line, each its own paragraph:
 *
 *     <!-- part: step source=<plugin>:<name> version=<v> path=<p> lines=<a>-<b> -->
 *     <!-- part: block:<block id> source=<plugin>:<skill> version=<v> path=<p> lines=<a>-<b> -->
 *     <!-- part: prop:<block id>.<prop> binding=<fill> version=<v> path=<p> lines=<a>-<b> -->
 *     <!-- part: include:<attachment> source=<plugin>:<attachment> version=<v> path=<p> lines=<a>-<b> -->
 *     <!-- part: section:<name> source=<plugin>:pack/sections/<name>.md version=<v> path=<p> lines=1-<n> -->
 *
 * They differ in more than the kind word: a prop carries `binding=` (the fill
 * a consumer bound) while the others carry `source=` (an author-fixed
 * target). Every kind but step hides its own name inside the kind token. All
 * five are normalised to one result here so the renderer draws one thing. A
 * shared attachment split around a verb's prop emits two `include` seams
 * with the same ref and different spans, which containment attribution
 * handles as any other pair.
 */

export type SeamKind = 'step' | 'block' | 'prop' | 'include' | 'section';

export interface Seam {
  kind: SeamKind;
  /** `<block id>.<prop>` for a prop seam, the block id for a block, the
      attachment's name for an include, the section's name for a section;
      null for a step. */
  name: string | null;
  /** Whichever of `source=` / `binding=` the shape carried. */
  ref: string;
  version: string;
  path: string;
  /** 1-indexed and inclusive, as the emitter's `span()` writes it. */
  lines: [number, number];
}

const SEAM_PREFIX = '<!-- part: ';
const SEAM_SUFFIX = ' -->';
const NAMED_KINDS: readonly SeamKind[] = [
  'block',
  'prop',
  'include',
  'section',
];
/** A block id holds slashes, never dots, so a prop key splits at its last dot. */
const PROP_KEY = /^[^.]+\.[a-z][a-z0-9-]*$/;

function valueOf(token: string, key: string): string | null {
  const prefix = `${key}=`;
  if (!token.startsWith(prefix)) return null;
  const value = token.slice(prefix.length);
  return value.length > 0 ? value : null;
}

/**
 * One line in, one seam or null out. Null for anything that is not exactly a
 * seam -- the compiler header, prose, and a truncated or crossed-key seam
 * alike. Never a partly-filled result: a half-read seam heads a section with
 * the wrong provenance, which is worse than heading it with none.
 *
 * The five fields are whitespace-separated, so a source path containing a
 * space parses as null rather than as a shorter path. That is the same
 * trade: unattributed beats misattributed.
 */
export function parseSeam(line: string): Seam | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(SEAM_PREFIX) || !trimmed.endsWith(SEAM_SUFFIX))
    return null;

  const tokens = trimmed
    .slice(SEAM_PREFIX.length, -SEAM_SUFFIX.length)
    .trim()
    .split(/\s+/);
  if (tokens.length !== 5) return null;
  const [kindToken, refToken, versionToken, pathToken, linesToken] = tokens;

  let kind: SeamKind;
  let name: string | null;
  if (kindToken === 'step') {
    kind = 'step';
    name = null;
  } else {
    const colon = kindToken.indexOf(':');
    const head = kindToken.slice(0, colon) as SeamKind;
    if (colon === -1 || !NAMED_KINDS.includes(head)) return null;
    kind = head;
    name = kindToken.slice(colon + 1);
    if (!name) return null;
    if (kind === 'prop' && !PROP_KEY.test(name)) return null;
  }

  // The kind fixes which key carries the ref. Only a prop is consumer-bound
  // (`binding=`); the rest are author-fixed (`source=`). A crossed pair is a
  // shape the emitter cannot produce, so reading it would be inventing one.
  const ref = valueOf(refToken, kind === 'prop' ? 'binding' : 'source');
  const version = valueOf(versionToken, 'version');
  const path = valueOf(pathToken, 'path');
  const lines = valueOf(linesToken, 'lines');
  if (!ref || !version || !path || !lines) return null;

  const span = /^(\d+)-(\d+)$/.exec(lines);
  if (!span) return null;

  return {
    kind,
    name,
    ref,
    version,
    path,
    lines: [Number(span[1]), Number(span[2])],
  };
}

export interface CompiledSection {
  /** Null for the opening section -- the frontmatter and the compiler
      header, which no seam introduces. */
  seam: Seam | null;
  text: string;
}

/**
 * A compiled body split into the sections its seams delimit, with the seam
 * lines themselves removed: their content becomes each section's heading
 * rather than staying HTML comments in the text.
 *
 * A body with no seams still yields one section, so an errored, partial or
 * hand-authored body reaches the pane instead of rendering blank.
 */
export function splitCompiledBody(body: string): CompiledSection[] {
  const sections: CompiledSection[] = [];
  let seam: Seam | null = null;
  let lines: string[] = [];

  const flush = () => {
    const text = lines.join('\n').replace(/^\s*\n|\s+$/g, '');
    // A body that opens on a seam has no preamble; an empty section above the
    // first seam would draw an empty pane over the real content.
    if (seam === null && text === '') return;
    sections.push({ seam, text });
  };

  for (const line of body.split('\n')) {
    const parsed = parseSeam(line);
    if (!parsed) {
      lines.push(line);
      continue;
    }
    flush();
    seam = parsed;
    lines = [];
  }
  flush();

  return sections;
}
