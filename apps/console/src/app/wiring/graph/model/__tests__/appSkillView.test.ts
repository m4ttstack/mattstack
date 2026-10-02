// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { designFixture } from '../../__tests__/designFixtures';
import { drawerContent, parseTarget } from '../drawerContent';
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

  it('builds nothing for a skill this pack does not fill as another app', () => {
    expect(appSkillView(composition, 'work', 'acme')).toBeNull();
  });

  it('opens the fill a slot row or its card names in the drawer', () => {
    const { view, anatomy } = appSkillView(
      composition,
      'board:doctor',
      'acme'
    )!;
    const viaCard = drawerContent(
      parseTarget(`input:${view.inputs[0]!.id}`)!,
      view,
      anatomy,
      null
    );

    expect(viaCard).toMatchObject({
      filePath: TIERING,
      fileLabel: 'model-tiering/SKILL.md',
      canToggle: false,
      tabs: ['text', 'used-by'],
      slot: null,
      usedBy: { kind: 'fill', name: 'mattstack:model-tiering' },
      sentence:
        'A mattstack default. board:doctor reads it through its tiering slot.',
    });
    expect(drawerContent(parseTarget('row:1')!, view, anatomy, null)).toEqual(
      viaCard
    );
  });
});
