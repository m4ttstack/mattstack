export type BlockDiagnostic = { file: string; line: number; col: number; message: string; code: string };

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
