import { describe, expect, it } from 'vitest';

import { parseSeam, splitCompiledBody } from './parseSeam';

/** Verbatim from `lib/skills/compile.ts` (`HEADER_COMMENT`). Invented text
    would pass this file's header test for the wrong reason -- every line
    that is not `<!-- part: ` returns null -- and pin nothing. */
const HEADER_COMMENT =
  '<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->';

const STEP_SEAM =
  '<!-- part: step source=mattstack:work version=0.8.0 path=attachments/pipeline/work/SKILL.md lines=17-135 -->';
const BLOCK_SEAM =
  '<!-- part: block:ship/flow source=mattstack:ship version=0.32.23 path=attachments/pipeline/ship/flow/index.block.md lines=4-60 -->';
const PROP_SEAM =
  '<!-- part: prop:ship/flow.tiering binding=mattstack:model-tiering version=0.8.0 path=attachments/model-tiering/SKILL.md lines=8-117 -->';
/** An author-fixed inline, so it carries `source=` like a step, with the
    attachment name inside the kind token like a prop. */
const INCLUDE_SEAM =
  '<!-- part: include:review-shared source=mattstack:review-shared version=0.9.0 path=attachments/review-shared/SKILL.md lines=3-40 -->';

describe('parseSeam: the shapes the compiler emits', () => {
  it('reads a step seam as its source, version, path and inclusive line span', () => {
    expect(parseSeam(STEP_SEAM)).toEqual({
      kind: 'step',
      name: null,
      ref: 'mattstack:work',
      version: '0.8.0',
      path: 'attachments/pipeline/work/SKILL.md',
      lines: [17, 135],
    });
  });

  it('reads a block seam by its source, naming the block the kind token carries', () => {
    expect(parseSeam(BLOCK_SEAM)).toEqual({
      kind: 'block',
      name: 'ship/flow',
      ref: 'mattstack:ship',
      version: '0.32.23',
      path: 'attachments/pipeline/ship/flow/index.block.md',
      lines: [4, 60],
    });
  });

  it('reads a prop seam by its binding, naming the block and prop the kind token carries', () => {
    // The prop's key lives INSIDE the kind token (`prop:<block>.<prop>`) and
    // the ref arrives under `binding=`, not `source=` -- a parser written for
    // the step shape alone reports every fill as unattributed.
    expect(parseSeam(PROP_SEAM)).toEqual({
      kind: 'prop',
      name: 'ship/flow.tiering',
      ref: 'mattstack:model-tiering',
      version: '0.8.0',
      path: 'attachments/model-tiering/SKILL.md',
      lines: [8, 117],
    });
  });

  it('reads an include seam by its source, naming the attachment the kind token carries', () => {
    // include is author-fixed, so its ref arrives under `source=` (not
    // `binding=`), and its target name lives inside the kind token like a
    // prop's. A parser that only knew step/prop would drop it, leaving the
    // inlined region unattributed.
    expect(parseSeam(INCLUDE_SEAM)).toEqual({
      kind: 'include',
      name: 'review-shared',
      ref: 'mattstack:review-shared',
      version: '0.9.0',
      path: 'attachments/review-shared/SKILL.md',
      lines: [3, 40],
    });
  });

  it('reads two include seams for one attachment split around a prop, by their spans', () => {
    // A shared attachment interrupted by a verb's prop emits as two includes
    // with the same ref and different spans (reply 2026-08-24). Both parse;
    // enumeration by ref must expect the repeat.
    const head = parseSeam(
      '<!-- part: include:review-shared source=mattstack:review-shared version=0.9.0 path=attachments/review-shared/SKILL.md lines=3-19 -->'
    );
    const tail = parseSeam(
      '<!-- part: include:review-shared source=mattstack:review-shared version=0.9.0 path=attachments/review-shared/SKILL.md lines=28-40 -->'
    );
    expect(head?.ref).toBe('mattstack:review-shared');
    expect(tail?.ref).toBe('mattstack:review-shared');
    expect(head?.lines).toEqual([3, 19]);
    expect(tail?.lines).toEqual([28, 40]);
  });
});

describe('parseSeam: a team section', () => {
  it('reads a section seam by its source, naming the section the kind token carries', () => {
    expect(
      parseSeam(
        '<!-- part: section:ci-extra source=widgets:pack/sections/ci-extra.md version=0.4.0 path=pack/sections/ci-extra.md lines=1-2 -->'
      )
    ).toEqual({
      kind: 'section',
      name: 'ci-extra',
      ref: 'widgets:pack/sections/ci-extra.md',
      version: '0.4.0',
      path: 'pack/sections/ci-extra.md',
      lines: [1, 2],
    });
  });

  it('returns null for a section seam with no name or a binding= ref', () => {
    expect(
      parseSeam(
        '<!-- part: section: source=widgets:x version=1 path=x.md lines=1-2 -->'
      )
    ).toBeNull();
    expect(
      parseSeam(
        '<!-- part: section:ci-extra binding=widgets:x version=1 path=x.md lines=1-2 -->'
      )
    ).toBeNull();
  });
});

