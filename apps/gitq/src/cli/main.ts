import { parseArgs } from 'node:util';
import { createContext, type CliContext } from './context.ts';
import { fail } from './output.ts';
import { stacksCommand } from './commands/stacks.ts';

type Command = (ctx: CliContext) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  stacks: stacksCommand,
};

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
    },
  });

  const [name, ...rest] = positionals.map(String);
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
