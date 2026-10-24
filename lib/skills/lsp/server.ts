import { basename, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CodeActionKind,
  CompletionItemKind,
  createConnection,
  DidChangeWatchedFilesNotification,
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
import { codeActionsAt } from "./code-actions.ts";
import { completionsAt, type Completion } from "./completion.ts";
import { definitionAt } from "./definition.ts";
import { publishable } from "./diagnostics.ts";
import { hoverAt } from "./hover.ts";
import { referencesAt, toLocations } from "./references.ts";
import { prepareRename, RenameRefused, renameAt, willRenameEdits } from "./rename.ts";
import { Workspace } from "./workspace.ts";

export const DOCUMENT_SELECTOR = [{ pattern: "**/*.block.md" }, { pattern: "**/skills.jsonc" }, { pattern: "**/attachments/**/*.md" }, { pattern: "**/skills/**/*.md" }];

const MODULE = "skills-lsp";

export function isSkillFile(file: string): boolean {
  if (file.endsWith(".block.md") || basename(file) === "skills.jsonc") return true;
  return file.endsWith(".md") && (file.includes(`${sep}attachments${sep}`) || file.includes(`${sep}skills${sep}`));
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

/** A folder block moves as its folder, which no `*.block.md` glob matches; a file pack.path names may be any file. */
const RENAME_FILTERS = [
  { pattern: { glob: "**/*.block.md", matches: "file" as const } },
  { pattern: { glob: "**/*", matches: "folder" as const } },
  { pattern: { glob: "**/attachments/**", matches: "file" as const } },
  { pattern: { glob: "**/skills/**", matches: "file" as const } },
];

const WATCHED_GLOBS = ["**/*.block.md", "**/skills.jsonc", "**/.claude-plugin/plugin.json"];

export const COMPLETION_TRIGGERS = [".", ":", '"', "/"];

const ITEM_KIND: Record<Completion["kind"], CompletionItemKind> = {
  prop: CompletionItemKind.Property,
  include: CompletionItemKind.Module,
  contract: CompletionItemKind.Interface,
  block: CompletionItemKind.Class,
  value: CompletionItemKind.Value,
  folder: CompletionItemKind.Folder,
  file: CompletionItemKind.File,
  verb: CompletionItemKind.Function,
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** An analysis of a large workspace takes over 100 ms, so a typing burst publishes once, after it settles. */
export const PUBLISH_DEBOUNCE_MS = 200;

export type ServerOpts = {
  roots: string[];
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  debounceMs?: number;
  workspace?: (roots: string[]) => Workspace;
};

/**
 * Speaks LSP on stdin/stdout. `createConnection` with no streams would need `--stdio` in argv, which a
 * client launching `rt skills lsp` need not pass, so the streams are handed over explicitly.
 */
export function startServer(opts: ServerOpts): void {
  const connection = createConnection(ProposedFeatures.all, opts.input ?? process.stdin, opts.output ?? process.stdout);
  const documents = new TextDocuments(TextDocument);
  let ws: Workspace | null = null;
  let fileRenames = false;
  let watchesFiles = false;
  const published = new Set<string>();
  /** Stays false until a skill file is opened or changed, so a project with no skills costs no scan and no output. */
  let active = false;

  const send = (file: string, diagnostics: ReturnType<typeof publishable>) => {
    connection.sendDiagnostics({ uri: pathToFileURL(file).href, diagnostics }).catch((err: unknown) => {
      logCliEvent("error", MODULE, "sending diagnostics failed", { file, error: errorText(err) });
    });
  };

  let pending: ReturnType<typeof setTimeout> | null = null;
  const debounceMs = opts.debounceMs ?? PUBLISH_DEBOUNCE_MS;

  /** The workspace takes each change at once, so a request reads the newest text; only publishing waits. */
  const publishAll = (update: (ws: Workspace) => void = () => {}) => {
    if (!ws) return;
    try {
      update(ws);
    } catch (err) {
      logCliEvent("error", MODULE, "applying a change failed", { error: errorText(err) });
    }
    if (pending) clearTimeout(pending);
    pending = setTimeout(publishNow, debounceMs);
  };

  const publishNow = () => {
    pending = null;
    if (!ws || !active) return;
    const current = ws;
    try {
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
    ws = opts.workspace ? opts.workspace(roots) : new Workspace(roots);
    fileRenames = params.capabilities.workspace?.workspaceEdit?.resourceOperations?.includes("rename") ?? false;
    watchesFiles = params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration ?? false;
    logCliEvent("debug", MODULE, "initialized", { roots });
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
        completionProvider: { triggerCharacters: COMPLETION_TRIGGERS },
        codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
        workspace: { fileOperations: { didRename: { filters: RENAME_FILTERS }, willRename: { filters: RENAME_FILTERS } } },
      },
      serverInfo: { name: "rt skills lsp" },
    };
  });

  connection.onInitialized(() => {
    publishAll();
    if (!watchesFiles) return;
    connection.client.register(DidChangeWatchedFilesNotification.type, { watchers: WATCHED_GLOBS.map((globPattern) => ({ globPattern })) }).catch((err: unknown) => {
      logCliEvent("error", MODULE, "registering file watchers failed", { error: errorText(err) });
    });
  });

  const movesOf = (files: { oldUri: string; newUri: string }[]) =>
    files.flatMap(({ oldUri, newUri }) => {
      const from = pathOf(oldUri);
      const to = pathOf(newUri);
      return from && to ? [{ from, to }] : [];
    });

  connection.workspace.onDidRenameFiles(({ files }) => {
    publishAll((current) => current.refresh(movesOf(files)));
  });

  connection.workspace.onWillRenameFiles(({ files }) => {
    if (!ws) return null;
    const { changes } = willRenameEdits(ws, movesOf(files));
    return Object.keys(changes).length > 0 ? { changes } : null;
  });

  connection.onCodeAction(({ textDocument, range, context }) => {
    const file = pathOf(textDocument.uri);
    if (!ws || !file) return [];
    if (context.only && !context.only.some((kind) => CodeActionKind.QuickFix.startsWith(kind))) return [];
    return codeActionsAt(ws, file, range).map(({ title, edit, diagnostic }) => ({ title, kind: CodeActionKind.QuickFix, diagnostics: [diagnostic], isPreferred: true, edit }));
  });

  connection.onDidChangeWatchedFiles(() => publishAll((current) => current.refresh()));

  connection.onShutdown(() => {
    if (pending) clearTimeout(pending);
    pending = null;
  });

  documents.onDidChangeContent(({ document }) => {
    const file = pathOf(document.uri);
    if (!ws || !file || !isSkillFile(file)) return;
    active = true;
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
