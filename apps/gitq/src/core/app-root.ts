import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// import.meta.url, not bun's import.meta.dir: this module is also in the
// node-targeted CLI bundle (`bun run build`), where import.meta.dir is
// undefined and reading `.includes` off it throws before main() ever runs.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * True when running as a bun-compiled standalone binary: this module then
 * lives inside the embedded read-only /$bunfs filesystem, so nothing derived
 * from its path is readable from disk or writable at all.
 */
export const IS_COMPILED = MODULE_DIR.includes('$bunfs');

/**
 * The one root every mutable thing gitq owns hangs off: the stack stores,
 * settings, the operation log, the work slots it creates, and the board's
 * config.json and state/jobs.
 *
 * `~/.mattstack/gitq` whether gitq runs from a checkout or as the bundled
 * binary. One root per helper is the mattstack compliance rule, and running
 * both forms against the same root is what makes `gitq stacks` answer the same
 * whichever copy of the program is on PATH. It is deliberately not derived
 * from the process's cwd or from MODULE_DIR: a launcher that forgets to set a
 * working directory would point the board at "/", and the compiled binary's
 * MODULE_DIR is inside a read-only bundle.
 *
 * GITQ_APP_ROOT overrides it. `GITQ_CONFIG_DIR` still moves the CLI's own
 * subset (see core/config-paths.ts) for throwaway runs and test isolation.
 *
 * process.env.HOME leads, with os.homedir() only as the fallback: bun freezes
 * homedir() at process start, and launchd is what sets HOME for the agent.
 */
function appRoot(): string {
  const override = process.env.GITQ_APP_ROOT;
  if (override) return resolve(override);
  return join(process.env.HOME ?? homedir(), '.mattstack', 'gitq');
}

export const APP_ROOT = appRoot();

/**
 * Where gitq kept the CLI's files before the move to a single app root. Read
 * only by the one-time migration in core/config-migration.ts; nothing else may
 * resolve a path against it.
 */
export const LEGACY_CONFIG_DIR = join(process.env.HOME ?? homedir(), '.config', 'gitq');
