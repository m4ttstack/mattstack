import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { BoardMRWithReview, OrgTeam } from '../types.ts';
import { askPickerModel } from './ask-picker.ts';
import { AskPicker } from './AskPicker.tsx';

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
  title: 'Board/AskPicker',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

const people = (names: string[]) =>
  names.map(name => ({
    username: name.toLowerCase().replace(' ', '.'),
    name,
  }));

const teams: OrgTeam[] = [
  { name: 'billing', members: people(['Ines Duarte', 'Petra Novak']) },
  {
    name: 'checkout',
    members: people(['Mira Fixture', 'Rae Marlow', 'Jun Okafor', 'Anika Bose']),
  },
  {
    name: 'identity',
    members: people(['Marta Quill', 'Deshawn Ito', 'Greta Lindqvist']),
  },
  {
    name: 'sprockets',
    members: people([
      'Nia Okoro',
      'Sam Whitlow',
      'Odile Varga',
      'Tomas Reyne',
      'Priya Castellan',
      'Hugo Brandt',
      'Mirela Stoica',
      'Callum Aird',
      'Yuki Tanabe',
      'Noor Halabi',
      'Elias Fontaine',
      'Wren Adeyemi',
      'Dara Kowalczyk',
      'Bastien Lu',
    ]),
  },
  { name: 'ledger', members: people(['Kofi Mensah']) },
  { name: 'search', members: people(['Aline Roux', 'Otto Brask']) },
];

const everyone = teams.flatMap(t => t.members.map(m => m.username));

const env = {
  roster: teams[1]!.members.map(m => m.username),
  peers: everyone.filter(u => u !== 'kofi.mensah'),
  teams,
  ownTeam: 'checkout',
  canPostOwners: true,
};

const mr = (ownerTeams: BoardMRWithReview['ownerTeams']) =>
  ({ author: { username: 'mira.fixture' }, ownerTeams }) as BoardMRWithReview;

const picker = (
  ownerTeams: BoardMRWithReview['ownerTeams'],
  over: Partial<typeof env> = {}
) => (
  <AskPicker
    x={24}
    y={24}
    subject="!1418"
    model={askPickerModel(mr(ownerTeams), { ...env, ...over })!}
    onPick={() => {}}
    onPostSlack={() => {}}
    onOpen={() => {}}
    onClose={() => {}}
  />
);

const owning: NonNullable<BoardMRWithReview['ownerTeams']> = [
  { team: 'sprockets', approved: false },
  { team: 'identity', approved: false },
  { team: 'billing', approved: true },
  { team: 'search', approved: true },
  { team: 'ledger', channel: 'pod-ledger', approved: false },
];

/** Your team, the owning teams still to approve (ledger has no board, so it
    offers the Slack post), then the rest with the approved owners marked. */
export const CodeOwners: Story = { render: () => picker(owning) };

/** ledger's channel already has the post, so its row links there. */
export const PostedInSlack: Story = {
  render: () =>
    picker(
      owning.map(o =>
        o.team === 'ledger' ? { ...o, posted: 'https://slack.example/p1' } : o
      )
    ),
};

/** Your team owns a section too; ledger has no board; #intake-auto is a
    channel no team claims; SpareParts names no channel at all. */
export const EveryOwnerKind: Story = {
  render: () =>
    picker([
      {
        team: 'checkout',
        channel: 'pod-checkout',
        mine: true,
        approved: false,
      },
      { team: 'ledger', channel: 'pod-ledger', approved: false },
      { channel: 'intake-auto', approved: false },
      { section: 'SpareParts', approved: false },
      { team: 'billing', approved: true },
    ]),
};

/** The MR changed since its approvals were read. */
export const CheckingApproval: Story = {
  render: () =>
    picker([
      { team: 'sprockets', approved: null },
      { team: 'billing', approved: null },
    ]),
};

/** No other team owns a section: your team, then every other team. */
export const NoOwners: Story = { render: () => picker(undefined) };

/** Nobody on another team has a board: just your own team. */
export const SingleTeam: Story = {
  render: () => picker(undefined, { teams: [] }),
};
