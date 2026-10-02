export type DriftCause = "frontmatter" | "source" | "fill" | "include" | "structure" | "vendored";

const MARKER_RE = /^<!-- part: (step|slot:\S+|include:\S+) /;

function splitParts(md: string): { key: string; text: string }[] {
  const parts = [{ key: "frontmatter", text: "" }];
  for (const line of md.split("\n")) {
    const marker = MARKER_RE.exec(line);
    if (marker) parts.push({ key: marker[1]!, text: "" });
    parts[parts.length - 1]!.text += `${line}\n`;
  }
  return parts;
}

function causeOf(key: string): DriftCause {
  if (key === "frontmatter") return "frontmatter";
  if (key === "step") return "source";
  return key.startsWith("slot:") ? "fill" : "include";
}

/**
 * Parts are keyed by kind and name only, so a slot rebound to another fill is
 * a fill change rather than a structural one; a changed part list is
 * structural because the parts can no longer be paired.
 *
 * A part runs from its own marker to the next one, flat -- so prose a fill
 * appends after its own inlined `{{include}}` line has no marker of its own
 * and lands inside that include's part, attributing the fill's edit to the
 * include instead.
 */
export function skillMdDriftCauses(onDisk: string, expected: string): DriftCause[] {
  const before = splitParts(onDisk);
  const after = splitParts(expected);
  if (before.length !== after.length || before.some((p, i) => p.key !== after[i]!.key)) return ["structure"];
  const causes: DriftCause[] = [];
  before.forEach((p, i) => {
    if (p.text === after[i]!.text) return;
    const cause = causeOf(p.key);
    if (!causes.includes(cause)) causes.push(cause);
  });
  return causes;
}

export type PartExtent = { key: string; version: string | null; start: number; end: number; text: string };

const EXTENT_RE = /^<!-- part: (slot:\S+|include:\S+) .*?\bversion=(\S+) .*?\blines=(\d+)-(\d+) -->$/;
const MARKER_VERSION_RE = /^(<!-- part: .*?\bversion=)\S+/gm;

/**
 * An include part is its marker plus exactly its `lines=` count: include bodies
 * are verbatim. A slot's count is in SOURCE lines, and a nested include marker
 * stands for the one `{{include}}` line it replaced while carrying its own body
 * lines on top, so the walk counts the marker once and steps over that body.
 * The legacy engine also puts one blank separator between a slot marker and its
 * fill; fill bodies are trimmed on load, so a blank there is never fill text.
 */
export function partExtents(md: string): PartExtent[] {
  const lines = md.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const markerAt = (i: number) => {
    const m = EXTENT_RE.exec(lines[i]!);
    return m ? { key: m[1]!, version: m[2]!, count: Number(m[4]) - Number(m[3]) + 1 } : null;
  };
  const out: PartExtent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const marker = markerAt(i);
    if (!marker) continue;
    let first = i + 1;
    let last: number;
    if (marker.key.startsWith("include:")) {
      last = i + marker.count;
    } else {
      if (lines[first]?.trim() === "") first++;
      last = first - 1;
      for (let consumed = 0; consumed < marker.count && last + 1 < lines.length; consumed++) {
        const nested = markerAt(last + 1);
        last += nested?.key.startsWith("include:") ? 1 + nested.count : 1;
      }
    }
    last = Math.min(lines.length - 1, last);
    out.push({ key: marker.key, version: marker.version, start: i, end: last, text: lines.slice(first, last + 1).join("\n") });
  }
  return out;
}

export function changedPartKeys(onDisk: string, fresh: string): Set<string> {
  const bare = (text: string) => text.replace(MARKER_VERSION_RE, "$1");
  const before = new Map(partExtents(onDisk).map((p) => [p.key, bare(p.text)]));
  const changed = new Set<string>();
  for (const p of partExtents(fresh)) if (before.get(p.key) !== bare(p.text)) changed.add(p.key);
  return changed;
}
