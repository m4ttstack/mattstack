import '../../icons';

import {
  readEvidence,
  type EvidenceRecord,
} from '@mattstack/rt-client/evidence';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { EvidenceCompare } from './EvidenceCompare';

function casesOf(
  value: EvidenceRecord
): Extract<EvidenceRecord, { version: 2 }> {
  if (value.version !== 2) throw new Error('story evidence has no cases');
  return value;
}

const EVIDENCE = casesOf(
  readEvidence(
    JSON.stringify({
      v: 1,
      before: '/fixture/evidence/web-409/before.png',
      after: '/fixture/evidence/web-409/after.png',
      afterAnnotated: '/fixture/evidence/web-409/after-annotated.png',
    })
  )
);

const WEB_421 = casesOf(
  readEvidence(
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
  )
);

/** Needs the design fixture server behind `/api` to show pictures. */
const meta = {
  title: 'Runs/Run page/EvidenceCompare',
  component: EvidenceCompare,
  parameters: { layout: 'fullscreen' },
  args: {
    repo: 'remote:acme%2Fweb',
    runId: '20261008-1142',
    record: EVIDENCE,
    ticket: 'WEB-409',
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

export const ThreeCasesDark: Story = {
  args: {
    runId: '20261008-1210',
    record: WEB_421,
    ticket: 'WEB-421',
    caseId: 'order-card-themes',
    theme: 'dark',
  },
};
