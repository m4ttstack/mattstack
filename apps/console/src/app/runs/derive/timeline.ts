import type { StageAttempt } from './stages';

export type SegmentKind = 'done' | 'running' | 'you' | 'ci' | 'held' | 'idle';

export interface Segment {
  kind: SegmentKind;
  from: number;
  to: number;
  stage: string | null;
}

interface Span {
  from: number;
  to: number;
}

const covers = (s: Span, from: number, to: number) =>
  s.from <= from && to <= s.to;

export function timelineSegments(input: {
  attempts: StageAttempt[];
  myGateSpans: { from: number; to: number }[];
  held: { from: number; to: number | null }[];
  runStart: number;
  runEnd: number;
  dayStart: number;
  dayEnd: number;
}): Segment[] {
  const lo = Math.max(input.runStart, input.dayStart);
  const hi = Math.min(input.runEnd, input.dayEnd);
  if (hi <= lo) return [];

  const windows = input.attempts
    .filter(a => a.startedAt != null)
    .map(a => ({
      attempt: a,
      from: a.startedAt!,
      to: a.endedAt ?? input.runEnd,
    }));
  const held = input.held.map(h => ({
    from: h.from,
    to: h.to ?? input.runEnd,
  }));
  const you = input.myGateSpans;

  const cuts = new Set([lo, hi]);
  for (const s of [...windows, ...held, ...you])
    for (const t of [s.from, s.to]) if (t > lo && t < hi) cuts.add(t);
  const points = [...cuts].sort((a, b) => a - b);

  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const under = windows
      .filter(w => covers(w, from, to))
      .sort((a, b) => b.from - a.from);
    const stage = under[0]?.attempt.stage ?? null;
    let kind: SegmentKind;
    if (you.some(s => covers(s, from, to))) kind = 'you';
    else if (under.some(w => w.attempt.stage === 'watch-ci')) kind = 'ci';
    else if (held.some(s => covers(s, from, to))) kind = 'held';
    else if (under.length > 0)
      kind = under[0]!.attempt.status === 'running' ? 'running' : 'done';
    else kind = 'idle';

    const prev = out.at(-1);
    if (prev && prev.kind === kind && prev.stage === stage && prev.to === from)
      prev.to = to;
    else out.push({ kind, from, to, stage });
  }
  return out;
}
