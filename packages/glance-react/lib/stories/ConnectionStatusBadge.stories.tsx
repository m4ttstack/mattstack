import type { Meta, StoryObj } from '@storybook/react-vite';
import { ConnectionStatusBadge } from '../components/forge/ConnectionStatusBadge';

const meta: Meta<typeof ConnectionStatusBadge> = {
  title: 'Forge/ConnectionStatusBadge',
  component: ConnectionStatusBadge,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof ConnectionStatusBadge>;

/** Connecting — shown during initial WebSocket handshake. */
export const Connecting: Story = {
  args: { status: 'connecting' },
};

/** Connected — hidden by default. Set showWhenConnected to display. */
export const Connected: Story = {
  args: { status: 'connected', showWhenConnected: true },
};

/** Reconnecting — WebSocket dropped-out, attempting reconnection. */
export const Reconnecting: Story = {
  args: { status: 'reconnecting' },
};

/** Polling: no push channel, so data is fresh as of the last poll. Hidden by default. */
export const Polling: Story = {
  args: { status: 'polling', showWhenConnected: true },
};

/** Disconnected — connection lost, fast-polling active. */
export const Disconnected: Story = {
  args: { status: 'disconnected' },
};

/** All states side-by-side for comparison. */
export const AllStates: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <ConnectionStatusBadge status="connecting" />
      <ConnectionStatusBadge status="connected" showWhenConnected />
      <ConnectionStatusBadge status="reconnecting" />
      <ConnectionStatusBadge status="polling" showWhenConnected />
      <ConnectionStatusBadge status="disconnected" />
    </div>
  ),
};
