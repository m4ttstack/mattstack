/**
 * Deterministic execution environment for supervised services.
 *
 * launchd starts an agent with a minimal PATH and does not search PATH for
 * `ProgramArguments[0]`, so a plist has to carry both a usable PATH and an
 * absolute program. Taking either from `process.env` at registration time
 * bakes whoever happened to run `deck add` into a file that outlives them.
 *
 * That is the whole bug class: a shell-centric node manager (nvm, fnm)
 * contributes per-shell directories that die with the shell, so a plist
 * written from a shell's PATH points at interpreters that are gone minutes
 * later, and an argv0 captured as an absolute manager-internal path (e.g.
 * `~/.local/share/fnm/aliases/default/bin/node`) breaks outright the next
 * time that manager reorganizes or is replaced.
 *
 * So compose PATH from directories whose existence is a property of the
 * machine rather than of a shell, and re-resolve the program on every render
 * rather than trusting what an earlier render stored.
 */

import { accessSync, constants, existsSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { bundleHelpersDir } from './bundle-layout.ts';

export type Exists = (path: string) => boolean;

const defaultExists: Exists = p => existsSync(p);

const OS_PATH_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

function existingUnique(dirs: string[], exists: Exists): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of dirs) {
    if (!dir || seen.has(dir) || !exists(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out;
}

/**
 * Directories a supervised service may rely on, in precedence order.
 *
 * The membership rule is that the directory's location is a property of the
 * machine, not of a shell or of a version manager's current internal layout:
 * the suite's own private tools, the user's link dir, the fixed paths bun's
 * and rustup's installers use, both Homebrew prefixes, the OS defaults.
 *
 * A version manager's shim or per-version directory does NOT qualify, however
 * stable it looks — deck must not encode which manager a machine happens to
 * run. Those belong in `extraDirs`, set deliberately per machine.
 */
export function stablePathDirs(
  home: string = homedir(),
  bundleHelpers: string | null = bundleHelpersDir()
): string[] {
  return [
    ...(bundleHelpers ? [bundleHelpers] : []),
    join(home, '.mattstack', 'deck', 'bin'),
    join(home, '.local', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.cargo', 'bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    ...OS_PATH_DIRS,
  ];
}

export interface ComposePathOpts {
  /**
   * Machine-specific directories to prepend — the escape hatch for a toolchain
   * that installs outside the stable set (a version manager's shim directory,
   * say). Deliberate and persisted, as opposed to inherited from a shell.
   */
  extraDirs?: string[];
  home?: string;
  exists?: Exists;
  /** Override for the bundle's Helpers dir; defaults to the live bundleHelpersDir() lookup. Injectable for tests. */
  bundleHelpers?: string | null;
}

/** PATH for a supervised service: extras first, then the stable set, existing dirs only, deduped. */
export function composeServicePath(opts: ComposePathOpts = {}): string {
  const stable = stablePathDirs(
    opts.home ?? homedir(),
    opts.bundleHelpers !== undefined ? opts.bundleHelpers : bundleHelpersDir()
  );
  return existingUnique(
    [...(opts.extraDirs ?? []), ...stable],
    opts.exists ?? defaultExists
  ).join(':');
}

/**
 * launchd starts an SMAppService helper on its bare default PATH, and the
 * bundle plist carries none, so deck serving as a bundle helper composes its
 * own. Dirs the inherited PATH adds beyond the composed set are kept, after it.
 */
export function adoptHelperPath(
  env: Record<string, string | undefined>,
  bundleRoot: string | null,
  compose: () => string = composeServicePath
): void {
  if (!bundleRoot) return;
  const composed = compose().split(':');
  const extra = (env.PATH ?? '')
    .split(':')
    .filter(dir => dir && !composed.includes(dir));
  env.PATH = [...composed, ...extra].join(':');
}

export interface ComposeCommandPathOpts {
  /** The PATH deck itself runs on; defaults to process.env.PATH. */
  inherited?: string;
  home?: string;
  exists?: Exists;
  bundleHelpers?: string | null;
}

/**
 * PATH for a command run (dev build, deploy, `deck cmd`): the user's tool
 * dirs, then whatever else the inherited PATH carried, then the bundle's
 * Helpers, then the OS dirs.
 *
 * Nothing the user installed may sit behind Helpers: `Helpers/bun` is signed
 * without disable-library-validation, so a build it runs cannot load a native
 * addon (rolldown's) that the user's own bun loads fine. Helpers stays on the
 * path for the tools only the bundle ships.
 */
export function composeCommandPath(opts: ComposeCommandPathOpts = {}): string {
  const inherited = opts.inherited ?? process.env.PATH ?? '';
  const helpers =
    opts.bundleHelpers !== undefined ? opts.bundleHelpers : bundleHelpersDir();
  if (!helpers) return inherited;
  const userDirs = stablePathDirs(opts.home ?? homedir(), null).filter(
    dir => !OS_PATH_DIRS.includes(dir)
  );
  const exists = opts.exists ?? defaultExists;
  const user = existingUnique(userDirs, exists);
  const tail = existingUnique([helpers, ...OS_PATH_DIRS], exists);
  const extra = inherited
    .split(':')
    .filter(dir => dir && !user.includes(dir) && !tail.includes(dir));
  return [...user, ...new Set(extra), ...tail].join(':');
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Absolute path for a service's argv0, resolved against `path` at render time.
 *
 * An argv0 that is already absolute or explicitly relative is the caller's
 * stated intent and is returned untouched — `deck` does not second-guess a
 * path someone typed. A bare name is looked up, which is what makes a
 * logical command (`node server.js`) survive the interpreter moving: the
 * record keeps the name, and each render resolves it again.
 *
 * Returns null when a bare name resolves to nothing, so the caller can refuse
 * loudly instead of writing a plist launchd will silently decline to start.
 */
export function resolveProgram(
  argv0: string,
  path: string,
  isExecutable: (p: string) => boolean = isExecutableFile
): string | null {
  if (argv0.includes('/')) return argv0;
  for (const dir of path.split(':')) {
    if (!dir) continue;
    const candidate = join(dir, argv0);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}
