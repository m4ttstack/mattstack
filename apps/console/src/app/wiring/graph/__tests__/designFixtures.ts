import { readFileSync } from 'node:fs';

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

const DESIGN_DIR = new URL(
  '../../../../server/fixtures/design/',
  import.meta.url
);

/** Read from disk, not imported: the import wall keeps every `server/` module
    out of app code, tests included. A fresh parse per call, so no test sees
    another's edits. */
export function designFixture<K extends keyof DesignPayloads>(
  name: K
): DesignPayloads[K] {
  return JSON.parse(
    readFileSync(new URL(`${name}.json`, DESIGN_DIR), 'utf8')
  ) as DesignPayloads[K];
}
