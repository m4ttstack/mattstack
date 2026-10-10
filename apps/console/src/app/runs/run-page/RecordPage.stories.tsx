import '../../icons';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { RecordHeader } from './RecordHeader';

/** The record view's parts in the states the record boards draw. The whole
    page reads the run's routes, so it is checked against the design fixture
    (see the parity runbook) rather than here. */
const queryClient = new QueryClient();

const meta = {
  title: 'Runs/Run page/Record parts',
  decorators: [
    Story => (
      <QueryClientProvider client={queryClient}>
        <div style={{ padding: '1.5rem', maxWidth: 1300 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type S = StoryObj<typeof meta>;

export const HeaderMerged: S = {
  render: () => (
    <RecordHeader
      ticket="WEB-409"
      ticketUrl="https://linear.app/acme/issue/WEB-409"
      meta="work pipeline · Oct 8, 11:42 AM → 2:14 PM"
      title="Add a tracking summary to the shipping panel"
      outcome={{
        status: 'done',
        mr: { iid: 405, state: 'merged', url: null },
        ci: 'success',
      }}
      stats={[
        { id: 'duration', value: '2h 32m', label: 'start to merge' },
        { id: 'decisions', value: '8', label: 'decisions' },
        { id: 'took', value: '6 of 8', label: 'took the recommendation' },
        { id: 'waiting', value: '25m', label: 'waiting on you' },
      ]}
    />
  ),
};

export const HeaderAbandoned: S = {
  render: () => (
    <RecordHeader
      ticket="WEB-366"
      ticketUrl="https://linear.app/acme/issue/WEB-366"
      meta="work pipeline · Oct 8, 11:42 AM → 2:14 PM"
      title="Show the author on imported notes"
      outcome={{ status: 'abandoned' }}
      stats={[
        { id: 'duration', value: '2h 32m', label: 'start to end' },
        { id: 'decisions', value: '3', label: 'decisions' },
        { id: 'waiting', value: '40m', label: 'waiting on you' },
      ]}
      abandoned="“Superseded by WEB-430”"
    />
  ),
};

export const HeaderReview: S = {
  render: () => (
    <RecordHeader
      ticket="!412"
      ticketUrl={null}
      meta="review pipeline · Oct 8, 9:40 AM → 10:03 AM"
      title="dedupe-contacts"
      outcome={{
        status: 'done',
        reviewed: { iid: 412, url: null, posted: 'request changes' },
      }}
      stats={[
        { id: 'duration', value: '23m', label: 'start to end' },
        { id: 'decisions', value: '1', label: 'decision' },
        { id: 'waiting', value: '6m', label: 'waiting on you' },
      ]}
    />
  ),
};
