import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CompletionItemKind,
  createConnection,
  LSPErrorCodes,
  MarkupKind,
  ProposedFeatures,
  ResponseError,
  TextDocuments,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node";
import { logCliEvent } from "../../cli-logger.ts";
import { completionsAt, type Completion } from "./completion.ts";
import { definitionAt } from "./definition.ts";
import { publishable } from "./diagnostics.ts";
import { hoverAt } from "./hover.ts";
import { referencesAt, toLocations } from "./references.ts";
import { prepareRename, RenameRefused, renameAt } from "./rename.ts";
import { Workspace } from "./workspace.ts";

export const DOCUMENT_SELECTOR = [{ pattern: "**/*.block.md" }, { pattern: "**/skills.jsonc" }];

const MODULE = "skills-lsp";

export function isSkillFile(file: string): boolean {
  return file.endsWith(".block.md") || basename(file) === "skills.jsonc";
}

function pathOf(uri: string): string | null {
  if (!uri.startsWith("file:")) return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

/** `--root` wins; else the client's workspace folders, else its root uri. */
export function rootsFrom(given: string[], params: Pick<InitializeParams, "workspaceFolders" | "rootUri">): string[] {
  if (given.length > 0) return given;
  const uris = params.workspaceFolders?.map((f) => f.uri) ?? (params.rootUri ? [params.rootUri] : []);
  return uris.map(pathOf).filter((p): p is string => p !== null);
}

export const COMPLETION_TRIGGERS = [".", ":", '"', "/"];

const ITEM_KIND: Record<Completion["kind"], CompletionItemKind> = {
  prop: CompletionItemKind.Property,
  include: CompletionItemKind.Module,
  contract: CompletionItemKind.Interface,
  block: CompletionItemKind.Class,
  value: CompletionItemKind.Value,
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Speaks LSP on stdin/stdout. `createConnection` with no streams would need `--stdio` in argv, which a
 * client launching `rt skills lsp` need not pass, so the streams are handed over explicitly.
 */
export function startServer(opts: { roots: string[] }): void {
  const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
  const documents = new TextDocuments(TextDocument);
  let ws: Workspace | null = null;
  let fileRenames = false;
  const published = new Set<string>();

  const send = (file: string, diagnostics: ReturnType<typeof publishable>) => {
    connection.sendDiagnostics({ uri: pathToFileURL(file).href, diagnostics }).catch((err: unknown) => {
      logCliEvent("error", MODULE, "sending diagnostics failed", { file, error: errorText(err) });
    });
  };

  const publishAll = (update: (ws: Workspace) => void = () => {}) => {
    if (!ws) return;
    const current = ws;
    try {
      update(current);
      const files = new Set(current.analysis().diagnostics.keys());
      for (const file of files) send(file, publishable(current, file));
      for (const file of published) {
        if (!files.has(file)) send(file, []);
      }
      published.clear();
      for (const file of files) published.add(file);
    } catch (err) {
      logCliEvent("error", MODULE, "publishing diagnostics failed", { error: errorText(err) });
    }
  };

  connection.onInitialize((params): InitializeResult => {
    const roots = rootsFrom(opts.roots, params);
    ws = new Workspace(roots);
    fileRenames = params.capabilities.workspace?.workspaceEdit?.resourceOperations?.includes("rename") ?? false;
    logCliEvent("debug", MODULE, "initialized", { roots });
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
        completionProvider: { triggerCharacters: COMPLETION_TRIGGERS },
      },
      serverInfo: { name: "rt skills lsp" },
    };
  });

  connection.onInitialized(() => publishAll());

  documents.onDidChangeContent(({ document }) => {
    const file = pathOf(document.uri);
    if (!ws || !file || !isSkillFile(file)) return;
    publishAll((current) => current.change(file, document.getText()));
  });

  documents.onDidClose(({ document }) => {
    const file = pathOf(document.uri);
    if (!ws || !file || !isSkillFile(file)) return;
    publishAll((current) => current.close(file));
  });

  connection.onHover(({ textDocument, position }) => {
    const file = pathOf(textDocument.uri);
    if (!ws || !file || !isSkillFile(file)) return null;
    const hover = hoverAt(ws, file, position);
    return hover && { contents: { kind: MarkupKind.Markdown, value: hover.contents }, range: hover.range };
  });

  connection.onDefinition(({ textDocument, position }) => {
    const file = pathOf(textDocument.uri);
    if (!ws || !file || !isSkillFile(file)) return [];
    return definitionAt(ws, file, position);
  });

  connection.onReferences(({ textDocument, position, context }) => {
    const file = pathOf(textDocument.uri);
    if (!ws || !file || !isSkillFile(file)) return [];
    return toLocations(referencesAt(ws, file, position), context.includeDeclaration);
  });

  connection.onPrepareRename(({ textDocument, position }) => {
    const file = pathOf(textDocument.uri);
    if (!ws || !file || !isSkillFile(file)) return null;
    try {
      return prepareRename(ws, file, position, { fileRenames });
    } catch (err) {
      if (err instanceof RenameRefused) return new ResponseError(LSPErrorCodes.RequestFailed, err.message);
      logCliEvent("error", MODULE, "prepare rename failed", { file, error: errorText(err) });
      return null;
    }
  });

  connection.onRenameRequest(({ textDocument, position, newName }) => {
    const file = pathOf(textDocument.uri);
    if (!ws || !file || !isSkillFile(file)) return null;
    let edit;
    try {
      edit = renameAt(ws, file, position, newName, { fileRenames });
    } catch (err) {
      if (err instanceof RenameRefused) return new ResponseError(LSPErrorCodes.RequestFailed, err.message);
      logCliEvent("error", MODULE, "rename failed", { file, error: errorText(err) });
      return null;
    }
    if (!edit) return null;
    const { changes, documentChanges, warnings } = edit;
    setImmediate(() => {
      for (const warning of warnings) {
        Promise.resolve(connection.window.showWarningMessage(warning)).catch((err: unknown) => {
          logCliEvent("error", MODULE, "showing a rename warning failed", { error: errorText(err) });
        });
      }
    });
    return documentChanges ? { documentChanges } : { changes };
  });

  connection.onCompletion(({ textDocument, position }) => {
    const file = pathOf(textDocument.uri);
    if (!ws || !file || !isSkillFile(file)) return [];
    return completionsAt(ws, file, position).map((c) => ({
      label: c.label,
      kind: ITEM_KIND[c.kind],
      filterText: c.label,
      ...(c.detail === undefined ? {} : { detail: c.detail }),
      ...(c.range === undefined ? {} : { textEdit: { range: c.range, newText: c.insertText ?? c.label } }),
    }));
  });

  documents.listen(connection);
  connection.listen();
}
