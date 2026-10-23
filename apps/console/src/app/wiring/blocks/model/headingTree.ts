import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const SUMMARY_MAX = 160;

type Heading = { level: number; title: string; line: number };

/** rt's `plain`: markdown's inline marks dropped, whitespace collapsed. */
function plain(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first sentence of the first paragraph, as rt's `summaryOf` cuts it. */
function summaryOf(lines: string[]): string {
  let fence: string | null = null;
  const para: string[] = [];
  for (const line of lines) {
    const open = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (open && open[0] === fence[0]) fence = null;
      continue;
    }
    if (open) {
      if (para.length > 0) break;
      fence = open;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('<!--') || HEADING.test(trimmed)) {
      if (para.length > 0) break;
      continue;
    }
    para.push(trimmed);
  }
  const flat = plain(para.join(' '));
  const sentence = /^(.+?[.!?])(?=\s|$)/.exec(flat)?.[1] ?? flat;
  if (sentence.length <= SUMMARY_MAX) return sentence;
  const cut = sentence.slice(0, SUMMARY_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function slugOf(title: string): string {
  return (
    plain(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

/** The closing `---` of a leading frontmatter block, or -1. */
function frontmatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return -1;
  return lines.findIndex((line, i) => i > 0 && line.trim() === '---');
}

function descriptionOf(frontmatter: string[]): string | null {
  for (const line of frontmatter) {
    const value = /^description:\s*(.*)$/.exec(line)?.[1]?.trim();
    if (value) return value.replace(/^(['"])(.*)\1$/, '$2');
  }
  return null;
}

function headingsOf(lines: string[], from: number): Heading[] {
  const headings: Heading[] = [];
  let fence: string | null = null;
  for (let i = from; i < lines.length; i++) {
    const open = FENCE.exec(lines[i])?.[1];
    if (fence !== null) {
      if (open && open[0] === fence[0]) fence = null;
      continue;
    }
    if (open) {
      fence = open;
      continue;
    }
    const match = HEADING.exec(lines[i]);
    if (match) {
      headings.push({ level: match[1].length, title: match[2], line: i + 1 });
    }
  }
  return headings;
}

function blockOf(
  fields: Pick<PayloadBlock, 'id' | 'parentId' | 'depth' | 'title'> & {
    label: string;
    path: string;
    lines: [number, number];
    body: string[];
    summary?: string;
  }
): PayloadBlock {
  const text = fields.body.join('\n').trim();
  return {
    id: fields.id,
    parentId: fields.parentId,
    depth: fields.depth,
    title: fields.title,
    label: fields.label,
    kind: 'note',
    path: fields.path,
    relPath: fields.path,
    lines: fields.lines,
    summary: fields.summary ?? summaryOf(fields.body),
    text,
    segments:
      text === ''
        ? []
        : [{ layer: 'default', color: 'mattstack', prop: null, text }],
    props: [],
    node: null,
    order: null,
    headless: false,
    renderedLines: fields.lines,
  };
}

/**
 * A hand-written SKILL.md as a read-only block tree: one note block per
 * heading section, nested by heading level under a root named for the skill.
 * A lone top-level `#` heading is the root's own title. Line numbers count
 * the frontmatter, so they point into the file as it is on disk.
 */
export function headingTree(
  skillMd: string,
  skill: string,
  path = ''
): BlocksPayload {
  const lines = skillMd.split('\n');
  const fmEnd = frontmatterEnd(lines);
  const bodyStart = fmEnd + 1;
  const headings = headingsOf(lines, bodyStart);
  const topLevel = headings.filter(heading => heading.level === 1);
  const rootHeading =
    headings[0]?.level === 1 && topLevel.length === 1 ? headings[0] : null;
  const sections = headings.filter(heading => heading !== rootHeading);

  const endOf = (index: number) =>
    index + 1 < headings.length ? headings[index + 1].line - 1 : lines.length;
  const rootEnd =
    sections.length > 0 ? sections[0].line - 1 : Math.max(lines.length, 1);

  const root = blockOf({
    id: skill,
    parentId: null,
    depth: 0,
    title: rootHeading?.title ?? skill,
    label: rootHeading ? plain(rootHeading.title) : skill,
    path,
    lines: [bodyStart + 1, rootEnd],
    body: lines.slice(bodyStart, rootEnd),
    summary:
      descriptionOf(lines.slice(1, Math.max(fmEnd, 1))) ??
      summaryOf(lines.slice(bodyStart, rootEnd)),
  });

  const blocks: PayloadBlock[] = [root];
  const stack: { level: number; block: PayloadBlock }[] = [];
  const taken = new Set<string>([root.id]);
  for (const heading of sections) {
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]?.block ?? root;
    const base = `${parent.id}/${slugOf(heading.title)}`;
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    const end = endOf(headings.indexOf(heading));
    const block = blockOf({
      id,
      parentId: parent.id,
      depth: parent.depth + 1,
      title: heading.title,
      label: plain(heading.title),
      path,
      lines: [heading.line, end],
      body: lines.slice(heading.line - 1, end),
    });
    blocks.push(block);
    stack.push({ level: heading.level, block });
  }

  return {
    pack: '',
    skill,
    kind: 'verb',
    engineRef: '',
    dir: '',
    layers: [],
    blocks,
    graphs: [],
    includes: [],
    lines: [],
  };
}
