// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { SkillsChanges } from '../../useWiring';
import { pendingChangesOf, sameChanges } from '../model/pendingChanges';
import { designFixture } from './designFixtures';

const composition = designFixture('composition');

const rebind = (extra: SkillsChanges['files'] = []): SkillsChanges => {
  const changes = designFixture('changes.unsynced');
  return { ...changes, files: [...changes.files, ...extra] };
};

/** The composition once `skill` compiles internal, as rt reports it after
    the move. */
function movedInternal(skill: string) {
  const moved = designFixture('composition');
  moved.targets = moved.targets!.map(target =>
    target.name === skill
      ? {
          ...target,
          artifactPath: `/fixture/packs/acme/attachments/${skill}/SKILL.md`,
        }
      : target
  );
  return moved;
}

const names = (changes: SkillsChanges, withComposition = true) =>
  pendingChangesOf(changes, withComposition ? composition : undefined).map(
    change => change.name
  );

describe('pendingChangesOf', () => {
  it('names a rebind once, hiding its bindings file and the stage it rebuilt', () => {
    expect(
      names(rebind([{ path: 'attachments/stage-plan/SKILL.md', status: 'M' }]))
    ).toEqual(['plan']);
  });

  it("lists another skill's compiled output, which the rebind did not rebuild", () => {
    expect(
      names(rebind([{ path: 'skills/work/SKILL.md', status: 'M' }]))
    ).toEqual(['plan', 'skills/work/SKILL.md']);
  });

  it('lists a hand-edited fill beside a rebind', () => {
    expect(
      names(
        rebind([
          { path: 'attachments/plan-policy-strict/SKILL.md', status: 'M' },
        ])
      )
    ).toEqual(['plan', 'attachments/plan-policy-strict/SKILL.md']);
  });

  it("hides a compiled skill's surface move: its file, its new output, and its old output's removal", () => {
    const changes: SkillsChanges = {
      ...designFixture('changes.clean'),
      dirty: true,
      surface: [{ skill: 'review', from: 'public', to: 'internal' }],
      files: [
        { path: 'pack/surface.jsonc', status: 'M' },
        { path: 'skills/review/SKILL.md', status: 'D' },
        { path: 'attachments/review/SKILL.md', status: '??' },
        { path: 'skills/review/references/notes.md', status: '??' },
        { path: 'skills/work/SKILL.md', status: 'M' },
      ],
    };
    expect(
      pendingChangesOf(changes, movedInternal('review')).map(c => c.name)
    ).toEqual([
      'review',
      'skills/review/references/notes.md',
      'skills/work/SKILL.md',
    ]);
  });

  it('reads where a compiled skill moved to from the change, not from a composition read before the move', () => {
    const changes: SkillsChanges = {
      ...designFixture('changes.clean'),
      dirty: true,
      surface: [{ skill: 'review', from: 'public', to: 'internal' }],
      files: [
        { path: 'pack/surface.jsonc', status: 'M' },
        { path: 'skills/review/SKILL.md', status: 'D' },
        { path: 'attachments/review/SKILL.md', status: '??' },
        { path: 'skills/review/references/notes.md', status: '??' },
        { path: 'skills/work/SKILL.md', status: 'M' },
      ],
    };
    const fresh = pendingChangesOf(changes, movedInternal('review'));
    const stale = pendingChangesOf(changes, composition);

    expect(stale).toEqual(fresh);
    expect(stale.map(c => c.name)).toEqual([
      'review',
      'skills/review/references/notes.md',
      'skills/work/SKILL.md',
    ]);
  });

  it("lists every file of a hand-authored skill's surface move, which rt moves as source", () => {
    const changes: SkillsChanges = {
      ...designFixture('changes.clean'),
      dirty: true,
      surface: [{ skill: 'house-style', from: 'public', to: 'internal' }],
      files: [
        { path: 'pack/surface.jsonc', status: 'M' },
        {
          path: 'attachments/house-style/SKILL.md',
          status: 'R',
          from: 'skills/house-style/SKILL.md',
        },
        { path: 'attachments/house-style/references/x.md', status: '??' },
      ],
    };
    expect(
      pendingChangesOf(changes, composition).map(c => [c.name, c.detail])
    ).toEqual([
      ['house-style', 'public → internal'],
      [
        'attachments/house-style/SKILL.md',
        'renamed from skills/house-style/SKILL.md',
      ],
      ['attachments/house-style/references/x.md', 'added'],
    ]);
  });

  it('hides the output of a skill that links to the moved skill by path', () => {
    const linked = designFixture('composition');
    linked.targets = linked.targets!.map(target =>
      target.name === 'work'
        ? {
            ...target,
            placeholders: [
              ...target.placeholders,
              { kind: 'verb.path', arg: 'review', line: 99 },
            ],
          }
        : target
    );
    const changes: SkillsChanges = {
      ...designFixture('changes.clean'),
      dirty: true,
      surface: [{ skill: 'review', from: 'public', to: 'internal' }],
      files: [
        { path: 'pack/surface.jsonc', status: 'M' },
        { path: 'skills/work/SKILL.md', status: 'M' },
      ],
    };
    expect(pendingChangesOf(changes, linked).map(c => c.name)).toEqual([
      'review',
    ]);
  });

  it('lists every file when no binding or surface change explains them', () => {
    const changes: SkillsChanges = {
      ...designFixture('changes.clean'),
      dirty: true,
      files: [
        { path: 'pack/skills.jsonc', status: 'M' },
        { path: 'attachments/stage-plan/SKILL.md', status: 'M' },
      ],
    };
    expect(names(changes)).toEqual([
      'pack/skills.jsonc',
      'attachments/stage-plan/SKILL.md',
    ]);
  });

  it('lists rebuilt output until the composition says what was rebuilt', () => {
    expect(
      names(
        rebind([{ path: 'attachments/stage-plan/SKILL.md', status: 'M' }]),
        false
      )
    ).toEqual(['plan', 'attachments/stage-plan/SKILL.md']);
  });
});

describe('sameChanges', () => {
  const base = rebind([{ path: 'attachments/notes.md', status: '??' }]);

  it('matches the same changes in another order, whatever lies outside the pack', () => {
    expect(
      sameChanges(base, {
        ...base,
        files: [...base.files].reverse(),
        outsideScope: [{ path: 'README.md', status: 'M' }],
      })
    ).toBe(true);
  });

  it.each<[string, Partial<SkillsChanges>]>([
    [
      'a file added',
      { files: [...base.files, { path: 'pack/extra.md', status: '??' }] },
    ],
    [
      "a file's status",
      {
        files: base.files.map(f =>
          f.path === 'attachments/notes.md' ? { ...f, status: 'A' } : f
        ),
      },
    ],
    [
      'a binding',
      {
        bindings: [{ ...base.bindings[0]!, to: 'acme:plan-policy-lite' }],
      },
    ],
    [
      'a surface change',
      { surface: [{ skill: 'review', from: 'public', to: 'internal' }] },
    ],
  ])('tells %s apart', (_, change) => {
    expect(sameChanges(base, { ...base, ...change })).toBe(false);
  });
});
