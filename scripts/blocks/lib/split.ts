import { parseDocument } from "yaml";
import { parseDot } from "../../../lib/skills/blocks/dot.ts";
import { FENCE_RE } from "../../../lib/skills/blocks/tree.ts";
import { dotToMermaid } from "./dot-to-mermaid.ts";

export type SlotMap = Record<string, { prop: string; merge: "add" | "replace"; targets?: string[] /* block ids for add; omitted = the slot's own section becomes the block */ }>;

/** `bindings` is mattstack's own `skills.jsonc` binding per slot for this engine; a replace prop takes it as its default. */
export type SplitOptions = { engine: string; slots: SlotMap; bindings?: Record<string, string> };

/** `heading` is null only for a headless root: a body with no `# ` title line. */
type Section = { level: number; heading: string | null; lead: string[]; children: Section[] };
type Headed = Section & { heading: string };

type Planned = {
  id: string;
  stem: string;
  title: string | null;
  /** Today's heading text, which a target may name when the title was rewritten. */
  heading: string | null;
  node: string | null;
  order: number | null;
  own: string[];
  folded: string[];
  added: string[];
  props: Map<string, string[]>;
  children: Planned[];
};

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const SLOT_RE = /\{\{slot:([^}\s]+)\}\}/g;
const INCLUDE_LINE_RE = /^\{\{include:[^}\s]+\}\}$/;
const TRAILING_PAREN_RE = /\s*\([^()]*\)$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Walks fences the way tree.ts does, so a `#` line inside a fence never reads as a heading. */
function fenceTracker(): (line: string) => { inFence: boolean; opens: string | null; closes: boolean } {
  let open: string | null = null;
  return (line) => {
    const m = FENCE_RE.exec(line);
    if (open === null) {
      if (m) {
        open = m[1]!;
        return { inFence: true, opens: m[2] ?? "", closes: false };
      }
      return { inFence: false, opens: null, closes: false };
    }
    if (m && m[1]![0] === open[0] && m[1]!.length >= open.length && m[2] === "") {
      open = null;
      return { inFence: true, opens: null, closes: true };
    }
    return { inFence: true, opens: null, closes: false };
  };
}

function parseSections(lines: string[]): Section {
  const root: Section = { level: 0, heading: "", lead: [], children: [] };
  const stack: Section[] = [root];
  const fence = fenceTracker();
  for (const line of lines) {
    const f = fence(line);
    const h = f.inFence ? null : HEADING_RE.exec(line);
    if (h) {
      const sec: Section = { level: h[1]!.length, heading: h[2]!, lead: [], children: [] };
      while (stack.length > 1 && stack[stack.length - 1]!.level >= sec.level) stack.pop();
      stack[stack.length - 1]!.children.push(sec);
      stack.push(sec);
    } else stack[stack.length - 1]!.lead.push(line);
  }
  const top = root.children.filter((c) => c.level === 1);
  if (top.length === 0) return { level: 1, heading: null, lead: root.lead, children: root.children };
  if (top.length !== 1 || root.children.length !== 1 || root.lead.some((l) => l.trim() !== "")) {
    throw new Error("the skill body must open with one `# <title>` line that every other section sits under, or have no `# ` line at all");
  }
  return top[0]!;
}

function trimBlank(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a]!.trim() === "") a++;
  while (b > a && lines[b - 1]!.trim() === "") b--;
  return lines.slice(a, b);
}

/** Joins chunks with one blank line between them, dropping empty ones. */
function joinChunks(chunks: string[][]): string[] {
  const out: string[] = [];
  for (const c of chunks.map(trimBlank)) {
    if (c.length === 0) continue;
    if (out.length > 0) out.push("");
    out.push(...c);
  }
  return out;
}

