import '../../icons';

import { parseEvidence } from '@mattstack/rt-client/evidence';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { EvidenceCompare } from './EvidenceCompare';
import type { EvidenceV1Parsed } from './evidenceImages';

const parsed = parseEvidence(
  JSON.stringify({
    v: 1,
    before: '/fixture/evidence/web-409/before.png',
    after: '/fixture/evidence/web-409/after.png',
    afterAnnotated: '/fixture/evidence/web-409/after-annotated.png',
  })
);
if (parsed.version !== 1) throw new Error('fixture evidence is not v1');
const EVIDENCE: EvidenceV1Parsed = parsed;

/** Needs the design fixture server behind `/api` to show pictures. */
const meta = {
  title: 'Runs/Run page/EvidenceCompare',
  component: EvidenceCompare,
  parameters: { layout: 'fullscreen' },
  args: {
    repo: 'remote:acme%2Fweb',
    runId: '20261008-1142',
    evidence: EVIDENCE,
    title: 'WEB-409 · Rush order, Sep 14 delay, Denver',
    onClose: () => {},
  },
} satisfies Meta<typeof EvidenceCompare>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SideBySide: Story = {};

export const OnAfter: Story = { args: { mode: 'after' } };

export const OnBeforePlain: Story = {
  args: { mode: 'before', variant: 'plain' },
};
