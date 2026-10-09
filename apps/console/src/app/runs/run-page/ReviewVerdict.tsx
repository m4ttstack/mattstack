import { useId, useState } from 'react';
import {
  Anchor,
  Badge,
  Group,
  Paper,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import type { MantineColor } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { GateRow } from '@mattstack/rt-client';

import type { FindingSeverity, ParsedFinding } from '../derive/findings';
import { DecisionCard } from './DecisionCard';
import classes from './ReviewVerdict.module.css';
import { FactsCard, LABEL_TYPE, type FactProps } from './SideCards';

const SEVERITY: Record<
  FindingSeverity,
  { label: string; color: MantineColor; variant: 'light' | 'outline' }
> = {
  critical: { label: 'Critical', color: 'bad', variant: 'light' },
  important: { label: 'Important', color: 'warn', variant: 'light' },
  minor: { label: 'Minor', color: 'gray', variant: 'outline' },
};

function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  const { label, color, variant } = SEVERITY[severity];
  return (
    <Badge
      size="sm"
      variant={variant}
      color={color}
      tt="none"
      data-severity={severity}
      data-parity="pill"
    >
      <span data-parity="l">{label}</span>
    </Badge>
  );
}

const counted = (n: number) =>
  n === 0 ? 'no findings' : `${n} ${n === 1 ? 'finding' : 'findings'}`;

function FindingRow({
  finding: f,
  parity,
  dim = false,
}: {
  finding: ParsedFinding;
  parity?: string;
  dim?: boolean;
}) {
  return (
    <div
      className={classes.finding}
      data-finding
      data-dim={dim || undefined}
      data-parity={parity}
    >
      <div className={classes.severity}>
        {f.severity ? <SeverityBadge severity={f.severity} /> : null}
      </div>
      <Stack gap={3} className={classes.grow}>
        <Text
          fz={13.5}
          lh="normal"
          c={dim ? 'dimmed' : undefined}
          data-finding-text
          data-parity="t"
        >
          {f.text}
        </Text>
        {f.where ? (
          <Text
            ff="monospace"
            fz={11.5}
            lh="normal"
            c="dimmed"
            data-finding-where
            data-parity="w"
          >
            {f.where}
          </Text>
        ) : null}
      </Stack>
    </div>
  );
}

/** The findings the review left out, folded to one line that opens to list
    them as the posted ones are, dimmed. */
function NotPosted({ findings }: { findings: ParsedFinding[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={classes.notPosted} data-testid="not-posted">
      <UnstyledButton
        className={classes.fold}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(o => !o)}
      >
        <Icon
          name={open ? 'chevronDown' : 'chevronRight'}
          size={13}
          color="var(--tk-text-3)"
        />
        <Text fz={12.5} lh="normal" c="dimmed">
          {findings.length} not posted
        </Text>
      </UnstyledButton>
      {open ? (
        <div id={id}>
          {findings.map((f, i) => (
            <FindingRow key={`${i}-${f.text}`} finding={f} dim />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface ReviewVerdictProps {
  /** The verdict picked, "Request changes"; empty when none was answered. */
  verdict: string;
  findings: ParsedFinding[];
  /** The findings offered and left out; the fold is hidden when empty. */
  notPosted?: ParsedFinding[];
  mrIid: string | null;
  mrUrl: string | null;
}

/** What a review posted to its MR: the verdict and how many findings, then
    each finding with its severity and the file it names. */
export function ReviewVerdict({
  verdict,
  findings,
  notPosted = [],
  mrIid,
  mrUrl,
}: ReviewVerdictProps) {
  const headline = [verdict, counted(findings.length)]
    .filter(Boolean)
    .join(' · ');
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.card}
      data-testid="review-verdict"
      data-parity="Verdict"
    >
      <Group gap={12} wrap="nowrap" className={classes.head} data-parity="head">
        <Stack gap={3} className={classes.grow}>
          <Text {...LABEL_TYPE} data-parity="k">
            {mrIid ? `Posted to !${mrIid}` : 'Posted to the MR'}
          </Text>
          <Text fz={17} fw={700} lh="normal" data-parity="v">
            {headline}
          </Text>
        </Stack>
        {mrUrl ? (
          <Anchor
            href={mrUrl}
            target="_blank"
            rel="noopener noreferrer"
            fz={13}
            fw={500}
            lh="normal"
            c="accent"
            className={classes.open}
          >
            <span data-parity="l">Open the MR</span>
            <Icon name="externalLink" size={13} data-parity="i" />
          </Anchor>
        ) : null}
      </Group>
      {findings.map((f, i) => (
        <FindingRow
          key={`${i}-${f.text}`}
          finding={f}
          parity={i < findings.length - 1 ? 'finding' : undefined}
        />
      ))}
      {notPosted.length > 0 ? <NotPosted findings={notPosted} /> : null}
    </Paper>
  );
}

export interface ReviewDecisionsProps {
  /** Null when the run posted nothing. */
  verdict: ReviewVerdictProps | null;
  /** The settled gates the log lists, the findings left out. */
  gates: GateRow[];
  facts: FactProps[];
}

/** A review record's Decisions tab: what it posted leads, its decisions
    follow, and the MR it reviewed sits beside them. */
export function ReviewDecisions({
  verdict,
  gates,
  facts,
}: ReviewDecisionsProps) {
  return (
    <div className={classes.columns}>
      <Stack gap={16} className={classes.column} data-parity="Review column">
        {verdict ? <ReviewVerdict {...verdict} /> : null}
        {verdict && gates.length > 0 ? (
          <Text {...LABEL_TYPE} data-parity="Decisions label">
            Decisions
          </Text>
        ) : null}
        {gates.length > 0 ? (
          <Stack gap={16} data-testid="decision-log">
            {gates.map(g => (
              <DecisionCard key={g.id} gate={g} />
            ))}
          </Stack>
        ) : null}
      </Stack>
      <div className={classes.side} data-testid="review-side">
        <FactsCard name="Side" facts={facts} />
      </div>
    </div>
  );
}