describe('parseSeam: everything else is not a seam', () => {
  it('returns null for a truncated seam rather than a partly-filled object', () => {
    // A half-parsed seam heads a section with the wrong provenance, which is
    // worse than heading it with none.
    expect(parseSeam('<!-- part: step source=x -->')).toBeNull();
  });

  it('returns null when the kind and the ref key disagree', () => {
    // The emitter pairs `step` with `source=` and `prop:<key>` with
    // `binding=`. Accepting a crossed pair would invent a seam shape rt
    // cannot produce and attribute a section from it.
    expect(
      parseSeam(
        '<!-- part: step binding=mattstack:work version=0.8.0 path=a/SKILL.md lines=1-2 -->'
      )
    ).toBeNull();
    expect(
      parseSeam(
        '<!-- part: prop:work.tiering source=mattstack:model-tiering version=0.8.0 path=a/SKILL.md lines=1-2 -->'
      )
    ).toBeNull();
    // include is author-fixed like a step, so it pairs with `source=`; a
    // `binding=` include is the same crossed shape the emitter never writes.
    expect(
      parseSeam(
        '<!-- part: include:review-shared binding=mattstack:review-shared version=0.9.0 path=a/SKILL.md lines=1-2 -->'
      )
    ).toBeNull();
    expect(
      parseSeam(
        '<!-- part: block:ship binding=mattstack:ship version=1 path=a.md lines=1-2 -->'
      )
    ).toBeNull();
  });

  it('returns null for a prop seam with no block or no prop name', () => {
    for (const key of ['', 'tiering', '.tiering', 'work.'])
      expect(
        parseSeam(
          `<!-- part: prop:${key} binding=mattstack:x version=1 path=a/SKILL.md lines=1-2 -->`
        )
      ).toBeNull();
  });

  it('returns null for a slot seam, which rt no longer writes', () => {
    expect(
      parseSeam(
        '<!-- part: slot:tiering binding=mattstack:x version=1 path=a/SKILL.md lines=1-2 -->'
      )
    ).toBeNull();
  });

  it('returns null for a non-numeric line span', () => {
    expect(
      parseSeam(
        '<!-- part: step source=mattstack:work version=0.8.0 path=a/SKILL.md lines=eight-nine -->'
      )
    ).toBeNull();
  });

  it('does not read the compiler header as a seam', () => {
    expect(parseSeam(HEADER_COMMENT)).toBeNull();
  });

  it('does not read prose or a blank line as a seam', () => {
    expect(parseSeam('# work -- the orchestrator')).toBeNull();
    expect(parseSeam('')).toBeNull();
  });
});

describe('splitCompiledBody', () => {
  const BODY = [
    '---',
    'name: "work"',
    '---',
    '',
    HEADER_COMMENT,
    '',
    STEP_SEAM,
    '',
    '# work',
    '',
    'The orchestrator body.',
    '',
    PROP_SEAM,
    '',
    '# Model Tiering',
  ].join('\n');

  it('opens with the frontmatter and the compiler header, under no seam', () => {
    const [preamble] = splitCompiledBody(BODY);

    expect(preamble.seam).toBeNull();
    expect(preamble.text).toBe(
      ['---', 'name: "work"', '---', '', HEADER_COMMENT].join('\n')
    );
  });

  it('gives each seam its own section and keeps the seam line out of the text', () => {
    const sections = splitCompiledBody(BODY);

    expect(sections.map(s => s.seam?.name ?? s.seam?.kind ?? null)).toEqual([
      null,
      'step',
      'ship/flow.tiering',
    ]);
    expect(sections[1].text).toBe('# work\n\nThe orchestrator body.');
    expect(sections[2].text).toBe('# Model Tiering');
    expect(sections.some(s => s.text.includes('<!-- part:'))).toBe(false);
  });

  it('renders a body with no seams at all as one unattributed section', () => {
    // An errored or hand-authored body still has to reach the pane; dropping
    // everything that carries no seam would render a blank one.
    const sections = splitCompiledBody('---\nname: "work"\n---\n');

    expect(sections).toEqual([{ seam: null, text: '---\nname: "work"\n---' }]);
  });

  it('emits no empty leading section when a body opens on a seam', () => {
    const sections = splitCompiledBody(`${STEP_SEAM}\n\n# work`);

    expect(sections).toHaveLength(1);
    expect(sections[0].seam?.ref).toBe('mattstack:work');
  });
});
