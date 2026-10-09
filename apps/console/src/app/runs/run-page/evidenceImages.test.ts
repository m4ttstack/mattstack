import { parseEvidence } from '@mattstack/rt-client/evidence';
import { describe, expect, it } from 'vitest';

import {
  evidenceUrl,
  fileNameOf,
  legacyImageUrl,
  phasesIn,
  shotFor,
  shotsOf,
  variantsIn,
  type EvidenceV1Parsed,
} from './evidenceImages';

function v1(fields: Record<string, string>): EvidenceV1Parsed {
  const parsed = parseEvidence(JSON.stringify({ v: 1, ...fields }));
  if (parsed.version !== 1) throw new Error('not v1');
  return parsed;
}

describe('evidenceImages', () => {
  it('groups the images by phase and variant with their file names', () => {
    const shots = shotsOf(
      v1({
        before: '/x/web-409/before.png',
        after: '/x/web-409/after.png',
        afterAnnotated: '/x/web-409/after-annotated.png',
      })
    );
    expect(shots.before).toEqual({
      plain: { key: 'before', fileName: 'before.png' },
    });
    expect(variantsIn(shots.after)).toEqual(['plain', 'annotated']);
    expect(phasesIn(shots)).toEqual(['before', 'after']);
  });

  it('lists only the phases that have an image', () => {
    expect(phasesIn(shotsOf(v1({ before: '/x/before.png' })))).toEqual([
      'before',
    ]);
  });

  it('prefers the asked variant and falls back to the one present', () => {
    const phase = shotsOf(v1({ before: '/x/before.png' })).before;
    expect(shotFor(phase)?.key).toBe('before');
    expect(shotFor(phase, 'annotated')?.key).toBe('before');
    const both = shotsOf(
      v1({ before: '/x/b.png', beforeAnnotated: '/x/ba.png' })
    ).before;
    expect(shotFor(both)?.key).toBe('beforeAnnotated');
    expect(shotFor(both, 'plain')?.key).toBe('before');
    expect(shotFor({})).toBeNull();
  });

  it('takes the file name off the last path segment', () => {
    expect(fileNameOf('/a/b/c.png')).toBe('c.png');
    expect(fileNameOf('c.png')).toBe('c.png');
  });

  it('builds the route url without re-encoding the wire repo', () => {
    expect(evidenceUrl('remote:acme%2Fweb', '2026 10', 'after')).toBe(
      '/api/runs/remote:acme%2Fweb/2026%2010/evidence/after'
    );
  });

  it('builds the legacy image url from the wire repo, run id and encoded path', () => {
    expect(
      legacyImageUrl(
        'remote%3Aacme%2Fweb',
        '20261007-1520',
        '/Users/acme/.mattstack/evidence/web-377/before shot.png'
      )
    ).toBe(
      '/api/runs/remote%3Aacme%2Fweb/20261007-1520/evidence-file?path=%2FUsers%2Facme%2F.mattstack%2Fevidence%2Fweb-377%2Fbefore%20shot.png'
    );
  });
});
