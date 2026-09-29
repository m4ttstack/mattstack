import { NotFoundPage } from '@mattstack/app-kit/app';
import type { LeaderboardResponse, MetricKey } from '../../shared/types';
import type { RangeSelection } from '../api';
import { useUserDetail } from '../hooks/useLeaderboard';
import { scopeLabel, windowLabel } from '../model/labels';
import classes from './detail.module.css';
import { PersonSummary } from './PersonSummary';
import { ProfileHeader } from './ProfileHeader';
import { StatPanel, type EvidenceState } from './StatPanel';
import { StatRail } from './StatRail';

export const FIRST_STAT: MetricKey = 'issuesCompleted';

export function DetailPage({
  data,
  username,
  stat,
  selection,
}: {
  data: LeaderboardResponse;
  username: string;
  stat: MetricKey;
  selection: RangeSelection;
}) {
  const detail = useUserDetail(username, selection, data.generatedAt);
  const people = data.users.filter(u => u.resolved);
  const person = people.find(u => u.username === username);
  if (!person) return <NotFoundPage />;

  const evidence: EvidenceState = detail.data
    ? { status: 'ready', ev: detail.data.evidence[stat] }
    : detail.error
      ? { status: 'error', message: detail.error.message }
      : { status: 'loading' };
  const meta = `@${person.username} · ${windowLabel(data.window)} · ${scopeLabel(data.scope)}`;

  return (
    <div className={classes.page}>
      <ProfileHeader person={person} people={people} stat={stat} meta={meta} />
      <PersonSummary users={data.users} person={person} window={data.window} />
      <div className={classes.body}>
        <StatRail person={person} selected={stat} />
        <StatPanel
          users={data.users}
          person={person}
          stat={stat}
          window={data.window}
          evidence={evidence}
        />
      </div>
    </div>
  );
}
