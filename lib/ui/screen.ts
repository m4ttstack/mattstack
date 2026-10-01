/**
 * Screen control belongs to a terminal, never a pipe: unguarded, the clear
 * lands in logs and erases what a failing command already wrote.
 */
export function clearScreen(): void {
  if (process.stderr.isTTY) process.stderr.write("\x1b[2J\x1b[H");
}
