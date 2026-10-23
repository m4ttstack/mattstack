import { parseDot } from "../../../lib/skills/blocks/dot.ts";

const SEAM_LINE = /^<!-- (?:part: .*|compiled by rt skills compile .*) -->$/;
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const SLOT_REFERENCE = /^Slot (\S+) is bound to /;

function canonicalDot(source: string): string[] {
  const { nodes, edges } = parseDot(source);
  const nodeLines = nodes.map((n) => `${n.id}|${n.label}|${n.shape}|${n.style ?? ""}`).sort();
  const edgeLines = edges.map((e) => `${e.from}|${e.to}|${e.label ?? ""}`).sort();
  return [...nodeLines, ...edgeLines];
}

function collapseBlanks(lines: string[]): string[] {
  const kept: string[] = [];
  for (const line of lines) {
    if (line.trim() === "" && (kept.length === 0 || kept[kept.length - 1] === "")) continue;
    kept.push(line.trim() === "" ? "" : line);
  }
  while (kept[kept.length - 1] === "") kept.pop();
  return kept;
}

/** Idempotent: the canonical dot listing sits in a `dot-canonical` fence, which a second pass leaves alone. */
export function normalizeCompiled(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let fence: { marker: string; info: string; body: string[] } | null = null;
  for (const line of lines) {
    if (fence) {
      const close = FENCE.exec(line);
      if (close && close[2]!.startsWith(fence.marker) && close[3]!.trim() === "") {
        if (fence.info === "dot") out.push("```dot-canonical", ...canonicalDot(fence.body.join("\n")), "```");
        else out.push(`${fence.marker}${fence.info}`, ...fence.body, line.trim());
        fence = null;
      } else fence.body.push(line);
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      fence = { marker: open[2]!, info: open[3]!.trim(), body: [] };
      continue;
    }
    if (SEAM_LINE.test(line.trim())) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      const lowered = `# ${heading[1]!.trim()}`;
      const prev = [...out].reverse().find((l) => l.trim() !== "");
      if (prev === lowered) continue;
      out.push(lowered);
      continue;
    }
    out.push(line.replace(SLOT_REFERENCE, "Prop $1 is bound to "));
  }
  if (fence) out.push(`${fence.marker}${fence.info}`, ...fence.body);
  const collapsed = collapseBlanks(out);
  return collapsed.length === 0 ? "" : `${collapsed.join("\n")}\n`;
}
