import '../../icons';

import { readEvidence } from '@mattstack/rt-client/evidence';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { EvidenceCard } from './EvidenceCard';

/** The images come from the console's own evidence route, so a story shows
    pictures only when the design fixture server is behind `/api` (see the
    parity runbook); otherwise every image reads "image unavailable". */
const REPO = 'remote:acme%2Fweb';
const RUN = '20261008-1142';

const WEB_421 = readEvidence(
  JSON.stringify({
    v: 2,
    cases: [
      {
        id: 'rush-window',
        label: 'Rush order, same-day window',
        before: {
          path: '/fixture/evidence/web-421/rush-before.png',
          annotated: '/fixture/evidence/web-421/rush-before-annotated.png',
          caption: 'Red box: the order card shows no delivery window',
        },
        after: {
          path: '/fixture/evidence/web-421/rush-after.png',
          annotated: '/fixture/evidence/web-421/rush-after-annotated.png',
          caption: 'Red box: "Today, 2–4 PM" now sits under the total',
        },
      },
      {
        id: 'order-card-themes',
        label: 'Order card in light and dark',
        before: {
          light: {
            path: '/fixture/evidence/web-421/card-before-light.png',
            annotated:
              '/fixture/evidence/web-421/card-before-light-annotated.png',
            caption: 'Red box: no window line under the total',
          },
          dark: {
            path: '/fixture/evidence/web-421/card-before-dark.png',
            annotated:
              '/fixture/evidence/web-421/card-before-dark-annotated.png',
            caption: 'Red box: no window line under the total',
          },
        },
        after: {
          light: {
            path: '/fixture/evidence/web-421/card-after-light.png',
            annotated:
              '/fixture/evidence/web-421/card-after-light-annotated.png',
            caption: 'Arrow: the window keeps its contrast on the card',
          },
          dark: {
            path: '/fixture/evidence/web-421/card-after-dark.png',
            waiver: 'Same marks as light; only the theme differs',
          },
        },
      },
      {
        id: 'empty-state',
        label: 'No delivery window yet',
        after: {
          path: '/fixture/evidence/web-421/empty-after.png',
        },
        waiver: 'Before and after are pixel-identical',
      },
    ],
    transcript: '/fixture/evidence/web-409/transcript-after.md',
    url: 'http://localhost:4001/orders/4821',
    attach: 'ship',
  })
);

const queryClient = new QueryClient();

const FULL = readEvidence(
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

const ANNOTATED_BEFORE = readEvidence(
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

const LEGACY = readEvidence(
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

export const RecordThreeCases: Story = {
  args: {
    runId: '20261008-1210',
    evidence: WEB_421,
    variant: 'record',
    ticket: 'WEB-421',
  },
};

export const StoryThreeCases: Story = {
  args: {
    runId: '20261008-1210',
    evidence: WEB_421,
    variant: 'story',
    phase: 'after',
    ticket: 'WEB-421',
  },
};
