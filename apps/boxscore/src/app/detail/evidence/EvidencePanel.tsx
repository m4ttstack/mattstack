import { EVIDENCE, type EvidenceProps } from './index';

/** The one entry StatPanel loads lazily, so the chart library stays out of the leaderboard chunk. */
export default function EvidencePanel(props: EvidenceProps) {
  const Evidence = EVIDENCE[props.statKey];
  return <Evidence {...props} />;
}
