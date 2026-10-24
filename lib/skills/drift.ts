export type DriftCause = "frontmatter" | "source" | "fill" | "include" | "structure" | "vendored" | "team";

const MARKER_RE = /^<!-- part: (step|include:\S+|section:\S+|block:\S+|prop:\S+) /;

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
  if (key === "step" || key.startsWith("block:")) return "source";
  if (key.startsWith("section:")) return "team";
  return key.startsWith("prop:") ? "fill" : "include";
}

/**
 * Parts are keyed by kind and name only, so a prop rebound to another fill is
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

const EXTENT_RE = /^<!-- part: (include:\S+|section:\S+|block:\S+|prop:\S+) .*?\bversion=(\S+) .*?\blines=(\d+)-(\d+) -->$/;
const MARKER_VERSION_RE = /^(<!-- part: .*?\bversion=)\S+/gm;
/**
 * The one line `fillReference` renders for a prop bound by reference; its seam's `lines=` spans the skill it names.
 * The second form is the line an older compile wrote, which on-disk output still carries until it recompiles.
 */
const PROP_REFERENCE_RE = /^(?:For [^,`]+, invoke the `[^`]+` skill \(|Prop \S+ is bound to `)/;

export function isPropReference(text: string): boolean {
  return PROP_REFERENCE_RE.test(text);
}

/**
 * An include part is its marker plus exactly its `lines=` count: include bodies
 * are verbatim, as are a section's. An inlined prop value's count is in SOURCE
 * lines, less any line an absent optional section dropped, and a nested include
 * or section marker stands for the one source line it replaced while carrying
 * its own body lines on top, so the walk counts the marker once and steps over
 * that body. Fill bodies are trimmed on load, so a blank line under a prop
 * marker is never fill text.
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
    if (!marker || marker.key.startsWith("block:")) continue;
    let first = i + 1;
    let last: number;
    if (marker.key.startsWith("prop:") && PROP_REFERENCE_RE.test(lines[first] ?? "")) {
      last = first;
    } else if (!marker.key.startsWith("prop:")) {
      last = i + marker.count;
    } else {
      if (lines[first]?.trim() === "") first++;
      last = first - 1;
      for (let consumed = 0; consumed < marker.count && last + 1 < lines.length; consumed++) {
        const nested = markerAt(last + 1);
        last += nested && !nested.key.startsWith("prop:") ? 1 + nested.count : 1;
      }
    }
    last = Math.min(lines.length - 1, last);
    out.push({ key: marker.key, version: marker.version, start: i, end: last, text: lines.slice(first, last + 1).join("\n") });
  }
  out.push(...blockExtents(lines, markerAt, out));
  return out.sort((x, y) => x.start - y.start);
}

/**
 * A block's text is not copied line for line (headings re-level, a graph
 * becomes dot, values and includes land inside it), so its part runs from its
 * seam to the next block's. The renderer repeats a block's seam after a
 * substitution, so repeats fold into the one part; the parts nested in it are
 * their own, and only the block's own lines are its text.
 */
function blockExtents(lines: string[], markerAt: (i: number) => { key: string; version: string } | null, nested: PartExtent[]): PartExtent[] {
  const seams = lines.flatMap((_, i) => {
    const m = markerAt(i);
    return m && m.key.startsWith("block:") ? [{ i, key: m.key, version: m.version }] : [];
  });
  const inNested = (i: number) => nested.some((x) => x.start <= i && i <= x.end);
  const out: PartExtent[] = [];
  seams.forEach((s, n) => {
    if (n > 0 && seams[n - 1]!.key === s.key) return;
    const next = seams.slice(n + 1).find((t) => t.key !== s.key);
    let end = (next?.i ?? lines.length) - 1;
    while (end > s.i && lines[end]!.trim() === "") end--;
    const own: string[] = [];
    for (let i = s.i + 1; i <= end; i++) {
      if (!inNested(i) && markerAt(i)?.key !== s.key) own.push(lines[i]!);
    }
    out.push({ key: s.key, version: s.version, start: s.i, end, text: own.join("\n").trimEnd() });
  });
  return out;
}

/** A key can own several extents (a block split by an include, an add prop's values), so its texts compare joined. */
export function changedPartKeys(onDisk: string, fresh: string): Set<string> {
  const bare = (text: string) => text.replace(MARKER_VERSION_RE, "$1");
  const texts = (md: string) => {
    const out = new Map<string, string[]>();
    for (const p of partExtents(md)) out.set(p.key, [...(out.get(p.key) ?? []), bare(p.text)]);
    return new Map([...out].map(([key, parts]) => [key, parts.join("\n")]));
  };
  const before = texts(onDisk);
  const changed = new Set<string>();
  for (const [key, text] of texts(fresh)) if (before.get(key) !== text) changed.add(key);
  return changed;
}
