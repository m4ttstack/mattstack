/**
 * Reads `git clone --progress` output. Only git's own English phase names
 * count: a translated or older git's lines read as no progress, so the
 * clone runs on with no bar rather than a bar labelled with a guess.
 */

export interface GitProgress {
  label: string;
  percent: number;
  note?: string;
}

const PHASES = new Set(["Receiving objects", "Resolving deltas", "Updating files", "Checking out files", "Unpacking objects"]);
const LINE = /^([A-Za-z ]+):\s+(\d{1,3})% \(\d+\/\d+\)(?:,\s*(.*))?$/;
/** Any counted line, the remote's own phases included: none of it explains a failed clone. */
export const PROGRESS_SHAPE = /\d{1,3}% \(\d+\/\d+\)/;
/** The server's counting that `--progress` turns on. Only these exact shapes: other `remote:` lines carry auth and not-found errors. */
export const REMOTE_COUNTING = /^remote: (?:Enumerating objects: \d+, done\.|Total \d+ \(delta \d+\), reused \d+)/;

export function parseGitProgress(line: string): GitProgress | null {
  const match = LINE.exec(line.trim());
  if (!match || !PHASES.has(match[1]!)) return null;
  const percent = Number(match[2]);
  if (percent > 100) return null;
  const note = (match[3] ?? "")
    .replace(/,?\s*done\.$/, "")
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" · ");
  return { label: match[1]!, percent, ...(note ? { note } : {}) };
}

export function splitProgressLines(chunk: string): string[] {
  return chunk.split(/\r\n|\r|\n/).filter((line) => line.length > 0);
}
