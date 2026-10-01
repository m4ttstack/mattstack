export const TRACE_MAX_BYTES = 64 * 1024;
const ANSI_ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export type TraceMode =
  | { kind: "tail"; lines: number }
  | { kind: "head"; lines: number }
  | { kind: "range"; from: number; count: number }
  | { kind: "grep"; pattern: string; context: number };

function capBytes(text: string, keep: "start" | "end"): { text: string; cut: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= TRACE_MAX_BYTES) return { text, cut: false };
  if (keep === "start") {
    let end = TRACE_MAX_BYTES;
    // A cut inside a multi-byte character would decode as a replacement character.
    while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
    return { text: bytes.subarray(0, end).toString("utf8"), cut: true };
  }
  let start = bytes.length - TRACE_MAX_BYTES;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return { text: bytes.subarray(start).toString("utf8"), cut: true };
}

export function sliceTrace(raw: string, mode: TraceMode): { trace: string; truncated: boolean; totalLines: number } {
  const lines = raw.replace(ANSI_ESCAPES, "").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const totalLines = lines.length;
  let kept: string[];
  if (mode.kind === "tail") kept = lines.slice(-mode.lines);
  else if (mode.kind === "head") kept = lines.slice(0, mode.lines);
  else if (mode.kind === "range") kept = lines.slice(mode.from - 1, mode.from - 1 + mode.count);
  else {
    const needle = mode.pattern.toLowerCase();
    const wanted = new Set<number>();
    lines.forEach((line, i) => {
      if (!line.toLowerCase().includes(needle)) return;
      for (let j = Math.max(0, i - mode.context); j <= Math.min(totalLines - 1, i + mode.context); j++) wanted.add(j);
    });
    kept = [];
    let prev = -2;
    for (const i of [...wanted].sort((a, b) => a - b)) {
      if (prev >= 0 && i !== prev + 1) kept.push("--");
      kept.push(`${i + 1}: ${lines[i]}`);
      prev = i;
    }
  }
  const whole = mode.kind !== "grep" && kept.length === totalLines;
  const capped = capBytes(kept.join("\n"), mode.kind === "tail" ? "end" : "start");
  return { trace: capped.text, truncated: capped.cut || !whole, totalLines };
}
