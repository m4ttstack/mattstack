import { parseArgs } from 'node:util';
import { createContext, type CliContext } from './context.ts';
import { fail } from './output.ts';
import { stacksCommand } from './commands/stacks.ts';
import { diagnoseCommand } from './commands/diagnose.ts';
import { preflightCommand } from './commands/preflight.ts';
import { logCommand } from './commands/log.ts';
import { trackCommand, untrackCommand, addCommand, removeCommand } from './commands/crud.ts';
import { syncCommand, continueCommand, abortCommand } from './commands/cascade.ts';
import {
  absorbCommand,
  splitCommand,
  foldCommand,
  reparentCommand,
  renameCommand,
  resetCommand,
} from './commands/surgery.ts';
import { publishCommand, importCommand } from './commands/forge.ts';
import { undoCommand } from './commands/undo.ts';

type Command = (ctx: CliContext) => Promise<number>;

export const COMMANDS: Record<string, Command> = {
  stacks: stacksCommand,
  diagnose: diagnoseCommand,
  preflight: preflightCommand,
  log: logCommand,
  track: trackCommand,
  untrack: untrackCommand,
  add: addCommand,
  remove: removeCommand,
  sync: syncCommand,
  continue: continueCommand,
  abort: abortCommand,
  absorb: absorbCommand,
  split: splitCommand,
  fold: foldCommand,
  reparent: reparentCommand,
  rename: renameCommand,
  reset: resetCommand,
  publish: publishCommand,
  import: importCommand,
  undo: undoCommand,
};

const HELP_FLAGS = new Set(['--help', '-h']);

/** One-line synopsis per command, keyed exactly like COMMANDS. */
export const USAGE: Record<string, string> = {
  stacks: 'gitq stacks [--json]',
  diagnose: 'gitq diagnose [--json]',
  preflight: 'gitq preflight [--json]',
  log: 'gitq log [--json]',
  track: 'gitq track <stackName> --root <branch> [--json]',
  untrack: 'gitq untrack <stackName> [--json]',
  add: 'gitq add <branch> --parent <branch> [--stack <name>] [--json]',
  remove: 'gitq remove <branch> [--stack <name>] [--json]',
  sync: 'gitq sync [--stack <name>] [--json]',
  continue: 'gitq continue [--stack <name>] [--json]',
  abort: 'gitq abort [--stack <name>] [--json]',
  absorb: 'gitq absorb [--preview] [--stack <name>] [--json]',
  split: 'gitq split <branch> (--at <sha> | --files <glob[,glob...]>) --name <newBranch> [--stack <name>] [--json]',
  fold: 'gitq fold <branch> [--stack <name>] [--json]',
  reparent: 'gitq reparent <branch> --onto <branch> [--stack <name>] [--json]',
  rename: 'gitq rename <oldBranch> <newBranch> [--stack <name>] [--json]',
  reset: 'gitq reset <branch> [--stack <name>] [--json]',
  publish: 'gitq publish [--mr-meta <path>] [--stack <name>] [--json]',
  import: 'gitq import [--replace] [--json]',
  undo: 'gitq undo [--json]',
};

/** Usage for one command, or the whole table when no known command was named. */
export function helpText(command?: string): string {
  const named = command !== undefined ? USAGE[command] : undefined;
  if (named) return `usage: ${named}`;

  const width = Math.max(...Object.keys(USAGE).map((name) => name.length));
  const rows = Object.entries(USAGE).map(([name, line]) => `  ${name.padEnd(width)}  ${line}`);
  return [
    'usage: gitq <command> [args] [--json] [-C <path>]',
    '',
    'commands:',
    ...rows,
    '',
    'every command also accepts --json and -C <path>.',
  ].join('\n');
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: false,
    allowPositionals: true,
    options: {
      C: { type: 'string' },
      json: { type: 'boolean' },
      stack: { type: 'string' },
      root: { type: 'string' },
      parent: { type: 'string' },
      onto: { type: 'string' },
      at: { type: 'string' },
      name: { type: 'string' },
      files: { type: 'string' },
      preview: { type: 'boolean' },
      'mr-meta': { type: 'string' },
      replace: { type: 'boolean' },
    },
  });

  const [name, ...rest] = positionals.map(String);

  // Before dispatch and before createContext: every command here mutates
  // something, and asking for help must never be one of the things that does.
  if (argv.some((arg) => HELP_FLAGS.has(arg))) {
    console.log(helpText(name));
    return 0;
  }

  if (!name) return fail(`usage: gitq <command> [args] [--json] [-C <path>]. commands: ${Object.keys(COMMANDS).join(', ')}`);

  const command = COMMANDS[name];
  if (!command) return fail(`unknown command: ${name}`);

  const startDir = typeof values.C === 'string' ? values.C : process.cwd();
  try {
    const ctx = await createContext(startDir, rest, values as Record<string, string | boolean>);
    return await command(ctx);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
