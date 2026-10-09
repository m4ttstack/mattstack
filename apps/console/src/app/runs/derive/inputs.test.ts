import type { RunDecisionRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import type {
  EffectiveInputsPayload,
  PackVersionRow,
} from '../../../server/effectiveInputs';
import { formatClock } from './clock';
import {
  decisionSentence,
  docPreview,
  inputsSummary,
  packState,
  settingValue,
  stripComments,
  stripFrontmatter,
} from './inputs';

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

describe('stripComments', () => {
  it('drops a comment-only line whole', () => {
    expect(stripComments('<!-- compiled by rt -->\n# Plan\n')).toBe('# Plan\n');
  });

  it('drops an inline and a multi-line comment', () => {
    expect(stripComments('a <!-- x --> b\n<!--\nmany\n-->\nc')).toBe('a  b\nc');
  });

  it('leaves comments inside a fenced block alone', () => {
    const fenced = '```\n<!-- literal -->\n```\n<!-- gone -->\nend';
    expect(stripComments(fenced)).toBe('```\n<!-- literal -->\n```\nend');
  });

  it('lets frontmatter after a compile banner still drop', () => {
    expect(
      stripFrontmatter(
        stripComments('<!-- compiled -->\n---\nname: x\n---\n# Plan')
      )
    ).toBe('# Plan');
  });
});

describe('stripFrontmatter', () => {
  it('drops a leading YAML block', () => {
    expect(stripFrontmatter('---\nname: x\n---\n# Plan\nbody')).toBe(
      '# Plan\nbody'
    );
  });

  it('leaves a doc with no frontmatter, or a later rule, alone', () => {
    expect(stripFrontmatter('# Plan\n\n---\n\nbody')).toBe(
      '# Plan\n\n---\n\nbody'
    );
  });

  it('drops an empty block', () => {
    expect(stripFrontmatter('---\n---\n# Plan')).toBe('# Plan');
  });

  it('takes the blank lines after the block too', () => {
    expect(stripFrontmatter('---\r\nname: x\r\n---\r\n\r\n# Plan')).toBe(
      '# Plan'
    );
  });
});

describe('docPreview', () => {
  const doc = [
    '---',
    'name: stage-plan',
    '---',
    '',
    '# Plan',
    '',
    'Read the ticket, then write the plan.',
    '',
    '## Questions to ask',
    '',
    '- Which approach',
    '- How it is delivered',
    '',
    '## Stop for review',
    '',
    'Ask for review.',
  ].join('\n');

  it('keeps the first paragraph and the first list, without headings', () => {
    expect(docPreview(doc)).toBe(
      'Read the ticket, then write the plan.\n\n- Which approach\n- How it is delivered'
    );
  });

  it('falls back to the first paragraph when there is no list', () => {
    expect(docPreview('# T\n\nOnly this.\n\n## More\n\nNot this.')).toBe(
      'Only this.'
    );
  });
});

describe('decisionSentence', () => {
  const row = (over: Partial<RunDecisionRow> = {}): RunDecisionRow => ({
    contract: 'execution-strategy@1',
    scope: 'implement:1',
    selection: '{"strategy":"subagent-driven","tasks":5}',
    decided_by: 'agent',
    decided_at: new Date(2026, 9, 8, 15, 49).getTime(),
    ...over,
  });

  it('reads a decision as a label, a sentence and who made it when', () => {
    expect(formatClock(row().decided_at)).toBe('3:49 PM');
    expect(decisionSentence(row())).toEqual({
      label: 'Execution strategy',
      value: 'Subagent-driven, 5 tasks',
      meta: 'implement · agent · 3:49 PM',
    });
  });

  it('keeps a selection that is not JSON as it was written', () => {
    expect(
      decisionSentence(row({ selection: 'direct-tdd', scope: 'run' }))
    ).toEqual({
      label: 'Execution strategy',
      value: 'direct-tdd',
      meta: 'run · agent · 3:49 PM',
    });
  });

  it('counts one of a thing in the singular', () => {
    expect(
      decisionSentence(row({ selection: '{"strategy":"direct","tasks":1}' }))
        .value
    ).toBe('Direct, 1 task');
  });

  it('names a true flag and leaves out a false one', () => {
    expect(
      decisionSentence(
        row({
          selection: '{"tier":"direct-tdd","worktree":true,"push":false}',
        })
      ).value
    ).toBe('Direct-tdd, worktree');
  });
});

describe('settingValue', () => {
  it('shows a string bare and anything else as short JSON', () => {
    expect(settingValue('~/worktrees')).toBe('~/worktrees');
    expect(settingValue(30)).toBe('30');
    expect(settingValue({ root: '~/w' })).toBe('{"root":"~/w"}');
  });
});

describe('packState', () => {
  const pack = (over: Partial<PackVersionRow> = {}): PackVersionRow => ({
    pack: 'acme',
    recordedSha: '4c1d9e2b7a',
    currentSha: '4c1d9e2b7a51',
    drifted: false,
    ...over,
  });

  it('says whether the source still matches, and by how much it moved', () => {
    expect(packState(pack())).toEqual({ label: 'matches source', tone: 'ok' });
    expect(
      packState(pack({ drifted: true, currentSha: 'f', commitsSince: 3 }))
    ).toEqual({ label: 'moved since · 3 commits', tone: 'warn' });
    expect(
      packState(pack({ drifted: true, currentSha: 'f', commitsSince: 1 }))
    ).toEqual({ label: 'moved since · 1 commit', tone: 'warn' });
    expect(packState(pack({ drifted: true, currentSha: 'f' }))).toEqual({
      label: 'moved since',
      tone: 'warn',
    });
    expect(packState(pack({ drifted: null, currentSha: null }))).toEqual({
      label: 'pack not found here',
      tone: 'quiet',
    });
  });
});
