import type { CliContext } from './context.ts';

/** Print the machine or human form of a result, per --json. */
export function emit(ctx: CliContext, humanText: string, jsonValue: unknown): void {
  if (ctx.json) console.log(JSON.stringify(jsonValue, null, 2));
  else console.log(humanText);
}

export function fail(message: string): number {
  console.error(`gitq: ${message}`);
  return 1;
}
