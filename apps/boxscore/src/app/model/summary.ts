import { metricRank, METRICS } from '../../shared/metrics';
import type { MetricKey, UserRow } from '../../shared/types';
import { isFullTie } from './standings';

export interface PersonSummary {
  leads: MetricKey[];
  top3: number;
  statCount: number;
  medianRank: number | null;
}

/** For an even count this is the lower middle, so the result is always a rank someone holds. */
function median(ranks: number[]): number | null {
  if (ranks.length === 0) return null;
  const sorted = [...ranks].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * A full tie is neither a lead nor a top 3 place, but its shared rank still
 * counts toward the median. Unranked stats count toward neither.
 */
export function personSummary(
  users: UserRow[],
  username: string
): PersonSummary {
  const person = users.find(u => u.username === username && u.resolved);
  const leads: MetricKey[] = [];
  const ranks: number[] = [];
  let top3 = 0;
  if (person) {
    for (const d of METRICS) {
      const rank = metricRank(person.metrics, d);
      if (rank === null) continue;
      ranks.push(rank);
      if (isFullTie(users, d.key)) continue;
      if (rank === 1) leads.push(d.key);
      if (rank <= 3) top3 += 1;
    }
  }
  return { leads, top3, statCount: METRICS.length, medianRank: median(ranks) };
}
