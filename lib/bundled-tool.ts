/**
 * Resolve a bundled helper by name: the copy inside mattstack.app first, then
 * PATH, then the bare name.
 *
 * The bare-name fallback is deliberate. Returning it unchanged means a machine
 * with neither copy fails exactly as it did before — with the tool's own
 * "not found" — rather than with a null-path crash from this module. What the
 * caller gains is that an INSTALLED machine no longer depends on the user
 * having the tool on PATH at all.
 *
 * `lib/ui/resolve.ts` keeps its own resolver because it also owns a bespoke
 * missing-tool message and an exit path; this is the plain version for tools
 * that just need an argv[0].
 */

import { homedir } from "os";
import { join } from "path";
import { bundledHelperPath } from "./bundle-layout.ts";

export type Which = (bin: string) => string | null;

// The live PATH, passed explicitly: a bare Bun.which() resolves against the
// PATH captured when the process started, so the daemon's own prepend of the
// bundle's Helpers dir and ~/.local/bin (lib/daemon.ts, path-resolution) would
// be invisible to it.
const defaultWhich: Which = (b) => Bun.which(b, { PATH: process.env.PATH ?? "" });

/**
 * `bundledHelperPath` throws on a row mislabeled `kind: "buildtool"`. A bad
 * deps.lock entry must degrade to the PATH fallback rather than crash every
 * spawn.
 */
function bundled(name: string): string | null {
  try {
    return bundledHelperPath(name);
  } catch {
    return null;
  }
}

/**
 * The bundle's copy, then PATH, and null when neither has it — for callers
 * that must tell "found at the bare name" apart from "found nowhere", which
 * `resolveBundledTool`'s bare-name fallback deliberately blurs.
 */
export function findBundledTool(name: string, which: Which = defaultWhich): string | null {
  return bundled(name) ?? which(name) ?? null;
}

export function resolveBundledTool(name: string, which: Which = defaultWhich): string {
  return findBundledTool(name, which) ?? name;
}

/** Where a user-installed tool lives when launchd's minimal PATH cannot see it. */
export function wellKnownBinDirs(home: string = homedir()): string[] {
  return ["/opt/homebrew/bin", "/usr/local/bin", join(home, ".local", "bin")];
}

/** A `Which` over PATH first, then `wellKnownBinDirs`. */
export function whichWithWellKnownDirs(home: string = homedir(), pathEnv: string = process.env.PATH ?? ""): Which {
  const search = [...pathEnv.split(":").filter((d) => d.length > 0), ...wellKnownBinDirs(home)].join(":");
  return (b) => Bun.which(b, { PATH: search });
}
