/** rt runs `git init -b` and other flags git added in 2.28. */
export const GIT_FLOOR = "2.28";

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
