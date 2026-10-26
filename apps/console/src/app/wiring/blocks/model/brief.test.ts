import { describe, expect, it } from 'vitest';

import { miniPayload } from '../__tests__/blocksFixture';
import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';
import { buildBlockContext } from './brief';

const FIXED = [
  '',
  "Change a prop's value: mattstack:extending-a-pack",
  "Change mattstack's text: mattstack:editing-skills",
  'Write it with: superpowers:writing-skills',
  '',
  'What I want:',
];

const find = (id: string) => {
  const block = miniPayload.blocks.find(b => b.id === id);
  if (!block) throw new Error(id);
  return block;
};

const prop = (
  name: string,
  over: Partial<PayloadBlock['props'][number]> = {}
): PayloadBlock['props'][number] => ({
  name,
  merge: 'add',
  default: null,
  contract: null,
  marker: null,
  values: [],
  fromDefault: false,
  ...over,
});

const basePayload: BlocksPayload = {
  ...miniPayload,
  layers: [
    { name: 'mattstack', label: 'default', color: 'mattstack' },
    { name: 'acme-base', label: 'base:acme-base', color: 'org' },
    { name: 'widgets', label: 'pack', color: 'team' },
  ],
};

describe('buildBlockContext', () => {
  it('writes the whole brief for mini/gate', () => {
    const block = find('mini/gate');
    expect(buildBlockContext({ payload: miniPayload, block })).toBe(
      [
        'Block: mini/gate',
        '  "Ask the gate"',
        `File: …/${block.path.split('/attachments/')[1]}`,
        'Props: tiering (replace, optional)',
        '  widgets: nothing passed',
        'Pack: widgets',
        ...FIXED,
      ].join('\n')
    );
  });

  it('omits Props and layer lines for a block with no props', () => {
    const out = buildBlockContext({
      payload: miniPayload,
      block: find('mini/run'),
    });
    expect(out).not.toContain('Props:');
    expect(out).not.toContain('nothing passed');
    expect(out).not.toContain('undefined');
    expect(out).toContain('Pack: widgets\n');
  });

  it('lists each prop with its layers and the base the pack extends', () => {
    const block: PayloadBlock = {
      ...find('mini/run'),
      title: null,
      label: 'Run',
      props: [
        prop('rules', {
          values: [
            {
              layer: 'pack',
              color: 'team',
              binding: 'widgets:lint',
              path: '/w/ship-lint/fast-checks.md',
              lines: 3,
            },
          ],
        }),
        prop('tiering', { merge: 'replace', default: 'x' }),
      ],
    };
    expect(buildBlockContext({ payload: basePayload, block })).toBe(
      [
        'Block: mini/run',
        '  "Run"',
        `File: …/${block.path.split('/attachments/')[1]}`,
        'Props: rules (add, required)',
        '  widgets: /w/ship-lint/fast-checks.md',
        '  acme-base: nothing passed',
        'Props: tiering (replace, optional)',
        '  widgets: nothing passed',
        '  acme-base: nothing passed',
        'Pack: widgets, extends acme-base',
        ...FIXED,
      ].join('\n')
    );
  });

  it('shortens a path to the part under its attachments folder, as the spec draws it', () => {
    const block: PayloadBlock = {
      ...find('mini/run'),
      path: '/home/.mattstack/plugins/mattstack/attachments/pipeline/ship/flow/fast-checks.block.md',
      props: [
        prop('rules', {
          values: [
            {
              layer: 'pack',
              color: 'team',
              binding: 'widgets:ship-lint/fast-checks',
              path: '/home/pack/attachments/ship-lint/fast-checks.md',
              lines: 2,
            },
          ],
        }),
      ],
    };
    const out = buildBlockContext({ payload: basePayload, block });
    expect(out).toContain('File: …/pipeline/ship/flow/fast-checks.block.md\n');
    expect(out).toContain('  widgets: …/ship-lint/fast-checks.md\n');
  });
});
