import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { createLifecycle } from './lifecycle';
import { DOCUMENT_PATTERNS, serverCommand, serverOptions } from './server';

function createClient(): LanguageClient {
  const setting = vscode.workspace.getConfiguration('skillBlocks').get<string>('rtPath', 'rt');
  const command = serverCommand(setting, process.env, homedir());
  return new LanguageClient(
    'skillBlocks',
    'Skill Blocks',
    serverOptions(command),
    { documentSelector: DOCUMENT_PATTERNS.map((pattern) => ({ scheme: 'file', pattern })) },
  );
}

let server = createLifecycle(createClient, () => {});

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Skill Blocks');
  server = createLifecycle(createClient, (message) => output.appendLine(message));
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('skillBlocks.restartServer', () => server.restart()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('skillBlocks.rtPath')) void server.restart();
    }),
  );
  await server.start();
}

export function deactivate(): Promise<void> {
  return server.stop();
}
