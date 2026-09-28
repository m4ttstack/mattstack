import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const SRC = join(import.meta.dir, '..', '..', 'skills-src');

test("the vendored open-gate.sh is byte-identical to board:respond's", () => {
  const review = readFileSync(join(SRC, 'review', 'scripts', 'open-gate.sh'));
  const respond = readFileSync(join(SRC, 'respond', 'scripts', 'open-gate.sh'));
  expect(review.equals(respond)).toBe(true);
});

test('board:review allows and names its vendored open-gate.sh', () => {
  const skill = readFileSync(join(SRC, 'review', 'SKILL.md'), 'utf8');
  expect(skill).toContain('Bash(${CLAUDE_SKILL_DIR}/scripts/open-gate.sh:*)');
  expect(skill).toContain(
    '"${CLAUDE_SKILL_DIR}/scripts/open-gate.sh" <status-bin> <state> review-post <open-file>'
  );
  expect(skill).toContain(
    'whose path the domain skill handed back with the open file'
  );
});
