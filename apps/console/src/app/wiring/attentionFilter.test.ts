import { describe, expect, it } from 'vitest';

import { PACKS_ATTENTION_HREF } from './attentionFilter';
import { parseWiringUrl } from './graph/useWiringUrl';

describe('PACKS_ATTENTION_HREF', () => {
  it('opens the Config tab with the attention filter on', () => {
    expect(
      parseWiringUrl(new URL(PACKS_ATTENTION_HREF, 'http://x').search)
    ).toMatchObject({ tab: 'config', attention: true });
  });
});
