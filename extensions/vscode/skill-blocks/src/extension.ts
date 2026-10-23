import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { DOCUMENT_PATTERNS, serverCommand, serverOptions } from './server';

let client: LanguageClient | undefined;

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

async function start(): Promise<void> {
  client = createClient();
  await client.start();
}

async function stop(): Promise<void> {
  const running = client;
  client = undefined;
  await running?.stop();
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand('skillBlocks.restartServer', async () => {
      await stop();
      await start();
    }),
  );
  await start();
}

export function deactivate(): Promise<void> {
  return stop();
}
