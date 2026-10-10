import { describe, expect, it } from 'vitest';

import { repoChoices } from './repoChoices';

const WEB = 'remote:gitlab.example.com%2Facme%2Fweb';

describe('repoChoices', () => {
  it('names a run folder by the registered repo it belongs to', () => {
    expect(repoChoices(['gitlab.example.com-acme-web'], [WEB])).toEqual([
      { repo: 'gitlab.example.com-acme-web', label: 'web' },
    ]);
  });

  it('takes a run repo that is already a serialized identity', () => {
    expect(repoChoices([WEB], [WEB])).toEqual([{ repo: WEB, label: 'web' }]);
  });

  it('leaves out run folders no registered repo matches, once each', () => {
    expect(
      repoChoices(
        ['smoke', 'gitlab.example.com-acme-web', 'gitlab.example.com-acme-web'],
        [WEB]
      )
    ).toEqual([{ repo: 'gitlab.example.com-acme-web', label: 'web' }]);
  });
});
