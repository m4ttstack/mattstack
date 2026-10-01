import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SkillsCheck, SkillsComposition } from '../../outline';
import type { SkillsAnatomy, SkillsChanges } from '../../useWiring';

type DesignPayloads = {
  composition: SkillsComposition;
  'composition.unsynced': SkillsComposition;
  check: SkillsCheck;
  'anatomy.work': SkillsAnatomy;
  'anatomy.stage-plan': SkillsAnatomy;
  'anatomy.stage-plan.unsynced': SkillsAnatomy;
  'changes.clean': SkillsChanges;
  'changes.unsynced': SkillsChanges;
};

const DESIGN_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../server/fixtures/design'
);

/** Read from disk, not imported: the import wall keeps every `server/` module
    out of app code, tests included. A fresh parse per call, so no test sees
    another's edits. A path, not a URL: jsdom's `URL` replaces Node's in
    component tests, and `readFileSync` refuses it. */
export function designFixture<K extends keyof DesignPayloads>(
  name: K
): DesignPayloads[K] {
  return JSON.parse(
    readFileSync(join(DESIGN_DIR, `${name}.json`), 'utf8')
  ) as DesignPayloads[K];
}
