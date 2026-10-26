import { pathToFileURL } from "node:url";
import type { Diagnostic } from "vscode-languageserver";
import { logCliEvent } from "../../cli-logger.ts";
import { toDiagnostic } from "./diagnostics.ts";
import type { Position, Range } from "./positions.ts";
import type { TextEdit } from "./rename.ts";
import type { Workspace } from "./workspace.ts";

export type QuickFix = { title: string; edit: { changes: Record<string /* uri */, TextEdit[]> }; diagnostic: Diagnostic };

const MODULE = "skills-lsp";

const before = (a: Position, b: Position) => a.line < b.line || (a.line === b.line && a.character < b.character);
const overlaps = (a: Range, b: Range) => !before(a.end, b.start) && !before(b.end, a.start);

/** One quick fix per hand-typed path in `range` that compile could rewrite; a path with no fix gets none. */
export function codeActionsAt(ws: Workspace, file: string, range: Range): QuickFix[] {
  try {
    const found = ws.analysis().diagnostics.get(file) ?? [];
    const text = ws.text(file);
    const uri = pathToFileURL(file).href;
    return found.flatMap((d) => {
      if (d.code !== "hand-typed-path" || !d.fix) return [];
      const diagnostic = toDiagnostic(d, text);
      if (!overlaps(diagnostic.range, range)) return [];
      return [{ title: `Use ${d.fix.text}`, edit: { changes: { [uri]: [{ range: diagnostic.range, newText: d.fix.text }] } }, diagnostic }];
    });
  } catch (err) {
    logCliEvent("error", MODULE, "code actions failed", { file, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}
