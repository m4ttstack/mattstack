import { isHuman } from "./out.ts";

/**
 * Screen control belongs to a person at a terminal, never a pipe, --json or
 * RT_BATCH: unguarded, the clear lands in logs and erases what a failing
 * command already wrote.
 */
export function clearScreen(): void {
  if (isHuman("stderr")) process.stderr.write("\x1b[2J\x1b[H");
}
