/** Test helpers for asserting how a call site names rt's credential helper. */

import { expect } from "bun:test";

const PAIR_KEY = /^credential\.https:\/\/(.+)\.helper(=.*)$/s;

/** The host of the helper pair `gitWithRtCredential` puts at the front of argv, or null for plain git. */
export function rtHelperHost(argv: string[]): string | null {
  if (argv[0] !== "git") throw new Error(`argv does not start with git: ${JSON.stringify(argv.slice(0, 2))}`);
  if (argv[1] !== "-c") return null;
  const clear = argv[2]?.match(PAIR_KEY);
  const set = argv[3] === "-c" ? argv[4]?.match(PAIR_KEY) : null;
  if (!clear || !set) throw new Error(`half a helper pair in argv: ${JSON.stringify(argv.slice(0, 5))}`);
  if (clear[2] !== "=") throw new Error("the first helper value must be empty, to clear earlier helpers");
  if (!/^=!.+ git credential$/s.test(set[2]!)) throw new Error(`the second helper value is not rt's git credential: ${set[2]}`);
  if (clear[1] !== set[1]) throw new Error(`helper pair names two hosts: ${clear[1]} and ${set[1]}`);
  return clear[1]!;
}

/** The child's env holds no copy of the token and no `RT_GIT_*` key. */
export function expectNoToken(env: Record<string, string> | undefined, token: string): void {
  for (const [key, value] of Object.entries(env ?? {})) {
    expect(key.startsWith("RT_GIT_")).toBe(false);
    expect(value.includes(token)).toBe(false);
  }
}
