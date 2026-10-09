import '../../icons';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { ReviewVerdict } from './ReviewVerdict';

const meta = {
  title: 'Runs/Run page/ReviewVerdict',
  component: ReviewVerdict,
  decorators: [
    Story => (
      <div style={{ padding: '1.5rem', maxWidth: 780 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewVerdict>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithUnpostedFindings: Story = {
  args: {
    verdict: 'Request changes',
    mrIid: '412',
    mrUrl: 'https://forge.test/acme/web/-/merge_requests/412',
    findings: [
      {
        severity: 'important',
        text: 'Dedupe matches on email only, so contacts without an email import twice.',
        where: 'contacts/import/dedupe.ts:58',
      },
      {
        severity: 'important',
        text: 'No test covers merging two contacts that share a phone number.',
        where: null,
      },
    ],
    notPosted: [
      {
        severity: 'minor',
        text: "mergeContacts deletes the losing record; the name doesn't say so.",
        where: 'contacts/merge.ts:12',
      },
      {
        severity: 'minor',
        text: 'The skip log prints the whole contact record, email included.',
        where: null,
      },
    ],
  },
};
