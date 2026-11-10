import type { ReactNode } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Group,
  Stack,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import type { MantineColor } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { IconName } from '@mattstack/app-kit/icons';
import type { GateRow } from '@mattstack/rt-client';

import accordion from '../accordion.module.css';
import { answeredBy, answerSurface } from '../derive/answers';
import { formatClock } from '../derive/clock';
import type { FindingSeverity } from '../derive/findings';
import {
  gateRecord,
  type FormRecord,
  type RecordQuestion,
  type RespondPlanRecord,
  type RespondPostRecord,
  type ReviewPostRecord,
} from '../derive/gateRecord';
import { gateEndNote } from '../derive/gates';
import { GateContext } from '../GateContext';
import classes from './GateRecord.module.css';

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

function Chip({
  color,
  children,
}: {
  color: MantineColor;
  children: ReactNode;
}) {
  return (
    <Badge
      size="sm"
      variant="light"
      color={color}
      tt="none"
      className={classes.keep}
    >
      {children}
    </Badge>
  );
}

/** Who answered and when, with where it came from on hover; why it closed
    for a gate that ended unanswered. */
function Stamp({ gate, then }: { gate: GateRow; then: string | null }) {
  const ended = gateEndNote(gate);
  const by = answeredBy(gate);
  const surface = answerSurface(gate);
  return (
    <Group gap={12} wrap="nowrap" className={classes.stamp}>
      {then ? (
        <Group gap={5} wrap="nowrap" c="dimmed">
          <Icon name="cornerDownRight" size={13} />
          <Text fz="sm">{then}</Text>
        </Group>
      ) : null}
      {ended ? (
        <Text fz="sm" c="dimmed" fs="italic">
          {ended.charAt(0).toUpperCase() + ended.slice(1)}
        </Text>
      ) : gate.answer ? (
        <Tooltip label={surface} disabled={!surface}>
          <Text fz="sm" c="dimmed" tabIndex={0}>
            {by ? `${by.via} · ` : ''}
            {formatClock(gate.answer.answeredAt)}
          </Text>
        </Tooltip>
      ) : null}
    </Group>
  );
}

const SUMMARY_ITEM = 'summary';

/** Markdown's inline marks dropped, for text drawn inside a toggle button,
    where a link or code block would nest one control in another. */
