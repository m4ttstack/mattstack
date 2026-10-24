import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { Executable } from 'vscode-languageclient/node';

// Mirrors DOCUMENT_SELECTOR in lib/skills/lsp/server.ts.
export const DOCUMENT_PATTERNS = ['**/*.block.md', '**/skills.jsonc', '**/attachments/**/*.md', '**/skills/**/*.md', '**/pack/sections/*.md', '**/pack/params.jsonc'];

const DEFAULT_RT = 'rt';
// TransportKind.stdio; the enum lives in a module that needs the vscode host at load.
const STDIO = 0;

/** An editor started from the Dock may lack the shell's PATH, so the default falls back to where setup links rt. */
export function serverCommand(
  setting: string,
  env: Record<string, string | undefined>,
  home: string,
  exists: (path: string) => boolean = existsSync,
): string {
  if (setting !== '' && setting !== DEFAULT_RT) return setting;
  const onPath = (env.PATH ?? '').split(delimiter).some((dir) => dir !== '' && exists(join(dir, DEFAULT_RT)));
  if (onPath) return DEFAULT_RT;
  const linked = join(home, '.local', 'bin', DEFAULT_RT);
  return exists(linked) ? linked : DEFAULT_RT;
}

export function serverOptions(command: string): Executable {
  return { command, args: ['skills', 'lsp'], transport: STDIO };
}
