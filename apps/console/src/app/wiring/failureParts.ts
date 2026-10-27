/** One finding about a file: what rt says, and the line it names. */
export interface FailureFinding {
  text: string;
  line: string | null;
}

/** rt's failure text, in the order it printed it: plain lines, and runs of
    findings about the same file under that file's path. */
export type FailureBlock =
  | { kind: 'text'; text: string }
  | { kind: 'file'; path: string; findings: FailureFinding[] };

export interface FailureParts {
  blocks: FailureBlock[];
  next: string | null;
}

// `<path>: <what>`, where the path holds a slash and no space.
const FINDING = /^(\S*\/\S*):\s+(.+)$/;
const LINE = /^(.*?)\s*\(line (\d+)\)$/;

/** rt prints a failure as its title, then `why:`, `next:` and detail lines
    indented two spaces, so the command can sit mid-text. */
export function failureParts(message: string): FailureParts {
  const blocks: FailureBlock[] = [];
  let next: string | null = null;
  for (const raw of message.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const command = /^next:\s*(.*)$/.exec(line);
    if (command && next === null) {
      next = command[1];
      continue;
    }
    const finding = FINDING.exec(line);
    if (!finding) {
      blocks.push({ kind: 'text', text: line.replace(/^why:\s*/, '') });
      continue;
    }
    const [, path, what] = finding;
    const numbered = LINE.exec(what);
    const item = numbered
      ? { text: numbered[1], line: numbered[2] }
      : { text: what, line: null };
    const last = blocks.at(-1);
    if (last?.kind === 'file' && last.path === path) last.findings.push(item);
    else blocks.push({ kind: 'file', path, findings: [item] });
  }
  return { blocks, next };
}