/** A section written inline under a block, its heading at `level` relative to the block's title. */
function inline(sec: Headed, level: number): string[] {
  const shift = level - sec.level;
  const walk = (s: Section): string[][] => [
    [`${"#".repeat(Math.min(6, s.level + shift))} ${s.heading}`, "", ...trimBlank(s.lead)],
    ...s.children.flatMap(walk),
  ];
  return joinChunks(walk(sec));
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/`/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

type DotFence = { start: number; end: number; source: string };

function dotFences(lines: string[]): DotFence[] {
  const out: DotFence[] = [];
  const fence = fenceTracker();
  let cur: DotFence | null = null;
  lines.forEach((line, i) => {
    const f = fence(line);
    if (f.opens !== null) cur = f.opens === "dot" ? { start: i, end: -1, source: "" } : null;
    else if (f.closes && cur) {
      cur.end = i;
      cur.source = lines.slice(cur.start + 1, i).join("\n");
      out.push(cur);
      cur = null;
    }
  });
  return out;
}

class Planner {
  notes: string[] = [];

  constructor(private engine: string) {}

  plan(root: Section): Planned {
    return this.block(root, this.engine, this.engine, null, null, root.heading);
  }

  private block(sec: Section, id: string, stem: string, node: string | null, order: number | null, title: string | null): Planned {
    const p: Planned = { id, stem, title, heading: sec.heading, node, order, own: [], folded: [], added: [], props: new Map(), children: [] };
    const lead = [...sec.lead];
    const fences = dotFences(lead);
    const graph = fences[0] ? parseDot(fences[0].source) : null;

    if (sec.heading === null) {
      const sections = sec.children as Headed[];
      p.own = joinChunks([lead, ...sections.map((c) => inline(c, c.level))]);
      if (sections.length > 0) {
        this.notes.push(`${id}: the body has no # title, so it is one headless block; its ${sections.length} top-level sections stay in its text as written, since a headless block cannot have children`);
      }
      if (graph) this.notes.push(`${id}: a headless block's dot graph stays a dot fence; give the block a title to convert it`);
      return p;
    }

    const ownChunks: string[][] = [];
    const used = new Set<string>();
    // index.block.md is the parent's own file, so no child may take the stem.
    const stems = new Set<string>(["index"]);
    const stemFor = (want: string): string => {
      let s = want;
      for (let n = 2; stems.has(s); n++) s = `${want}-${n}`;
      if (s !== want) this.notes.push(`${id}/${s}: renamed from ${want}, which a sibling already takes`);
      stems.add(s);
      return s;
    };
    let lastNode: Planned | null = null;
    let nextOrder = 1;
    const nodeOf = (heading: string | null, note = false): { id: string; label: string } | null => {
      if (!graph) return null;
      const free = graph.nodes.filter((n) => !used.has(n.id));
      const exact = free.filter((n) => n.label === heading);
      if (exact.length > 0) {
        if (note && exact.length > 1) this.notes.push(`${id}: "${heading}" matches ${exact.length} nodes; tied to the first, ${exact[0]!.id}`);
        return exact[0]!;
      }
      const loose = free.filter((n) => n.label.replace(TRAILING_PAREN_RE, "") === heading);
      if (loose.length === 1) return loose[0]!;
      if (note && loose.length > 1) this.notes.push(`${id}: "${heading}" matches ${loose.map((n) => n.id).join(", ")} once their trailing parentheticals drop; tied to none`);
      return null;
    };

    const nested = (c: Section): Section[] => c.children.flatMap((d) => [...(nodeOf(d.heading) ? [d] : []), ...nested(d)]);
    const misplaced = (c: Section): string => {
      const found = nested(c).length;
      return found === 0 ? "" : `; it holds ${found} sections matching nodes of the graph one level too deep, so move the graph or the sections by hand`;
    };

    const children = sec.children as Headed[];
    children.forEach((c, i) => {
      const hit = nodeOf(c.heading, true);
      if (hit) {
        used.add(hit.id);
        const s = stemFor(hit.id.replace(/_/g, "-"));
        if (hit.label !== c.heading) this.notes.push(`${id}/${s}: heading "${c.heading}" rewritten to its node label "${hit.label}"`);
        lastNode = this.block(c, `${id}/${s}`, s, hit.id, null, hit.label);
        p.children.push(lastNode);
        return;
      }
      if (!graph) {
        if (c.level === 2) {
          const s = stemFor(slug(c.heading));
          p.children.push(this.block(c, `${id}/${s}`, s, null, nextOrder++, c.heading));
        } else ownChunks.push(inline(c, 1 + c.level - sec.level));
        return;
      }
      const nodeFollows = children.slice(i + 1).some((later) => nodeOf(later.heading) !== null);
      const prev = lastNode as Planned | null;
      if (c.level === 2 && !nodeFollows) {
        const s = stemFor(slug(c.heading));
        p.children.push(this.block(c, `${id}/${s}`, s, null, nextOrder++, c.heading));
        const why = misplaced(c);
        if (why) this.notes.push(`${id}/${s}: "${c.heading}" became its own block${why}`);
      } else if (prev === null) {
        ownChunks.push(inline(c, 1 + c.level - sec.level));
        this.notes.push(`${id}: "${c.heading}" comes before every node section, so it stays in ${id}'s own text${misplaced(c) || "; it ties to no node"}`);
      } else {
        prev.folded = joinChunks([prev.folded, inline(c, 2)]);
        this.notes.push(`${prev.id}: folded "${c.heading}" in as a sub-heading${misplaced(c) || "; it ties to no node"}`);
      }
    });

    if (graph && fences[0]) {
      const f = fences[0];
      const omitLabels = new Set(p.children.filter((c) => c.node !== null).map((c) => c.node!));
      const { mermaid } = dotToMermaid(f.source, { omitLabels });
      lead.splice(f.start, f.end - f.start + 1, "```mermaid", ...mermaid.split("\n"), "```");
    }
    p.own = joinChunks([lead, ...ownChunks]);
    if (dotFences(p.own).length > 0) {
      this.notes.push(`${id}: a dot graph stays a dot fence (only the first graph in a section's own text converts, and a block holds one); convert or move it by hand`);
    }
    if (node !== null && p.own.some((l) => INCLUDE_LINE_RE.test(l.trim()))) {
      this.notes.push(`${id}: an {{include:...}} line sits in this node block's text; check it belongs to the step and not to its parent`);
    }
    return p;
  }
}

