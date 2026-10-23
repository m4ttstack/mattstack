import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver";
import { rangeOf } from "./positions.ts";
import type { Workspace } from "./workspace.ts";

export const SOURCE = "skill-blocks";

export function publishable(ws: Workspace, file: string): Diagnostic[] {
  const found = ws.analysis().diagnostics.get(file) ?? [];
  if (found.length === 0) return [];
  const text = ws.text(file);
  return found.map((d) => ({ range: rangeOf(d, text), severity: DiagnosticSeverity.Error, source: SOURCE, code: d.code, message: d.message }));
}
