import { describe, expect, it } from 'vitest';

import { compactPaths, sharedFolder } from '../DiffFileTree';

describe('sharedFolder', () => {
  it('is the folder every path sits under', () => {
    expect(sharedFolder(['a/b/c/x.md', 'a/b/d/y.md'])).toBe('a/b/');
    expect(sharedFolder(['a/x.md', 'b/y.md'])).toBe('');
    expect(sharedFolder(['a/b/x.md'])).toBe('a/b/');
  });
});

describe('compactPaths', () => {
  it('draws a chain of single-folder directories as one row', () => {
    const shown = compactPaths([
      'review/references/lore/rules/apps/src/Islands/.lore/a.lore',
      'review/SKILL.md',
      'ship/notes/x.md',
    ]);
    expect(shown.get('review/SKILL.md')).toBe('review/SKILL.md');
    expect(
      shown.get('review/references/lore/rules/apps/src/Islands/.lore/a.lore')
    ).toBe('review/references ∕ … ∕ Islands ∕ .lore/a.lore');
    expect(shown.get('ship/notes/x.md')).toBe('ship ∕ notes/x.md');
  });
});
