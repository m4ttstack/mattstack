/**
 * Test isolation for gitq's global state. Without this, any test that touches
 * loadStore/OperationLog/work slots reads AND writes the real ~/.config/gitq
 * (which accumulated ~1150 remnant stack files before this existed) and can
 * hang on the migration sweep once that dir bloats. Set BEFORE any module
 * import: config-paths.ts reads GITQ_CONFIG_DIR once at import time.
 *
 * An explicitly exported GITQ_CONFIG_DIR wins, so a developer can still point
 * a test run at a prepared fixture dir.
 *
 * HOME is repointed unconditionally (no override escape hatch) to a fresh
 * mkdtemp, ALSO before any module import: @mattstack/rt-client's settings
 * stores (src/core/secrets.ts, and anything using getSetting/setSetting)
 * resolve `process.env.HOME ?? homedir()` at call time, so this is the whole
 * fix -- a test that skipped it would otherwise read and write the real
 * ~/.mattstack/user/settings.user.jsonc. os.homedir() is syscall-backed and
 * stays the real account home no matter what HOME is set to here.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.HOME = mkdtempSync(join(tmpdir(), 'gitq-test-home-'));

if (!process.env.GITQ_CONFIG_DIR) {
  process.env.GITQ_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'gitq-test-config-'));
}
