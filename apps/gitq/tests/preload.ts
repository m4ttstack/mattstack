/**
 * Test isolation for gitq's global state. Without this, any test that touches
 * loadStore/OperationLog/work slots reads AND writes the real ~/.config/gitq
 * (which accumulated ~1150 remnant stack files before this existed) and can
 * hang on the migration sweep once that dir bloats. Set BEFORE any module
 * import: config-paths.ts reads GITQ_CONFIG_DIR once at import time.
 *
 * An explicitly exported GITQ_CONFIG_DIR wins, so a developer can still point
 * a test run at a prepared fixture dir.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.GITQ_CONFIG_DIR) {
  process.env.GITQ_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'gitq-test-config-'));
}
