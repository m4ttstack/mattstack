import { describe, expect, it } from 'vitest';

import { pluginRootOf, pluginSkillDirs } from './pluginRoot';

describe('pluginRootOf', () => {
  it('strips a flat skills or attachments layout back to the plugin root', () => {
    expect(pluginRootOf('/r/skills/ship/SKILL.md')).toBe('/r');
    expect(pluginRootOf('/r/attachments/review-posting/SKILL.md')).toBe('/r');
  });

  it('strips a grouped attachments layout back to the plugin root', () => {
    expect(pluginRootOf('/r/attachments/review/review/SKILL.md')).toBe('/r');
  });

  it('resolves an org base pack fill back to the base pack root', () => {
    expect(
      pluginRootOf(
        '/o/acme/mattstack/org/packs/acme-base/attachments/plan-policy/SKILL.md'
      )
    ).toBe('/o/acme/mattstack/org/packs/acme-base');
  });

  it('takes the innermost layout when the root itself contains a skills dir', () => {
    expect(pluginRootOf('/a/skills/b/attachments/c/SKILL.md')).toBe(
      '/a/skills/b'
    );
  });

  it('answers null for a path in neither layout rather than guessing', () => {
    expect(pluginRootOf('/steps/ship/SKILL.md')).toBeNull();
    expect(pluginRootOf('/r/skills/ship/README.md')).toBeNull();
  });
});

describe('pluginSkillDirs', () => {
  it('names the two folders the layout reads skill files from', () => {
    expect(pluginSkillDirs('/r')).toEqual(['/r/skills', '/r/attachments']);
  });
});
