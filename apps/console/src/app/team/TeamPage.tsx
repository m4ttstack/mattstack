import { useState } from 'react';
import {
  Button,
  PageShell,
  SegmentedControl,
  Tabs,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import {
  confirmLabel,
  type TeamInvite,
  type TeamMember,
  type TeamRead,
  type TeamView,
} from '../../shared/team';
import { PAGE_ROW_HEIGHT } from '../chrome';
import { RetryAlert } from '../runs/RetryAlert';
import { clockTime } from '../usage/format';
import classes from './TeamPage.module.css';
import { useTeam } from './useTeam';

const PANEL_WIDTH = 880;
const PAGE_PAD_X = 40;

const VIEWER_ROLE: Record<string, string> = {
  'org-owner': "You're an owner of this team",
  admin: "You're an admin of this team",
};

function roleWords(role: string | undefined): string {
  if (!role) return 'Member';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function expiresOn(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Avatar({ name, waiting }: { name: string; waiting?: boolean }) {
  return (
    <span
      className={classes.avatar}
      data-waiting={waiting || undefined}
      aria-hidden
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function Board({ peered }: { peered: boolean | null }) {
  if (peered === null) return <span className={classes.dim}>Unknown</span>;
  return (
    <span className={classes.board} data-peered={peered}>
      <span className={classes.boardDot} aria-hidden />
      {peered ? 'Connected' : 'Not connected'}
    </span>
  );
}

type Row =
  | { kind: 'member'; member: TeamMember }
  | { kind: 'waiting'; invite: TeamInvite };

/** Owners first, then whoever waits for approval, then everyone else. */
function memberRows(team: TeamView): Row[] {
  const owners = team.members.filter(m => m.role === 'owner');
  const rest = team.members.filter(m => m.role !== 'owner');
  const waiting = team.invites.filter(i => i.state === 'replied');
  return [
    ...owners.map(member => ({ kind: 'member' as const, member })),
    ...waiting.map(invite => ({ kind: 'waiting' as const, invite })),
    ...rest.map(member => ({ kind: 'member' as const, member })),
  ];
}

function MembersTable({
  team,
  confirming,
  onConfirm,
}: {
  team: TeamView;
  confirming: string | null;
  onConfirm: (slug: string) => void;
}) {
  const label = confirmLabel(team.invites);
  return (
    <table className={classes.table}>
      <thead>
        <tr>
          <th>Member</th>
          <th className={classes.roleCol}>Role</th>
          <th className={classes.boardCol}>Board</th>
        </tr>
      </thead>
      <tbody>
        {memberRows(team).map(row =>
          row.kind === 'member' ? (
            <tr key={`m-${row.member.username}`}>
              <td>
                <div className={classes.who}>
                  <Avatar name={row.member.username} />
                  <span className={classes.name}>{row.member.username}</span>
                </div>
              </td>
              <td className={classes.muted}>{roleWords(row.member.role)}</td>
              <td>
                <Board peered={row.member.peered} />
              </td>
            </tr>
          ) : (
            <tr key={`w-${row.invite.handle}`}>
              <td>
                <div className={classes.who}>
                  <Avatar name={row.invite.handle} waiting />
                  <span className={classes.name}>{row.invite.handle}</span>
                  <span className={classes.chip}>Waiting for approval</span>
                  <Button
                    size="compact-sm"
                    radius="sm"
                    leftSection={<Icon name="check" size={12} />}
                    disabled={confirming !== null}
                    loading={confirming === team.slug}
                    onClick={() => onConfirm(team.slug)}
                  >
                    {label}
                  </Button>
                </div>
              </td>
              <td className={classes.dim}>Member</td>
              <td className={classes.dim}>Joins after you add</td>
            </tr>
          )
        )}
      </tbody>
    </table>
  );
}

function InvitesTable({ invites }: { invites: TeamInvite[] }) {
  if (invites.length === 0) {
    return <div className={classes.none}>No open invites</div>;
  }
  return (
    <table className={classes.table}>
      <thead>
        <tr>
          <th>Member</th>
          <th className={classes.roleCol}>Status</th>
          <th className={classes.boardCol}>Expires</th>
        </tr>
      </thead>
      <tbody>
        {invites.map(invite => (
          <tr key={invite.handle}>
            <td>
              <div className={classes.who}>
                <Avatar name={invite.handle} />
                <span className={classes.name}>{invite.handle}</span>
              </div>
            </td>
            <td>
              {invite.state === 'expired' ? (
                <span className={classes.chip}>Expired</span>
              ) : (
                <span className={classes.muted}>Invite sent</span>
              )}
            </td>
            <td className={classes.dim}>{expiresOn(invite.expiresAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TeamPanel({
  read,
  confirming,
  onConfirm,
  onRetry,
}: {
  read: TeamRead;
  confirming: string | null;
  onConfirm: (slug: string) => void;
  onRetry: () => void;
}) {
  const [tab, setTab] = useState<string | null>('members');

  if (!read.ok) {
    return (
      <section className={classes.panel} data-testid="team-panel">
        <header className={classes.head}>
          <Text fz={15} fw={700} lh="normal">
            {`${read.slug} members`}
          </Text>
          <Text fz="sm" c="dimmed" lh="normal">
            Can&apos;t read this team
          </Text>
        </header>
        <div className={classes.failure}>
          <RetryAlert color="warn" icon="unplug" onRetry={onRetry}>
            {read.error}
          </RetryAlert>
        </div>
      </section>
    );
  }

  const team = read.team;
  const invites = team.invites.filter(i => i.state !== 'replied');
  return (
    <section className={classes.panel} data-testid="team-panel">
      <header className={classes.head}>
        <Text fz={15} fw={700} lh="normal">
          {`${team.name} members`}
        </Text>
        {team.role && VIEWER_ROLE[team.role] ? (
          <Text fz="sm" c="dimmed" lh="normal">
            {VIEWER_ROLE[team.role]}
          </Text>
        ) : null}
      </header>
      <Tabs
        value={tab}
        onChange={setTab}
        keepMounted={false}
        classNames={{ list: classes.tabs, tab: classes.tab }}
      >
        <Tabs.List>
          <Tabs.Tab value="members">
            Members{' '}
            <span className={classes.tabCount}>{team.members.length}</span>
          </Tabs.Tab>
          <Tabs.Tab value="invites">
            Invites <span className={classes.tabCount}>{invites.length}</span>
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="members">
          <MembersTable
            team={team}
            confirming={confirming}
            onConfirm={onConfirm}
          />
        </Tabs.Panel>
        <Tabs.Panel value="invites">
          <InvitesTable invites={invites} />
        </Tabs.Panel>
      </Tabs>
    </section>
  );
}

function SegmentLabel({ read }: { read: TeamRead }) {
  const waiting = read.ok
    ? read.team.invites.filter(i => i.state === 'replied').length
    : 0;
  return (
    <span className={classes.segment}>
      {read.ok ? null : (
        <Icon name="warning" size={12} className={classes.segmentWarn} />
      )}
      {read.ok ? read.team.name : read.slug}
      {waiting > 0 ? (
        <span
          className={classes.segmentCount}
          aria-label={`${waiting} waiting`}
        >
          {waiting}
        </span>
      ) : null}
    </span>
  );
}

/** Org owners and admins approve teammates waiting to join: one panel per
    team they administer, behind a switch when there are several. */
export function TeamPage() {
  const view = useTeam();
  const { teams } = view;
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = teams.find(t => t.slug === chosen) ?? teams[0];

  return (
    <PageShell headerHeight={PAGE_ROW_HEIGHT} compactHeader>
      <PageShell.Main>
        <PageShell.Header
          title="Team"
          actions={
            view.loaded && view.updatedAt ? (
              <Text fz="sm" c="dimmed" lh="normal">
                {`as of ${clockTime(view.updatedAt)}`}
              </Text>
            ) : undefined
          }
        />
        <PageShell.Content
          contentContainerProps={{
            maw: PANEL_WIDTH + 2 * PAGE_PAD_X,
            my: 0,
            px: PAGE_PAD_X,
            py: 28,
          }}
        >
          <div className={classes.page} data-testid="team-page">
            {view.failed ? (
              <RetryAlert
                color="warn"
                icon="unplug"
                onRetry={() => void view.refetch()}
              >
                Can&apos;t read your teams.
              </RetryAlert>
            ) : null}
            {view.loaded && teams.length === 0 ? (
              <section className={classes.panel}>
                <div className={classes.empty}>
                  <Text fz="lg" fw={500} lh="normal">
                    No teams to manage
                  </Text>
                  <Text fz="md" c="dimmed" lh="normal">
                    Org owners and admins approve teammates here
                  </Text>
                </div>
              </section>
            ) : null}
            {teams.length > 1 ? (
              <div>
                <SegmentedControl
                  aria-label="Team"
                  value={selected?.slug}
                  onChange={setChosen}
                  data={teams.map(read => ({
                    value: read.slug,
                    label: <SegmentLabel read={read} />,
                  }))}
                />
              </div>
            ) : null}
            {selected ? (
              <TeamPanel
                key={selected.slug}
                read={selected}
                confirming={view.confirming}
                onConfirm={slug => void view.confirm(slug)}
                onRetry={() => void view.refetch()}
              />
            ) : null}
          </div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
