import { describe, expect, it } from 'vitest';

import { baseCopyOf } from './baseCopies';

const rows = [
  { name: 'dev-servers', base: 'acme-base' },
  { name: 'refs/feature-flags', base: 'acme-base' },
  { name: 'gone', base: null },
];

describe('baseCopyOf', () => {
  it('matches a link into an emitted folder, a link relative to a verb, and a grouped unit', () => {
    expect(baseCopyOf('attachments/dev-servers/SKILL.md', rows)).toBe(
      'acme-base'
    );
    expect(baseCopyOf('../../attachments/dev-servers/SKILL.md', rows)).toBe(
      'acme-base'
    );
    expect(
      baseCopyOf('attachments/refs/feature-flags/references/x.md', rows)
    ).toBe('acme-base');
  });

  it('does not match a prefix that is only a name prefix, or a team folder', () => {
    expect(
      baseCopyOf('attachments/dev-servers-extra/SKILL.md', rows)
    ).toBeNull();
    expect(
      baseCopyOf('attachments/capture-evidence/SKILL.md', rows)
    ).toBeNull();
    expect(
      baseCopyOf('attachments/dev-servers/SKILL.md', undefined)
    ).toBeNull();
    expect(baseCopyOf('foo-attachments/dev-servers/SKILL.md', rows)).toBeNull();
  });

  it('never matches an orphaned row, which has no base', () => {
    expect(baseCopyOf('attachments/gone/SKILL.md', rows)).toBeNull();
  });
});
