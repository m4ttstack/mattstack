/**
 * A verb the app spawns can outlive the app. When the app quits, both of the
 * child's pipes close, and Bun ends the process at the first failed write to
 * either one unless something listens for the error.
 */

function ignore(): void {}

let ignoring = false;

/** Once per process: repeated calls must not stack listeners. */
export function ignoreClosedPipes(): void {
  if (ignoring) return;
  ignoring = true;
  process.stdout.on("error", ignore);
  process.stderr.on("error", ignore);
}

export const __test__ = {
  reset(): void {
    process.stdout.off("error", ignore);
    process.stderr.off("error", ignore);
    ignoring = false;
  },
};
