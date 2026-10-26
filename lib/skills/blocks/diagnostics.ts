/** `fix` replaces `length` characters from line:col with `text`. */
export type BlockFix = { length: number; text: string };

export type BlockDiagnostic = { file: string; line: number; col: number; message: string; code: string; fix?: BlockFix };

export class BlockError extends Error {
  diagnostics: BlockDiagnostic[];

  constructor(diagnostics: BlockDiagnostic[]) {
    super(diagnostics.map(formatDiagnostic).join("\n"));
    this.name = "BlockError";
    this.diagnostics = diagnostics;
  }
}

export function formatDiagnostic(d: BlockDiagnostic): string {
  return `${d.file}:${d.line}:${d.col}: ${d.message}`;
}
