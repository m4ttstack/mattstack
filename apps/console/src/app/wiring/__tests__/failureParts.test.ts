import { describe, expect, it } from 'vitest';

import { failureParts } from '../failureParts';

const text = (line: string) => ({ kind: 'text', text: line });

describe('failureParts', () => {
  it('keeps a one-line failure as it is', () => {
    expect(failureParts('rt exploded')).toEqual({
      blocks: [text('rt exploded')],
      next: null,
    });
  });

  it('sets the command rt suggests apart', () => {
    expect(
      failureParts(
        'The acme pack has no skill called work\n  next: rt skills surface list --pack acme'
      )
    ).toEqual({
      blocks: [text('The acme pack has no skill called work')],
      next: 'rt skills surface list --pack acme',
    });
  });

  it('keeps the lines after the command, and drops the why label', () => {
    expect(
      failureParts(
        [
          'acme could not be compiled',
          '  why: Its skills are single SKILL.md files, and this rt compiles only block trees.',
          '  next: claude plugin update mattstack@mattstack',
          '  "provision": loadStepSource: provision has no index.block.md',
        ].join('\n')
      )
    ).toEqual({
      blocks: [
        text('acme could not be compiled'),
        text(
          'Its skills are single SKILL.md files, and this rt compiles only block trees.'
        ),
        text('"provision": loadStepSource: provision has no index.block.md'),
      ],
      next: 'claude plugin update mattstack@mattstack',
    });
  });

  it('gathers the findings about one file under its path, with their lines', () => {
    expect(
      failureParts(
        [
          "This pack's base cannot be used",
          '  acme-base:attachments/board-doctor/SKILL.md: hand-typed path ../checkout/SKILL.md (line 153)',
          '',
          '  acme-base:attachments/board-doctor/SKILL.md: hand-typed path ../respond/SKILL.md',
          '  acme-base:attachments/board-respond/SKILL.md: hand-typed path ../receive-review/SKILL.md (line 37)',
        ].join('\n')
      ).blocks
    ).toEqual([
      text("This pack's base cannot be used"),
      {
        kind: 'file',
        path: 'acme-base:attachments/board-doctor/SKILL.md',
        findings: [
          { text: 'hand-typed path ../checkout/SKILL.md', line: '153' },
          { text: 'hand-typed path ../respond/SKILL.md', line: null },
        ],
      },
      {
        kind: 'file',
        path: 'acme-base:attachments/board-respond/SKILL.md',
        findings: [
          { text: 'hand-typed path ../receive-review/SKILL.md', line: '37' },
        ],
      },
    ]);
  });
});
