import { useState, type ReactNode } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Group,
  PageShell,
  Paper,
  SegmentedControl,
  Table,
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

const PANEL_WIDTH = 1080;
const PAGE_PAD_X = 40;

const VIEWER_ROLE: Record<string, string> = {
  'org-owner': "You're the org owner",
  admin: "You're an org admin",
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

function Person({ name, waiting }: { name: string; waiting?: boolean }) {
  return (
    <Avatar
      size={24}
      radius="xl"
      variant="light"
      color={waiting ? 'warn' : 'gray'}
      classNames={{ placeholder: classes.initial }}
      aria-hidden
    >
      {name.charAt(0).toUpperCase()}
    </Avatar>
  );
}

function Name({ children }: { children: string }) {
  return (
    <Text fz="sm" fw={600} lh="normal">
      {children}
    </Text>
  );
}

function Quiet({ children }: { children: string }) {
  return (
    <Text fz="sm" c="dimmed" lh="normal">
      {children}
    </Text>
  );
}

function Board({ peered }: { peered: boolean | null }) {
  if (peered === null) return <Quiet>Unknown</Quiet>;
  return (
    <Group gap={6}>
      <span className={classes.boardDot} data-peered={peered} aria-hidden />
      <Text fz="sm" c={peered ? undefined : 'dimmed'} lh="normal">
        {peered ? 'Connected' : 'Not connected'}
      </Text>
    </Group>
  );
}

function WarnBadge({ children }: { children: string }) {
  return (
    <Badge color="warn" variant="light" size="sm" tt="none">
      {children}
    </Badge>
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

function ColumnHead({ children }: { children: string }) {
  return (
    <Text fz="xs" fw={600} c="dimmed" lh="normal" className={classes.th}>
      {children}
    </Text>
  );
}

function TeamTable({
  columns,
  children,
}: {
  columns: [string, string, string];
  children: ReactNode;
}) {
  return (
    <Table variant="soft" noPaper fullWidth horizontalSpacing={20}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>
            <ColumnHead>{columns[0]}</ColumnHead>
          </Table.Th>
          <Table.Th w={152}>
            <ColumnHead>{columns[1]}</ColumnHead>
          </Table.Th>
          <Table.Th w={200}>
            <ColumnHead>{columns[2]}</ColumnHead>
          </Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>{children}</Table.Tbody>
    </Table>
  );
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
    <TeamTable columns={['Member', 'Role', 'Board']}>
      {memberRows(team).map(row =>
        row.kind === 'member' ? (
          <Table.Tr key={`m-${row.member.username}`}>
            <Table.Td>
              <Group gap={10}>
                <Person name={row.member.username} />
                <Name>{row.member.username}</Name>
              </Group>
            </Table.Td>
            <Table.Td>
              <Text fz="sm" lh="normal">
                {roleWords(row.member.role)}
              </Text>
            </Table.Td>
            <Table.Td>
              <Board peered={row.member.peered} />
            </Table.Td>
          </Table.Tr>
        ) : (
          <Table.Tr key={`w-${row.invite.handle}`}>
            <Table.Td>
              <Group gap={10}>
                <Person name={row.invite.handle} waiting />
                <Name>{row.invite.handle}</Name>
                <WarnBadge>Waiting for approval</WarnBadge>
                <Button
                  size="compact-sm"
                  leftSection={<Icon name="check" size={12} />}
                  disabled={confirming !== null}
                  loading={confirming === team.slug}
                  onClick={() => onConfirm(team.slug)}
                >
                  {label}
                </Button>
              </Group>
            </Table.Td>
            <Table.Td>
              <Quiet>Member</Quiet>
            </Table.Td>
            <Table.Td>
              <Quiet>Joins after you add</Quiet>
            </Table.Td>
          </Table.Tr>
        )
      )}
    </TeamTable>
  );
}

function InvitesTable({ invites }: { invites: TeamInvite[] }) {
  if (invites.length === 0) {
    return (
      <div className={classes.none}>
        <Quiet>No open invites</Quiet>
      </div>
    );
  }
  return (
    <TeamTable columns={['Member', 'Status', 'Expires']}>
      {invites.map(invite => (
        <Table.Tr key={invite.handle}>
          <Table.Td>
            <Group gap={10}>
              <Person name={invite.handle} />
              <Name>{invite.handle}</Name>
            </Group>
          </Table.Td>
          <Table.Td>
            {invite.state === 'expired' ? (
              <WarnBadge>Expired</WarnBadge>
            ) : (
              <Text fz="sm" lh="normal">
                Invite sent
              </Text>
            )}
          </Table.Td>
          <Table.Td>
            <Quiet>{expiresOn(invite.expiresAt)}</Quiet>
          </Table.Td>
        </Table.Tr>
      ))}
    </TeamTable>
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
      <Paper
        variant="ground"
        withBorder
        radius={12}
        className={classes.panel}
        data-testid="team-panel"
      >
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
      </Paper>
    );
  }

  const team = read.team;
  const invites = team.invites.filter(i => i.state !== 'replied');
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.panel}
      data-testid="team-panel"
    >
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
            <TabLabel label="Members" count={team.members.length} />
          </Tabs.Tab>
          <Tabs.Tab value="invites">
            <TabLabel label="Invites" count={invites.length} />
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
    </Paper>
  );
}

function TabLabel({ label, count }: { label: string; count: number }) {
  return (
    <Group gap={6}>
      {label}
      <Text component="span" fz="xs" c="dimmed">
        {count}
      </Text>
    </Group>
  );
}

function SegmentLabel({ read }: { read: TeamRead }) {
  const waiting = read.ok
    ? read.team.invites.filter(i => i.state === 'replied').length
    : 0;
  return (
    <span className={classes.segment}>
      {read.ok ? null : (
        <Text component="span" c="warn" className={classes.segmentIcon}>
          <Icon name="warning" size={12} />
        </Text>
      )}
      {read.ok ? read.team.name : read.slug}
      {waiting > 0 ? (
        <Badge
          color="bad"
          variant="filled"
          size="xs"
          circle
          aria-label={`${waiting} waiting`}
        >
          {waiting}
        </Badge>
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
              <Paper
                variant="ground"
                withBorder
                radius={12}
                className={classes.panel}
              >
                <div className={classes.empty}>
                  <Text fz="lg" fw={500} lh="normal">
                    No teams to manage
                  </Text>
                  <Text fz="md" c="dimmed" lh="normal">
                    Org owners and admins approve teammates here
                  </Text>
                </div>
              </Paper>
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
