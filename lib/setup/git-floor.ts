/** Team join and the org clone's cone run `git sparse-checkout set --cone`, which git added in 2.35. */
export const GIT_FLOOR = "2.35";

/** Apple's installer refuses while any Command Line Tools are present, so old ones have to go first; only a person can sudo. */
export const CLT_REINSTALL_STEPS: readonly string[] = [
  "Open Terminal",
  "Run: sudo rm -rf /Library/Developer/CommandLineTools",
  "Run: xcode-select --install, then click Install",
  "When it finishes, come back here",
];

/** The `X.Y.Z` in `git version 2.24.3 (Apple Git-128)`, or null when the output carries none. */
export function parseGitVersion(output: string): string | null {
  return /git version (\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1] ?? null;
}

/** True only for a version read and found below the floor; an unreadable one is not called old. */
export function gitBelowFloor(output: string): boolean {
  const version = parseGitVersion(output);
  if (version === null) return false;
  const [major = 0, minor = 0] = version.split(".").map(Number);
  const [floorMajor = 0, floorMinor = 0] = GIT_FLOOR.split(".").map(Number);
  return major < floorMajor || (major === floorMajor && minor < floorMinor);
}
