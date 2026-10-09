import { describe, expect, it } from 'vitest';

import type { EffectiveInputsPayload } from '../../../server/effectiveInputs';
import { inputsSummary } from './inputs';

const payload = (
  over: Partial<EffectiveInputsPayload> = {}
): EffectiveInputsPayload => ({
  pipeline: 'work',
  workType: 'feature',
  packVersions: [
    {
      pack: 'acme',
      recordedSha: '4c1d9e2b7a',
      currentSha: '4c1d9e2b7a51',
      drifted: false,
    },
  ],
  packDirty: false,
  stages: ['provision', 'plan'],
  config: [
    { key: 'a', value: 1, provenance: [] },
    { key: 'b', value: 2, provenance: [] },
    { key: 'c', value: 3, provenance: [] },
  ],
  ...over,
});

describe('inputsSummary', () => {
  it('names the pack at its sha and counts what the run read', () => {
    expect(inputsSummary(payload())).toEqual({
      pack: 'acme pack 4c1d9e2 · in sync',
      counts: '3 settings · 2 stage docs',
    });
  });

  it('says when the source moved or the pack is not here', () => {
    const moved = payload({
      packVersions: [
        {
          pack: 'acme',
          recordedSha: 'abc1234',
          currentSha: 'f',
          drifted: true,
        },
      ],
    });
    expect(inputsSummary(moved).pack).toBe(
      'acme pack abc1234 · source has moved'
    );
    const missing = payload({
      packVersions: [
        {
          pack: 'acme',
          recordedSha: 'abc1234',
          currentSha: null,
          drifted: null,
        },
      ],
    });
    expect(inputsSummary(missing).pack).toBe(
      'acme pack abc1234 · pack not found here'
    );
  });

  it('covers a run from before pack versions and singular counts', () => {
    expect(
      inputsSummary(
        payload({ packVersions: null, stages: ['plan'], config: [] })
      )
    ).toEqual({
      pack: 'pack version not recorded',
      counts: '0 settings · 1 stage doc',
    });
  });
});
