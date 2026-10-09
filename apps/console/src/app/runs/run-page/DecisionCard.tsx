import {
  Anchor,
  Badge,
  Code,
  Collapse,
  Group,
  Paper,
  Stack,
  Text,
  UnstyledButton,
  VisuallyHidden,
} from '@mattstack/app-kit/core';
import { useDisclosure } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import type { GateQuestion, GateRow } from '@mattstack/rt-client';

import {
  answerStamp,
  contextMeta,
  prettyContext,
  structuredContextSummary,
} from '../derive/answers';
import {
  gateEndNote,
  optionViews,
  questionAnswer,
  tookRecommendation,
  type OptionView,
} from '../derive/gates';
import { GateContext } from '../GateContext';
import classes from './DecisionCard.module.css';
import { PassedOnList } from './PassedOnList';

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
  const meta = contextMeta(context);
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
          <Code block>{prettyContext(context)}</Code>
        ) : (
          <GateContext text={context} />
        )}
      </Collapse>
    </Stack>
  );
}

function RecommendedMark() {
  return (
    <Badge size="xs" variant="outline" color="gray" tt="none" data-parity="rec">
      <span data-parity="label">recommended</span>
    </Badge>
  );
}

function Pick({ option }: { option: OptionView }) {
  return (
    <div
      className={classes.option}
      data-option={option.value}
      data-picked="true"
      aria-current="true"
      data-parity="opt"
    >
      <Icon
        name="circleCheck"
        size={15}
        color="var(--tk-text-ok-vivid)"
        data-parity="circle-check"
      />
      <Text fz={13} lh="normal" fw={500} data-parity="label">
        {option.text}
      </Text>
      <VisuallyHidden>selected</VisuallyHidden>
      {option.recommended ? <RecommendedMark /> : null}
    </div>
  );
}

const quoted = (options: OptionView[]) =>
  options.map(o => `“${o.text}”`).join(', ');

/** The options the answer passed on, folded to one line that opens to list
    them. While folded, the line names the recommendation the pick went
    against; once open, the listed row's mark names it. */
function OtherOptions({
  id,
  others,
  picked,
  overrode,
}: {
  id: string;
  others: OptionView[];
  picked: boolean;
  overrode: boolean;
}) {
  const [open, { toggle }] = useDisclosure(false);
  const n = others.length;
  const count = picked
    ? `${n} other ${n === 1 ? 'option' : 'options'}`
    : `${n} ${n === 1 ? 'option' : 'options'}`;
  const passedRecommended = others.filter(o => o.recommended);
  const line =
    !open && overrode && passedRecommended.length > 0
      ? `${count} · recommended was ${quoted(passedRecommended)}`
      : count;
  return (
    <>
      <UnstyledButton
        className={classes.others}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
      >
        <Icon
          name={open ? 'chevronDown' : 'chevronRight'}
          size={13}
          color="var(--tk-text-3)"
          data-parity="i"
        />
        <Text fz={12.5} lh="normal" c="dimmed" data-parity="t">
          {line}
        </Text>
      </UnstyledButton>
      {open ? (
        <PassedOnList
          id={id}
          options={others}
          recommendedMark={<RecommendedMark />}
          className={classes.passed}
        />
      ) : null}
    </>
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
  const options = optionViews(question);
  const picks = answer
    ? options.filter(o => answer.picked.includes(o.value))
    : [];
  const others = options.filter(o => !picks.includes(o));
  const idOf = (part: string) => `decision-${gate.id}-${question.id}-${part}`;
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
      {picks.length > 0 || others.length > 0 ? (
        <Stack gap={6} align="flex-start">
          {picks.map(o => (
            <Pick key={o.value} option={o} />
          ))}
          {others.length > 0 ? (
            <OtherOptions
              id={idOf('others')}
              others={others}
              picked={picks.length > 0}
              overrode={overrode}
            />
          ) : null}
        </Stack>
      ) : null}
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
          id={idOf('ctx')}
          label="What this turns on"
          context={question.context}
        />
      ) : null}
    </Stack>
  );
}

/** One gate in the record view: each question with its pick highlighted
    (marked when it was the recommendation), the options passed on folded to
    one line, a mark when the pick went against the recommendation, the note
    or edited reply, and who answered when. The gate's own context sits once
    under the questions, collapsed. A closed or superseded gate draws muted
    with why it ended. */
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