const plainText = (md: string) =>
  md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/^\s*(#+|[-*+>]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The agent's prose for the whole ask. Its first line stays put in the row
    whether open or closed; opening reveals only what follows it. */
function Summary({ text, escalation }: { text: string; escalation: boolean }) {
  const trimmed = text.trim();
  const breakAt = trimmed.search(/\n\s*\n/);
  const first = breakAt < 0 ? trimmed : trimmed.slice(0, breakAt);
  const rest = breakAt < 0 ? '' : trimmed.slice(breakAt).trim();
  const row = (
    <div className={classes.rowBody}>
      <Text fz="md" c={escalation ? 'warn' : 'dimmed'} className={classes.ask}>
        {escalation ? 'The agent hit a wall' : 'What the agent found'}
      </Text>
      <div className={classes.grow}>
        {rest ? (
          <Text fz="md" lh="normal">
            {plainText(first)}
          </Text>
        ) : (
          <GateContext text={first} />
        )}
      </div>
    </div>
  );
  return (
    <Accordion.Item value={SUMMARY_ITEM}>
      {rest ? (
        <>
          <Accordion.Control>{row}</Accordion.Control>
          <Accordion.Panel>
            <GateContext text={rest} />
          </Accordion.Panel>
        </>
      ) : (
        <div className={classes.row}>{row}</div>
      )}
    </Accordion.Item>
  );
}

function OptionLine({
  multi,
  picked,
  text,
  detail,
}: {
  multi: boolean;
  picked: boolean;
  text: string;
  detail?: string;
}) {
  let icon: IconName;
  if (multi) icon = picked ? 'squareCheck' : 'square';
  else icon = picked ? 'circleDot' : 'circle';
  return (
    <div className={classes.option} data-picked={picked || undefined}>
      <Icon name={icon} size={15} className={classes.optionIcon} />
      <div className={classes.grow}>
        <Text fz="md" fw={picked ? 500 : 400} c={picked ? undefined : 'dimmed'}>
          {text}
        </Text>
        {picked && detail ? (
          <Text fz="sm" c="dimmed">
            {detail}
          </Text>
        ) : null}
      </div>
    </div>
  );
}

/** One answered question: the question and what was picked, with the other
    options in the panel. A question with no others has nothing to open. */
function Question({ q }: { q: RecordQuestion }) {
  const picked = q.options.filter(o => o.picked);
  const others = q.options.filter(o => !o.picked);
  const nonePicked = picked.length === 0 && !q.text && !q.writeIn;
  const answer = (
    <div className={classes.rowBody}>
      <Text fz="md" c="dimmed" className={classes.ask}>
        {q.label}
      </Text>
      <Stack gap={5} className={classes.grow}>
        {nonePicked && others.length > 0 ? (
          <Text fz="md" c="dimmed">
            None picked
          </Text>
        ) : null}
        {picked.map(o => (
          <OptionLine key={o.value} multi={q.multi} {...o} />
        ))}
        {q.note ? (
          <Group
            gap={8}
            wrap="nowrap"
            align="flex-start"
            className={classes.note}
          >
            <Icon
              name="messageSquare"
              size={13}
              className={classes.optionIcon}
            />
            <Text fz="sm" c="dimmed" fs="italic">
              {q.note}
            </Text>
          </Group>
        ) : null}
        {q.text ? (
          <Text fz="md" fs="italic">
            “{q.text}”
          </Text>
        ) : null}
        {q.writeIn ? (
          <Text fz="md" fs="italic" data-testid="record-write-in">
            Wrote in: “{q.writeIn}”
          </Text>
        ) : null}
      </Stack>
    </div>
  );
  return (
    <Accordion.Item value={q.id}>
      {others.length > 0 ? (
        <>
          <Accordion.Control>{answer}</Accordion.Control>
          <Accordion.Panel>
            <Stack gap={5}>
              {others.map(o => (
                <OptionLine key={o.value} multi={q.multi} {...o} />
              ))}
            </Stack>
          </Accordion.Panel>
        </>
      ) : (
        <div className={classes.row}>{answer}</div>
      )}
    </Accordion.Item>
  );
}

/** An escalation opens on what stopped the agent, since that is why it asked. */
function Form({ record }: { record: FormRecord }) {
  return (
    <Accordion
      multiple
      defaultValue={record.escalation ? [SUMMARY_ITEM] : []}
      classNames={{
        item: classes.item,
        control: classes.row,
        label: classes.rowLabel,
        content: `${accordion.content} ${classes.rowPanel}`,
      }}
    >
      {record.summary ? (
        <Summary text={record.summary} escalation={record.escalation} />
      ) : null}
      {record.questions.map(q => (
        <Question key={q.id} q={q} />
      ))}
    </Accordion>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: string;
  children: ReactNode;
}) {
  return (
    <Stack gap={0}>
      <Group gap={8} className={classes.sectionHead}>
        <Text fz="xs" fw={500} c="dimmed" tt="uppercase">
          {title}
        </Text>
        {count ? (
          <Text fz="xs" c="dimmed">
            {count}
          </Text>
        ) : null}
      </Group>
      <div className={classes.rows}>{children}</div>
    </Stack>
  );
}

function Where({ children }: { children: ReactNode }) {
  return (
    <Text fz="sm" ff="monospace" c="dimmed" className={classes.where}>
      {children}
    </Text>
  );
}

function ReviewPost({ record }: { record: ReviewPostRecord }) {
  const posted = record.findings.filter(f => f.posted).length;
  return (
    <Stack gap={14}>
      {record.verdict ? (
        <Alert
          variant="light"
          color="accent"
          icon={<Icon name="messageSquare" size={15} />}
          classNames={{ root: classes.verdict }}
        >
          <Group gap={10} wrap="nowrap" align="baseline">
            <Text fz="md" fw={500} c="accent">
              {record.verdict.pick}
            </Text>
            <Text fz="md" className={classes.grow}>
              {record.verdict.reason}
            </Text>
            {record.verdict.passed.length ? (
              <Text fz="sm" c="dimmed" className={classes.keep}>
                {record.verdict.passed.join(', ')} passed on
              </Text>
            ) : null}
          </Group>
        </Alert>
      ) : null}
      {record.findings.length ? (
        <Section
          title="Findings"
          count={`${posted} of ${record.findings.length} posted`}
        >
          {record.findings.map(f => (
            <div
              key={f.id}
              className={classes.row}
              data-dim={!f.posted || undefined}
            >
              <Icon
                name={f.posted ? 'circleCheck' : 'circleMinus'}
                size={15}
                className={f.posted ? classes.ok : classes.optionIcon}
              />
              <div className={classes.severity}>
                {f.severity ? <SeverityBadge severity={f.severity} /> : null}
              </div>
              <div className={classes.grow}>
                <Text fz="md" fw={500}>
                  {f.title}
                </Text>
                {f.where ? <Where>{f.where}</Where> : null}
              </div>
              <Text fz="sm" c="dimmed" className={classes.keep}>
                {f.posted ? 'Posted' : 'Not posted'}
              </Text>
            </div>
          ))}
        </Section>
      ) : null}
      {record.threads.length ? (
        <Section title="Earlier threads" count={String(record.threads.length)}>
          {record.threads.map(t => (
            <div key={t.where} className={classes.row}>
              <Icon
                name="messagesSquare"
                size={15}
                className={classes.optionIcon}
              />
              <div className={classes.grow}>
                <Text fz="md" fw={500}>
                  {t.gist}
                </Text>
                <Where>{t.where}</Where>
              </div>
              <Group gap={6} wrap="nowrap" className={classes.keep}>
                {t.replied ? <Chip color="ok">Replied</Chip> : null}
                {t.resolved ? <Chip color="ok">Resolved</Chip> : null}
                {!t.replied && !t.resolved ? (
                  <Text fz="sm" c="dimmed">
                    Left alone
                  </Text>
                ) : null}
              </Group>
            </div>
          ))}
        </Section>
      ) : null}
      {record.skipped || record.restored ? (
        <Group gap={8} c="dimmed">
          <Icon name="eyeOff" size={14} />
          <Text fz="sm">
            {record.restored
              ? `${record.restored} skipped ${record.restored === 1 ? 'finding' : 'findings'} brought back`
              : `${record.skipped} ${record.skipped === 1 ? 'finding' : 'findings'} skipped earlier ${record.skipped === 1 ? 'stays' : 'stay'} skipped`}
          </Text>
        </Group>
      ) : null}
    </Stack>
  );
}

const PICK_COLOR: Record<string, MantineColor> = { Fix: 'accent' };

function RespondPlan({ record }: { record: RespondPlanRecord }) {
  const blocking = record.threads.filter(t => t.severity === 'blocking').length;
  return (
    <Stack gap={10}>
      <Text fz="sm" c="dimmed">
        {[
          record.reviewer,
          `${record.threads.length} ${record.threads.length === 1 ? 'thread' : 'threads'}${blocking ? `, ${blocking} blocking` : ''}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <div className={classes.rows}>
        {record.threads.map(t => (
          <div
            key={t.where + t.claim}
            className={classes.row}
            data-align="start"
          >
            <Stack gap={6} className={classes.grow}>
              <Group gap={8} wrap="nowrap">
                {t.severity ? (
                  <Chip color={t.severity === 'blocking' ? 'bad' : 'gray'}>
                    {t.severity === 'blocking' ? 'Blocking' : 'Non-blocking'}
                  </Chip>
                ) : null}
                <Where>{t.where}</Where>
              </Group>
              <Text fz="md">{t.claim}</Text>
              {t.call ? (
                <Group gap={8} wrap="nowrap" align="flex-start">
                  <Chip color={t.call === 'pushback' ? 'warn' : 'ok'}>
                    {t.call === 'pushback' ? 'Pushback' : 'Valid'}
                  </Chip>
                  {t.callNote ? (
                    <Text fz="sm" c="dimmed">
                      {t.callNote}
                    </Text>
                  ) : null}
                </Group>
              ) : null}
              {t.note ? (
                <Text fz="sm" c="dimmed" fs="italic">
                  “{t.note}”
                </Text>
              ) : null}
            </Stack>
            <Stack gap={4} align="flex-end" className={classes.pick}>
              <Text fz="xs" c="dimmed">
                You chose
              </Text>
              {t.pick ? (
                <Chip color={PICK_COLOR[t.pick] ?? 'gray'}>{t.pick}</Chip>
              ) : (
                '—'
              )}
            </Stack>
          </div>
        ))}
      </div>
      {record.codeChanges ? (
        <Alert
          variant="light"
          color="ok"
          icon={<Icon name="circleCheck" size={15} />}
          classNames={{ root: classes.verdict }}
        >
          <Group gap={10} wrap="nowrap">
            <Text fz="md" fw={500} className={classes.grow}>
              Code changes: {record.codeChanges.pick}
            </Text>
            {record.codeChanges.passed.length ? (
              <Text fz="sm" c="dimmed">
                {record.codeChanges.passed.join(', ')} passed on
              </Text>
            ) : null}
          </Group>
        </Alert>
      ) : null}
    </Stack>
  );
}

function RespondPost({ record }: { record: RespondPostRecord }) {
  return (
    <div className={classes.rows}>
      {record.replies.map(r => (
        <div key={r.where + r.text} className={classes.row} data-align="start">
          <Stack gap={6} className={classes.grow}>
            <Group gap={6} wrap="nowrap" c="dimmed">
              <Icon name="reply" size={13} />
              <Where>{r.where}</Where>
              {r.sha ? (
                <>
                  <Icon name="gitCommit" size={13} />
                  <Text fz="sm" ff="monospace">
                    {r.sha.slice(0, 7)}
                  </Text>
                </>
              ) : null}
            </Group>
            <Text fz="md">“{r.text}”</Text>
          </Stack>
          <Group gap={6} wrap="nowrap" className={classes.keep}>
            {r.posted ? (
              <Chip color="ok">Posted</Chip>
            ) : (
              <Text fz="sm" c="dimmed">
                Not posted
              </Text>
            )}
            {r.resolved ? <Chip color="ok">Resolved</Chip> : null}
          </Group>
        </div>
      ))}
    </div>
  );
}

export interface GateRecordViewProps {
  gate: GateRow;
  /** Its place among the stage's gates, for its heading. */
  number: number;
  /** Drawn straight on its card, with no grey group of its own: the Now
      card is already one. */
  flat?: boolean;
  /** A deep link names this gate: it rings until the next click or key. */
  linked?: boolean;
}

/** One gate of a stage as it was answered: a review's verdict and findings,
    a reply's threads, or the form with every option and the picks checked. */
export function GateRecordView({
  gate,
  number,
  flat = false,
  linked = false,
}: GateRecordViewProps) {
  if (gate.closedReason === 'superseded')
    return (
      <section
        id={`decision-${gate.id}`}
        className={classes.gate}
        data-gate-id={gate.id}
        data-shape="superseded"
        data-linked={linked ? 'true' : undefined}
        data-selected={linked || undefined}
        tabIndex={linked ? -1 : undefined}
      >
        <Text fz="sm" c="dimmed" fs="italic">
          “{gate.questions[0]?.label ?? 'A question'}” was replaced by a newer
          question
        </Text>
      </section>
    );
  const record = gateRecord(gate);
  const then = record.shape === 'form' ? record.then : null;
  return (
    <section
      id={`decision-${gate.id}`}
      className={classes.gate}
      data-gate-id={gate.id}
      data-shape={record.shape}
      data-flat={flat || undefined}
      data-linked={linked ? 'true' : undefined}
      data-selected={linked || undefined}
      data-ended={gate.status === 'closed' || undefined}
      tabIndex={linked ? -1 : undefined}
    >
      <Group justify="space-between" wrap="nowrap" className={classes.gateHead}>
        <Text fz="md" fw={600} lh="normal">
          Gate {number}
        </Text>
        <Stamp gate={gate} then={then} />
      </Group>
      {record.shape === 'review-post' ? <ReviewPost record={record} /> : null}
      {record.shape === 'respond-plan' ? <RespondPlan record={record} /> : null}
      {record.shape === 'respond-post' ? <RespondPost record={record} /> : null}
      {record.shape === 'form' ? <Form record={record} /> : null}
    </section>
  );
}
