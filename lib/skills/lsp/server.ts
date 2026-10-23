import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createConnection, MarkupKind, ProposedFeatures, TextDocuments, TextDocumentSyncKind, type InitializeParams, type InitializeResult } from "vscode-languageserver/node";
import { logCliEvent } from "../../cli-logger.ts";
import { publishable } from "./diagnostics.ts";
import { hoverAt } from "./hover.ts";
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

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Speaks LSP on stdin/stdout. `createConnection` with no streams would need `--stdio` in argv, which a
 * client launching `rt skills lsp` need not pass, so the streams are handed over explicitly.
 */
export function startServer(opts: { roots: string[] }): void {
  const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
  const documents = new TextDocuments(TextDocument);
  let ws: Workspace | null = null;
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
    logCliEvent("debug", MODULE, "initialized", { roots });
    return {
      capabilities: { textDocumentSync: TextDocumentSyncKind.Incremental, hoverProvider: true },
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

  documents.listen(connection);
  connection.listen();
}
