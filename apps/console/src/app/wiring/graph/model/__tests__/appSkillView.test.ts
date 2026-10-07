// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { designFixture } from '../../__tests__/designFixtures';
import { drawerContent, highlightOf, parseTarget } from '../drawerContent';
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
    const { view, anatomy } = appSkillView(fromBase, 'board:doctor', 'acme')!;

    expect(view.inputs[0]!.subtitle).toBe(
      'acme-base · org base · picked by this pack'
    );
    expect(
      drawerContent(
        parseTarget(`input:${view.inputs[0]!.id}`)!,
        view,
        anatomy,
        null
      )
    ).toMatchObject({
      meta: 'acme-base 0.1.0 · org base pack, read only here',
      badge: 'partial',
      sentence:
        "From the org's acme-base base pack. board:doctor reads it through its domain slot. Compile copies it from the org's acme-base base pack and rewrites it on every compile; edit it there.",
      usedBy: { kind: 'fill', owner: { kind: 'base', name: 'acme-base' } },
    });
  });

  it('builds nothing for a skill this pack does not fill as another app', () => {
    expect(appSkillView(composition, 'work', 'acme')).toBeNull();
  });

  it('opens the fill from its card', () => {
    const { view, anatomy } = appSkillView(
      composition,
      'board:doctor',
      'acme'
    )!;

    expect(
      drawerContent(
        parseTarget(`input:${view.inputs[0]!.id}`)!,
        view,
        anatomy,
        null
      )
    ).toMatchObject({
      filePath: TIERING,
      fileLabel: 'model-tiering/SKILL.md',
      canToggle: false,
      tabs: ['text', 'used-by'],
      slot: null,
      usedBy: { kind: 'fill', name: 'mattstack:model-tiering' },
      sentence:
        'A mattstack default. board:doctor reads it through its tiering slot.',
    });
  });

  it('opens the installed skill itself from a slot row', () => {
    const installed = {
      ...composition,
      binders: composition.binders.map(binder =>
        binder.ref === 'board:doctor'
          ? { ...binder, skillFile: '/claude/skills/board:doctor/SKILL.md' }
          : binder
      ),
    };
    const { view, anatomy } = appSkillView(installed, 'board:doctor', 'acme')!;

    expect(
      drawerContent(parseTarget('row:1')!, view, anatomy, null)
    ).toMatchObject({
      filePath: '/claude/skills/board:doctor/SKILL.md',
      fileLabel: 'board:doctor/SKILL.md',
      meta: 'board app · installed skill, read only',
      tabs: ['text'],
      usedBy: null,
      sentence:
        'board:doctor declares its tiering slot here and reads it when it runs; acme fills it with mattstack:model-tiering.',
    });
  });

  it('highlights the line where the installed skill declares the slot', () => {
    const installed = {
      ...composition,
      binders: composition.binders.map(binder =>
        binder.ref === 'board:doctor'
          ? { ...binder, skillFile: '/claude/skills/board:doctor/SKILL.md' }
          : binder
      ),
    };
    const { view, anatomy } = appSkillView(installed, 'board:doctor', 'acme')!;
    const content = drawerContent(parseTarget('row:1')!, view, anatomy, null)!;
    const lines = [
      '---',
      'name: board:doctor',
      'metadata:',
      '  slots: "tiering,other"',
      '  slot-other: "required x@1"',
      '  slot-tiering: "required model-tiering@1 -- picks the model"',
      '---',
    ];

    expect(highlightOf(content, lines)).toEqual([6, 6]);
    expect(highlightOf(content, ['---', 'no declaration', '---'])).toBeNull();
  });

  it('opens the fill from a slot row when the skill is not installed', () => {
    const { view, anatomy } = appSkillView(
      composition,
      'board:doctor',
      'acme'
    )!;

    expect(
      drawerContent(parseTarget('row:1')!, view, anatomy, null)?.filePath
    ).toBe(TIERING);
  });
});
