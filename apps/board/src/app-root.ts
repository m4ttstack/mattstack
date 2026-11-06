import { homedir } from 'os';
import { join, resolve } from 'path';

/** `bun build --define MATTSTACK_HELPER_BUNDLE=true` sets it for the bundle
    Contents/Helpers/board runs; it is undeclared everywhere else. */
declare const MATTSTACK_HELPER_BUNDLE: boolean | undefined;

export const IS_HELPER_BUNDLE =
  typeof MATTSTACK_HELPER_BUNDLE !== 'undefined' &&
  MATTSTACK_HELPER_BUNDLE === true;

/**
 * True for the distributed board, which has no source tree: the helper
 * bundle, or a bun-compiled binary (import.meta.dir then lives inside the
 * embedded read-only /$bunfs filesystem).
 */
export const IS_PACKAGED =
  IS_HELPER_BUNDLE || import.meta.dir.includes('$bunfs');

/**
 * Where the board's mutable companion lives: .env only.
 * All other state lives in state.db (see src/state/db.ts), rooted at
 * BOARD_STATE_DB or its own ~/.mattstack/board default, independent of
 * this root.
 *
 * The distributed form follows the mattstack runtime-state rule --
 * plain files under ~/.mattstack/<app>/ -- rather than the process's cwd: a
 * launcher that forgets to set a working directory would otherwise point the
 * board at "/" and every write would fail. From a checkout it stays the
 * repo root.
 * BOARD_APP_ROOT overrides both (the bundle can pin an explicit home)
 * and only has to be set where the server runs: a launched pane derives the
 * board's root from the state path it is handed, not from its own environment.
 * The override is normalized because that derivation is, and the two are
 * compared by string equality; a trailing slash must not split them.
 * HOME is read at call time -- Bun freezes os.homedir() at process start.
 */
function appRoot(): string {
  const override = process.env.BOARD_APP_ROOT;
  if (override) return resolve(override);
  if (!IS_PACKAGED) return join(import.meta.dir, '..');
  return join(process.env.HOME ?? homedir(), '.mattstack', 'board');
}

export const APP_ROOT = appRoot();
