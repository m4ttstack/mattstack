// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { designFixture } from '../../__tests__/designFixtures';
import { appSkillView } from '../templateModel';

const composition = designFixture('composition');
const TIERING = '/fixture/mattstack/attachments/model-tiering/SKILL.md';

describe('appSkillView', () => {
  it('builds a skill another app owns from the slots this pack fills', () => {
    const { view, anatomy } = appSkillView(
      composition,
      'board:doctor',
      'acme'
    )!;

    expect(view).toMatchObject({
      skill: 'board:doctor',
      templateFile: 'board:doctor',
      templateMeta: 'board app · 1 slot',
      app: 'board',
      links: [],
      output: null,
    });
    expect(view.rows).toEqual([
      expect.objectContaining({
        kind: 'placeholder',
        placeholder: 'slot',
        code: '{{slot:tiering}}',
        name: 'tiering',
        boundTo: 'mattstack:model-tiering',
        state: 'ok',
      }),
    ]);
    expect(view.inputs).toEqual([
      expect.objectContaining({
        rowId: view.rows[0]!.id,
        title: 'model-tiering/SKILL.md',
        subtitle: 'mattstack default · picked by this pack',
        icon: 'fileText',
        path: TIERING,
      }),
    ]);
    expect(anatomy.description).toBe(
      'Lives in the board app. acme fills its 1 slot.'
    );
  });

  it('calls a fill that came from the org base an org base, not written by the pack', () => {
    const fromBase = {
      ...composition,
      binders: composition.binders.map(binder =>
        binder.ref === 'board:doctor'
          ? {
              ...binder,
              slots: [
                {
                  name: 'domain',
                  boundTo: 'acme:board-fill',
                  layer: 'pack',
                  origin: 'base' as const,
                  base: 'acme-base',
                  baseVersion: '0.1.0',
                },
              ],
            }
          : binder
      ),
      fills: [
        ...composition.fills,
        {
          binding: 'acme:board-fill',
          provides: 'board-fill@1',
          sourcePath: '/fixture/packs/acme/attachments/board-fill/SKILL.md',
          registered: true,
        },
      ],
    };
    const { view } = appSkillView(fromBase, 'board:doctor', 'acme')!;

    expect(view.inputs[0]!.subtitle).toBe(
      'acme-base · org base · picked by this pack'
    );
  });

  it('builds nothing for a skill this pack does not fill as another app', () => {
    expect(appSkillView(composition, 'work', 'acme')).toBeNull();
  });
});
