// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { settingsRepoKeys } from './settings';

describe('settingsRepoKeys', () => {
  it('turns registered remote identities into the raw host/path keys settings sections use', () => {
    expect(
      settingsRepoKeys([
        'remote:github.com%2Facme%2Fwidgets',
        'remote:gitlab.com%2Facme%2Facme-dev',
      ])
    ).toEqual(['github.com/acme/widgets', 'gitlab.com/acme/acme-dev']);
  });

  it('drops path identities and malformed wires', () => {
    expect(
      settingsRepoKeys([
        'path:%2FUsers%2Fdev%2Fscratch',
        'widgets',
        'remote:%E0',
      ])
    ).toEqual([]);
  });
});
