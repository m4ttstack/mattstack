import '../../icons';

import { parseEvidence } from '@mattstack/rt-client/evidence';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { EvidenceCard } from './EvidenceCard';

/** The images come from the console's own evidence route, so a story shows
    pictures only when the design fixture server is behind `/api` (see the
    parity runbook); otherwise every image reads "image unavailable". */
const REPO = 'remote:acme%2Fweb';
const RUN = '20261008-1142';

const queryClient = new QueryClient();

const FULL = parseEvidence(
  JSON.stringify({
    v: 1,
    before: '/fixture/evidence/web-409/before.png',
    after: '/fixture/evidence/web-409/after.png',
    afterAnnotated: '/fixture/evidence/web-409/after-annotated.png',
    transcript: '/fixture/evidence/web-409/transcript-after.md',
    case: 'Rush order, Sep 14 delay, Denver',
    attach: 'ship',
  })
);

const ANNOTATED_BEFORE = parseEvidence(
  JSON.stringify({
    v: 1,
    before: '/fixture/evidence/web-412/web-412-before.png',
    beforeAnnotated: '/fixture/evidence/web-412/web-412-before-annotated.png',
    case: 'An order with one linked parcel, tracking unknown',
  })
);

const meta = {
  title: 'Runs/Run page/EvidenceCard',
  component: EvidenceCard,
  decorators: [
    Story => (
      <QueryClientProvider client={queryClient}>
        <div style={{ padding: '1.5rem', maxWidth: 520 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  parameters: { layout: 'padded' },
  args: { repo: REPO, runId: RUN },
} satisfies Meta<typeof EvidenceCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const StoryPlainAndAnnotated: Story = {
  args: {
    runId: '20261008-1338',
    evidence: ANNOTATED_BEFORE,
    variant: 'story',
    phase: 'before',
  },
};

export const StoryBeforeAndAfter: Story = {
  args: { evidence: FULL, variant: 'story', phase: 'before' },
};

export const StoryAfterOnly: Story = {
  args: { evidence: FULL, variant: 'story', phase: 'after' },
};

export const ImageUnavailable: Story = {
  args: {
    runId: 'no-such-run',
    evidence: ANNOTATED_BEFORE,
    variant: 'story',
    phase: 'before',
  },
};

const LEGACY = parseEvidence(
  '/Users/acme/.mattstack/evidence/web-377/before.png /Users/acme/.mattstack/evidence/web-377/after.png http://localhost:4001/orders/4821#parcels 12/12 cards'
);

export const LegacyScreenshots: Story = {
  args: { runId: '20261007-1520', evidence: LEGACY, variant: 'story' },
};

export const LegacyRecord: Story = {
  args: { runId: '20261007-1520', evidence: LEGACY, variant: 'record' },
};

export const RecordColumn: Story = {
  args: { evidence: FULL, variant: 'record', mrIid: '405' },
};

export const RecordColumnNoMr: Story = {
  args: {
    runId: '20261008-1338',
    evidence: ANNOTATED_BEFORE,
    variant: 'record',
  },
};
