import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../../style.css';

import type { SupportPart } from '@mattstack/rt-client';
import type { SupportRead } from '../../../support.ts';
import { HelpButton, StatusCard } from './HelpButton.tsx';
import { HelpForm } from './HelpForm.tsx';
import {
  requestCard,
  sendErrorCard,
  type HelpMr,
  type HelpRequest,
} from './support-model.ts';
import {
  AWAY,
  DM,
  MORE_WORDS,
  MR,
  MR_PART,
  NO_SLACK,
  NOBODY,
  READY,
  request,
  SETUP,
  VERSIONS,
  WORDS,
} from './support.fixtures.ts';
import type { Help } from './use-support.ts';

const stage = (
  Story: () => ReactNode,
  context: { globals: { scheme?: string } }
) => (
  <div
    className={context.globals.scheme === 'dark' ? 'dark' : undefined}
    style={{
      background: 'var(--page)',
      color: 'var(--text-1)',
      minHeight: '100vh',
    }}
  >
    <SoribashiProvider theme={tuiTheme}>
      <Story />
    </SoribashiProvider>
  </div>
);

const meta = {
  title: 'Board/Help',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

const noop = () => {};

function help(
  o: {
    read?: SupportRead;
    request?: HelpRequest;
    text?: string;
    mr?: HelpMr;
    parts?: SupportPart[];
    open?: boolean;
  } = {}
): Help {
  return {
    read: o.read ?? READY,
    host: 'Alex',
    hostDm: READY.hostDm,
    request: o.request ?? null,
    requests: o.request ? [o.request] : [],
    open: o.open ?? false,
    setOpen: noop,
    askAbout: noop,
    text: o.text ?? '',
    setText: noop,
    mr: o.mr ?? null,
    parts: o.parts ?? [VERSIONS, SETUP],
    partsFailed: false,
    loadParts: noop,
    removePart: noop,
    sending: false,
    error: null,
    clearError: noop,
    send: noop,
    askAgain: noop,
    markSeen: noop,
  };
}

/** The fixed corner, laid out in a row of its own. */
const corner = (name: string, h: Help) => (
  <div
    key={name}
    data-state={name}
    style={{
      position: 'relative',
      transform: 'translate(0)',
      width: 230,
      height: 72,
    }}
  >
    <HelpButton help={h} />
  </div>
);

export const Buttons: Story = {
  render: () => (
    <div style={{ padding: 16, width: 260 }}>
      {corner('rest', help())}
      {corner('asked', help({ request: request('sent') }))}
      {corner('starting', help({ request: request('received') }))}
      {corner('waiting', help({ request: request('waiting') }))}
      {corner('slack', help({ request: request('opened', { dmLink: DM }) }))}
      {corner('failed', help({ request: request('failed') }))}
      {corner('disabled', help({ read: NO_SLACK }))}
    </div>
  ),
};

const popup = (name: string, children: ReactNode) => (
  <div
    key={name}
    data-state={name}
    data-part="popover-popup"
    className="tui-help-popup"
    style={{ border: '1px solid var(--border-on-card)' }}
  >
    {children}
  </div>
);

const grid = (children: ReactNode) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 380px)',
      alignItems: 'start',
      gap: 24,
      padding: 32,
    }}
  >
    {children}
  </div>
);

const form = (name: string, h: Help) =>
  popup(name, <HelpForm help={h} host="Alex" inputRef={null} onClose={noop} />);

export const Forms: Story = {
  render: () =>
    grid([
      form('empty', help()),
      form(
        'mr',
        help({
          text: "Review says done but I can't see any comments.",
          mr: MR,
          parts: [MR_PART, VERSIONS],
        })
      ),
      form('away', help({ read: AWAY, text: WORDS, parts: [VERSIONS] })),
      form('filled', help({ text: MORE_WORDS })),
      form('nobody', help({ read: NOBODY, text: WORDS })),
    ]),
};

const card = (name: string, r: HelpRequest, others: HelpRequest[] = []) =>
  popup(
    name,
    <StatusCard
      card={requestCard(r, 'Alex', 'Maude', others)}
      words={r.text}
      host="Alex"
      hostDm={READY.hostDm}
      onClose={noop}
    />
  );

export const Statuses: Story = {
  render: () =>
    grid([
      card('sent', request('sent')),
      card('received', request('received')),
      card('opened', request('opened', { dmLink: DM })),
      card('waiting', request('waiting')),
      card('away', request('sent', { away: true })),
      card('already-waiting', request('already-waiting'), [
        request('sent', { id: 'other' }),
      ]),
      card('already-open', request('already-open', { dmLink: DM })),
      card('declined', request('declined')),
      card('not-accepting', request('not-accepting')),
      card(
        'failed',
        request('failed', { reason: "Alex's Mac could not reach Slack" })
      ),
      card('expired', request('expired')),
      popup(
        'not-sent',
        <StatusCard
          card={sendErrorCard(
            { code: 'support-unreachable', message: '' },
            'Alex',
            false
          )}
          words={WORDS}
          host="Alex"
          hostDm={READY.hostDm}
          onClose={noop}
        />
      ),
      popup(
        'too-long',
        <StatusCard
          card={sendErrorCard(
            {
              code: 'support-too-long',
              message:
                'That is too long to send. Shorten it, or remove something attached.',
            },
            'Alex',
            false
          )}
          words={WORDS}
          host="Alex"
          hostDm={READY.hostDm}
          onClose={noop}
        />
      ),
    ]),
};
