import { parseArgs } from 'node:util';
import pkg from '../../package.json' with { type: 'json' };
import { createContext, type CliContext } from './context.ts';
import { JOB_STATUS_USAGE, runJobStatus } from './job-status.ts';
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
import { publishCommand, pushCommand, importCommand } from './commands/forge.ts';
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
  push: pushCommand,
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
  sync: 'gitq sync [--no-fetch] [--stack <name>] [--json]',
  continue: 'gitq continue [--stack <name>] [--json]',
  abort: 'gitq abort [--stack <name>] [--json]',
  absorb: 'gitq absorb [--at <branch>[:<glob>]]... [--preview] [--stack <name>] [--json]',
  split: 'gitq split <branch> (--at <sha> | --files <glob[,glob...]>) --name <newBranch> [--stack <name>] [--json]',
  fold: 'gitq fold <branch> [--stack <name>] [--json]',
  reparent: 'gitq reparent <branch> --onto <branch> [--stack <name>] [--json]',
  rename: 'gitq rename <oldBranch> <newBranch> [--stack <name>] [--json]',
  reset: 'gitq reset <branch> [--stack <name>] [--json]',
  publish: 'gitq publish [--mr-meta <path>] [--stack <name>] [--json]',
  push: 'gitq push [--preview] [--stack <name>] [--json]',
  import: 'gitq import [--replace] [--json]',
  undo: 'gitq undo [--json]',
};

/**
 * Verbs that answer before the CLI context exists, so they are not in
 * COMMANDS: `board` boots the web board, `job-status` writes a board job-state
 * file by absolute path. Neither resolves a repo, and neither takes the shared
 * --json/-C flags, so they are listed apart rather than folded into the table.
 */
export const EXTRA_USAGE: Record<string, string> = {
  board: 'gitq board',
  'job-status': JOB_STATUS_USAGE,
};

/** Usage for one command, or the whole table when no known command was named. */
export function helpText(command?: string): string {
  const named = command !== undefined ? (USAGE[command] ?? EXTRA_USAGE[command]) : undefined;
  if (named) return `usage: ${named}`;

  const all = { ...USAGE, ...EXTRA_USAGE };
  const width = Math.max(...Object.keys(all).map((name) => name.length));
  const row = ([name, line]: [string, string]): string => `  ${name.padEnd(width)}  ${line}`;
  return [
    'usage: gitq <command> [args] [--json] [-C <path>]',
    '',
    'commands:',
    ...Object.entries(USAGE).map(row),
    '',
    'board:',
    ...Object.entries(EXTRA_USAGE).map(row),
    '',
    'every command also accepts --json and -C <path>.',
  ].join('\n');
}

export async function main(argv: string[]): Promise<number> {
  // Answered ahead of parseArgs, and ahead of anything that resolves a repo.
  // `job-status` takes its own argv (its --session flag is not in the shared
  // option table, and a non-strict parse would swallow the value as a
  // positional); `--version` must answer on a machine with no config at all,
  // because the mattstack bundle gate compares it against the deps.lock row.
  const verb = argv[0];
  if (verb === 'job-status') return runJobStatus(argv.slice(1));
  if (verb === '--version' || verb === '-v') {
    console.log(pkg.version);
    return 0;
  }
  if (verb === 'board') {
    if (typeof Bun === 'undefined') return fail('gitq board needs bun; the node CLI ships without the board server');
    try {
      await import('../server/server.ts');
    } catch (err) {
      // An unconfigured board is the normal first-launch state under launchd,
      // and a raw stack trace on every restart of the loop tells nobody what
      // to do about it.
      return fail(err instanceof Error ? err.message : String(err));
    }
    // The board owns the process from here: Bun.serve holds the event loop
    // open and the signal handlers in server.ts own the exit.
    return await new Promise<number>(() => {});
  }

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
      at: { type: 'string', multiple: true },
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