function walkPlanned(p: Planned): Planned[] {
  return [p, ...p.children.flatMap(walkPlanned)];
}

function splitFrontmatter(raw: string): { fm: string; body: string; parsed: Record<string, unknown> } {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) return { fm: "", body: raw, parsed: {} };
  const parsed = parseDocument(m[1]!).toJS() as Record<string, unknown> | null;
  return { fm: m[1]!, body: raw.slice(m[0].length), parsed: parsed ?? {} };
}

/** Drops the `slots:` key and its indented lines, keeping every other line as written. */
function withoutSlots(fm: string): string[] {
  const out: string[] = [];
  let skipping = false;
  for (const line of fm.split(/\r?\n/)) {
    if (/^slots\s*:/.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && (/^\s/.test(line) || line === "")) continue;
    skipping = false;
    out.push(line);
  }
  return out;
}

function planFor(raw: string, engine: string): { tree: Planned; notes: string[]; fm: string; parsed: Record<string, unknown> } {
  const { fm, body, parsed } = splitFrontmatter(raw);
  const planner = new Planner(engine);
  const tree = planner.plan(parseSections(body.split(/\r?\n/)));
  return { tree, notes: planner.notes, fm, parsed };
}

/** Every block id the split would make, by its title and by today's heading text. */
export function blockIdsByTitle(raw: string, opts: { engine: string }): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (k: string, id: string) => {
    const ids = out.get(k) ?? [];
    if (!ids.includes(id)) out.set(k, [...ids, id]);
  };
  for (const b of walkPlanned(planFor(raw, opts.engine).tree)) {
    if (b.title !== null) add(b.title, b.id);
    if (b.heading !== null) add(b.heading, b.id);
  }
  return out;
}

