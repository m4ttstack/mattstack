import {
  Anchor,
  Badge,
  Code,
  Collapse,
  Group,
  Paper,
  Stack,
  Text,
  VisuallyHidden,
} from '@mattstack/app-kit/core';
import { useDisclosure } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import type { GateQuestion, GateRow } from '@mattstack/rt-client';

import { answerStamp, structuredContextSummary } from '../derive/answers';
import {
  gateEndNote,
  optionViews,
  questionAnswer,
  tookRecommendation,
} from '../derive/gates';
import { GateContext } from '../GateContext';
import classes from './DecisionCard.module.css';

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function lineCount(text: string): number {
  return text.trimEnd().split('\n').length;
}

/** A collapsed context: a prose context renders as markdown, a structured one
    shows its summary line over the raw JSON in a monospace block, never as
    markdown. */
function ContextDisclosure({
  id,
  label,
  context,
}: {
  id: string;
  label: string;
  context: string;
}) {
  const [open, { toggle }] = useDisclosure(false);
  const summary = structuredContextSummary(context);
  const lines = lineCount(context);
  const meta = summary ?? `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  return (
    <Stack gap="xs">
      <Anchor
        component="button"
        type="button"
        fz={12}
        fw={500}
        lh="normal"
        c="accent"
        className={classes.ctxToggle}
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
      >
        <Icon
          name={open ? 'chevronDown' : 'chevronRight'}
          size={13}
          data-parity="chevron-right"
        />
        <span data-parity="label">
          {label} · {meta}
        </span>
      </Anchor>
      <Collapse expanded={open} id={id}>
        {summary ? (
          <Code block>{prettyJson(context)}</Code>
        ) : (
          <GateContext text={context} />
        )}
      </Collapse>
    </Stack>
  );
}

function Option({
  value,
  text,
  recommended,
  picked,
  muted,
}: {
  value: string;
  text: string;
  recommended: boolean;
  picked: boolean;
  muted: boolean;
}) {
  return (
    <div
      className={classes.option}
      data-option={value}
      data-picked={picked ? 'true' : 'false'}
      aria-current={picked ? 'true' : undefined}
      data-parity={picked ? 'opt' : undefined}
    >
      <Icon
        name={picked ? 'circleCheck' : 'circle'}
        size={15}
        color={picked ? 'var(--tk-text-ok-vivid)' : 'var(--tk-text-3)'}
        data-parity={picked ? 'circle-check' : 'circle'}
      />
      <Text
        fz={13}
        lh="normal"
        fw={picked ? 500 : 400}
        c={picked && !muted ? undefined : 'dimmed'}
        data-parity="label"
      >
        {text}
      </Text>
      {picked ? <VisuallyHidden>selected</VisuallyHidden> : null}
      {recommended ? (
        <Badge
          size="xs"
          variant="outline"
          color="gray"
          tt="none"
          data-parity="rec"
        >
          <span data-parity="label">recommended</span>
        </Badge>
      ) : null}
    </div>
  );
}

function QuestionBlock({
  gate,
  question,
  first,
}: {
  gate: GateRow;
  question: GateQuestion;
  first: boolean;
}) {
  const ended = gateEndNote(gate);
  const answer = questionAnswer(gate.answer, question);
  const stamp = first && !ended ? answerStamp(gate) : null;
  const overrode = tookRecommendation(question, gate.answer) === false;
  const ctxId = `decision-${gate.id}-${question.id}-ctx`;
  return (
    <Stack gap={12} data-question={question.id}>
      <Group wrap="nowrap" gap={10}>
        <Icon name="signpost" size={15} data-parity="signpost" />
        <Text
          fz={14.5}
          lh="normal"
          fw={500}
          c={ended ? 'dimmed' : undefined}
          className={classes.title}
          data-parity="q"
        >
          {question.label}
        </Text>
        {overrode ? (
          <Badge
            size="sm"
            variant="light"
            color="warn"
            tt="none"
            data-parity="ov"
          >
            <span data-parity="label">overrode recommendation</span>
          </Badge>
        ) : null}
        {ended && first ? (
          <Text fz={12} lh="normal" c="dimmed">
            {ended}
          </Text>
        ) : null}
        {stamp ? (
          <Text fz={12} lh="normal" c="dimmed" data-parity="stamp">
            {stamp}
          </Text>
        ) : null}
      </Group>
      <Stack gap={6}>
        {optionViews(question).map(o => (
          <Option
            key={o.value}
            {...o}
            picked={answer?.picked.includes(o.value) ?? false}
            muted={ended !== null}
          />
        ))}
      </Stack>
      {answer?.note ? (
        <div className={classes.note} data-parity="note">
          <Icon name="messageSquare" size={13} data-parity="message-square" />
          <Text
            fz={12.5}
            lh="18px"
            className={classes.noteText}
            data-parity="text"
          >
            {answer.note}
          </Text>
        </div>
      ) : null}
      {answer?.text ? (
        <div className={classes.note} data-parity="note">
          <Icon name="messageSquare" size={13} data-parity="message-square" />
          <Text
            fz={12.5}
            lh="18px"
            fs="italic"
            className={classes.noteText}
            data-parity="text"
          >
            {answer.text}
          </Text>
        </div>
      ) : null}
      {question.context ? (
        <ContextDisclosure
          id={ctxId}
          label="What this turns on"
          context={question.context}
        />
      ) : null}
    </Stack>
  );
}

/** One gate in the record view: each question with every option, the pick
    highlighted, the recommended badge and a mark when the pick went against
    it, the note or edited reply, and who answered when. The gate's own
    context sits once under the questions, collapsed. A closed or superseded
    gate draws muted with why it ended. */
export function DecisionCard({ gate }: { gate: GateRow }) {
  const ended = gateEndNote(gate);
  const muted = ended !== null;
  return (
    <Paper
      id={`decision-${gate.id}`}
      variant="ground"
      withBorder
      radius={12}
      className={classes.card}
      data-muted={muted ? 'true' : undefined}
      data-gate-id={gate.id}
      data-parity="Decision"
    >
      <Stack gap={12}>
        {gate.questions.map((q, i) => (
          <QuestionBlock key={q.id} gate={gate} question={q} first={i === 0} />
        ))}
        {gate.context ? (
          <ContextDisclosure
            id={`decision-${gate.id}-context`}
            label="What the agent found"
            context={gate.context}
          />
        ) : null}
      </Stack>
    </Paper>
  );
}
