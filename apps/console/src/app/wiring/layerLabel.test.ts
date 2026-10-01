import { describe, expect, test } from 'vitest';

import { layerLabel } from './layerLabel';

describe('layerLabel', () => {
  test('names each layer in plain words', () => {
    expect(layerLabel('default')).toBe('default');
    expect(layerLabel('pack')).toBe('this pack');
    expect(layerLabel('override')).toBe('your override');
    expect(layerLabel('base:acme-base')).toBe('base: acme-base');
  });

  test('passes a layer it does not know through unchanged', () => {
    expect(layerLabel('team')).toBe('team');
  });
});
