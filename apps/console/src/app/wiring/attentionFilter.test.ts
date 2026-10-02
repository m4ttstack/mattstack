import { describe, expect, it } from 'vitest';

import { WIRING_ATTENTION_HREF } from './attentionFilter';
import { parseWiringUrl } from './graph/useWiringUrl';

describe('WIRING_ATTENTION_HREF', () => {
  it('opens the Graph tab with the attention filter on', () => {
    expect(
      parseWiringUrl(new URL(WIRING_ATTENTION_HREF, 'http://x').search)
    ).toMatchObject({ tab: 'graph', attention: true });
  });
});
