import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { bundleRootFromExec } from './bundle-layout.ts';
import { resolveProgram } from './exec-env.ts';

const FIXED_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

export interface ResolveToolOpts {
  bundleRoot?: string | null;
  home?: string;
  /** The dirs searched after ~/.local/bin; defaults to both Homebrew prefixes. */
  dirs?: string[];
  path?: string;
}

/** The bundle's own argv for `name`, only when every entry exists. Parity
    anchor: rt's lib/deps/resolve.ts bundledToolExec reads the same row. */
function bundledExec(name: string, bundleRoot: string): string[] | null {
  let tools: unknown;
  try {
    tools = JSON.parse(
      readFileSync(
        join(bundleRoot, 'Contents', 'Resources', 'deps.lock'),
        'utf8'
      )
    ).tools;
  } catch {
    return null;
  }
  if (!Array.isArray(tools)) return null;
  const row = tools.find(
    (t: Record<string, unknown> | null) =>
      t?.name === name && t.kind === 'helper' && t.status === 'bundled'
  ) as { exec?: unknown } | undefined;
  if (!Array.isArray(row?.exec) || !row.exec.length) return null;
  const argv = row.exec.map(p => join(bundleRoot, String(p)));
  return argv.every(p => existsSync(p)) ? argv : null;
}

/**
 * argv prefix that runs `name` from a bundled deck, which launchd starts on a
 * minimal PATH: the bundle's own exec, then ~/.local/bin, the Homebrew
 * prefixes, the inherited PATH, and finally the bare name so a spawn failure
 * still names the tool. Null outside a bundle, where the shell's PATH stands.
 */
export function resolveTool(
  name: string,
  opts: ResolveToolOpts = {}
): string[] | null {
  const bundleRoot =
    opts.bundleRoot !== undefined ? opts.bundleRoot : bundleRootFromExec();
  if (!bundleRoot) return null;
  const bundled = bundledExec(name, bundleRoot);
  if (bundled) return bundled;
  const home = opts.home ?? process.env.HOME ?? homedir();
  const search = [
    join(home, '.local', 'bin'),
    ...(opts.dirs ?? FIXED_DIRS),
    opts.path ?? process.env.PATH ?? '',
  ].join(':');
  return [resolveProgram(name, search) ?? name];
}