function propSpec(name: string, merge: "add" | "replace", slot: { contract?: string; required?: boolean } | undefined, binding: string | undefined): string[] {
  const lines = [`  ${name}:`, `    merge: ${merge}`];
  if (merge === "add") lines.push(`    default: ""`);
  else {
    if (binding !== undefined) lines.push(`    default: ${JSON.stringify(binding)}`);
    else if (slot?.required !== true) lines.push(`    default: ""`);
    if (slot?.contract) lines.push(`    contract: ${JSON.stringify(slot.contract)}`);
  }
  return lines;
}

function blockFile(b: Planned, fmLines: string[]): string {
  const fm = [...fmLines];
  if (b.node !== null) fm.push(`node: ${b.node}`);
  if (b.order !== null) fm.push(`order: ${b.order}`);
  if (b.props.size > 0) fm.push("props:", ...[...b.props.values()].flat());
  const body = joinChunks([b.title === null ? [] : [`# ${b.title}`], b.own, b.added, b.folded]);
  return [...(fm.length > 0 ? ["---", ...fm, "---", ""] : []), ...body, ""].join("\n");
}

function filePaths(p: Planned, dir: string | null, out: Map<Planned, string>): void {
  if (dir !== null && p.children.length === 0) {
    out.set(p, `${dir}${p.stem}.block.md`);
    return;
  }
  const here = dir === null ? "" : `${dir}${p.stem}/`;
  out.set(p, `${here}index.block.md`);
  for (const c of p.children) filePaths(c, here, out);
}

export function splitSkill(raw: string, opts: SplitOptions): { files: Record<string, string>; notes: string[] } {
  const { tree, notes, fm, parsed } = planFor(raw, opts.engine);
  const declared = (parsed.slots ?? {}) as Record<string, { contract?: string; required?: boolean }>;
  const blocks = walkPlanned(tree);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const placed = new Set<string>();

  for (const b of blocks) {
    for (const part of [b.own, b.folded]) {
      part.forEach((line, i) => {
        if (!line.includes("{{slot:")) return;
        part[i] = line.replace(SLOT_RE, (_, name: string) => {
          const map = opts.slots[name];
          if (!map) throw new Error(`${b.id}: {{slot:${name}}} has no entry in the slot map; pass --slot ${name}=<prop>:add|replace`);
          b.props.set(map.prop, propSpec(map.prop, map.merge, declared[name], opts.bindings?.[name]));
          placed.add(name);
          return `{{props.${map.prop}}}`;
        });
        if (line.trim() !== part[i]!.trim() && !/^\{\{slot:[^}\s]+\}\}$/.test(line.trim())) {
          notes.push(`${b.id}: a {{slot:...}} shares its line with other text; a {{props.x}} marker must sit alone on its line, so move it by hand`);
        }
      });
    }
  }

  for (const [name, map] of Object.entries(opts.slots)) {
    if (!placed.has(name) && name in declared) notes.push(`slot ${name} is declared but its {{slot:${name}}} marker is nowhere in the body`);
    for (const target of map.targets ?? []) {
      const b = byId.get(target);
      if (!b) throw new Error(`slot ${name}: target block ${target} is not in the split; the ids are ${blocks.map((x) => x.id).join(", ")}`);
      if (b.props.has(map.prop)) continue;
      b.props.set(map.prop, propSpec(map.prop, map.merge, declared[name], opts.bindings?.[name]));
      b.added = joinChunks([b.added, [`{{props.${map.prop}}}`]]);
    }
  }

  const rootFm = withoutSlots(fm);
  const slotNames = Object.keys(declared);
  if (slotNames.length > 0) rootFm.push(`replaced-slots: [${slotNames.join(", ")}]`);

  const paths = new Map<Planned, string>();
  filePaths(tree, null, paths);
  const files: Record<string, string> = {};
  for (const b of blocks) files[paths.get(b)!] = blockFile(b, b === tree ? rootFm : []);
  return { files, notes };
}
