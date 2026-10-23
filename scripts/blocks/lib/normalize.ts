import { parseDot, splitStatements } from "../../../lib/skills/blocks/dot.ts";

const SEAM_LINE = /^<!-- (?:part: .*|compiled by rt skills compile .*) -->$/;
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const SLOT_REFERENCE = /^Slot (\S+) is bound to /;
const GRAPH_LEVEL = /^(?:(?:graph|node|edge)\s*\[.*\]|[\w-]+\s*=\s*.+)$/s;

/**
 * Sorted node lines (id, label, shape, style, fillcolor, fontcolor), edge
 * lines (from, to, label, style) and graph-level attribute statements
 * (`rankdir=LR`, `graph [...]`, `node [...]`, `edge [...]`), which parseDot
 * drops and so are read from the statements directly.
 */
function canonicalDot(source: string): string[] {
  const { nodes, edges } = parseDot(source);
  const nodeLines = nodes.map((n) => `${n.id}|${n.label}|${n.shape}|${n.style ?? ""}|${n.fillcolor ?? ""}|${n.fontcolor ?? ""}`).sort();
  const edgeLines = edges.map((e) => `${e.from}|${e.to}|${e.label ?? ""}|${e.style ?? ""}`).sort();
  const graphLines = splitStatements(source)
    .filter((s) => !/^(?:strict\s+)?(?:di)?graph\b/.test(s) && GRAPH_LEVEL.test(s))
    .map((s) => `graph|${s.replace(/\s+/g, " ")}`)
    .sort();
  return [...nodeLines, ...edgeLines, ...graphLines];
}

/** True for every line inside a code fence, so blank-line collapsing can leave those alone. */
export function fencedLines(lines: string[]): boolean[] {
  const mask: boolean[] = [];
  let marker: string | null = null;
  for (const line of lines) {
    const f = FENCE.exec(line);
    if (marker === null) {
      mask.push(false);
      if (f) marker = f[2]!;
    } else if (f && f[2]!.startsWith(marker) && f[3]!.trim() === "") {
      mask.push(false);
      marker = null;
    } else mask.push(true);
  }
  return mask;
}

/**
 * A fence's body, indentation and blank lines compare as written. Prose
 * headings all lower to "#", and a heading that repeats the one just above
 * it at the same or a shallower level is dropped (the include case is
 * `## T` then `# T`); a deeper same-titled heading stays, so the output is
 * not a fixed point of a second pass.
 */
export function normalizeCompiled(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let fence: { indent: string; marker: string; info: string; body: string[] } | null = null;
  let lastHeading: { level: number; title: string } | null = null;
  const prose = (line: string) => {
    if (line.trim() === "") {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      return;
    }
    out.push(line);
    lastHeading = null;
  };
  for (const line of lines) {
    if (fence) {
      const close = FENCE.exec(line);
      if (close && close[2]!.startsWith(fence.marker) && close[3]!.trim() === "") {
        if (fence.info === "dot") out.push(`${fence.indent}\`\`\`dot-canonical`, ...canonicalDot(fence.body.join("\n")), `${fence.indent}\`\`\``);
        else out.push(`${fence.indent}${fence.marker}${fence.info}`, ...fence.body, line);
        fence = null;
      } else fence.body.push(line);
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      fence = { indent: open[1]!, marker: open[2]!, info: open[3]!.trim(), body: [] };
      lastHeading = null;
      continue;
    }
    if (SEAM_LINE.test(line.trim())) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const title = heading[2]!.trim();
      const above = lastHeading as { level: number; title: string } | null;
      if (above && above.title === title && level <= above.level) continue;
      out.push(`# ${title}`);
      lastHeading = { level, title };
      continue;
    }
    prose(line.replace(SLOT_REFERENCE, "Prop $1 is bound to "));
  }
  if (fence) out.push(`${fence.indent}${fence.marker}${fence.info}`, ...fence.body);
  while (out[out.length - 1] === "") out.pop();
  return out.length === 0 ? "" : `${out.join("\n")}\n`;
}
