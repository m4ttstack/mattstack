import { useState } from 'react';
import {
  Anchor,
  Code,
  Collapse,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useDisclosure } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import type { GateQuestion, GateRow } from '@mattstack/rt-client';

import {
  answerStamp,
  answerSurface,
  contextMeta,
  prettyContext,
  structuredContextSummary,
} from '../derive/answers';
import {
  gateEndNote,
  optionViews,
  pickedText,
  questionAnswer,
} from '../derive/gates';
import { GateContext } from '../GateContext';
import classes from './DecisionRow.module.css';

export interface DecisionRowProps {
  gate: GateRow;
  question: GateQuestion;
  /** A deep link names this gate: the row opens and rings until the next
      click or key. */
  linked?: boolean;
}

/** "What the agent found · N lines", opening to the gate's context. */
function Found({ id, context }: { id: string; context: string }) {
  const [open, { toggle }] = useDisclosure(false);
  return (
    <Stack gap={6} className={classes.inset}>
      <Anchor
        component="button"
        type="button"
        fz={12.5}
        fw={500}
        lh="normal"
        c="accent"
        className={classes.found}
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
      >
        <Icon
          name={open ? 'chevronDown' : 'chevronRight'}
          size={13}
          data-parity="i"
        />
        <span data-parity="t">
          What the agent found · {contextMeta(context)}
        </span>
      </Anchor>
      <Collapse expanded={open} id={id}>
        {structuredContextSummary(context) ? (
          <Code block>{prettyContext(context)}</Code>
        ) : (
          <GateContext text={context} />
        )}
      </Collapse>
    </Stack>
  );
}

/** One gate question in an opened stage: the question, the pick, who
    answered and when. Opens to the options passed on, the note, any
    replacement text and what the agent found. A closed or superseded gate
    draws muted with why it ended. */
export function DecisionRow({
  gate,
  question,
  linked = false,
}: DecisionRowProps) {
  const [expanded, setExpanded] = useState(linked);
  const [seenLink, setSeenLink] = useState(linked);
  if (linked !== seenLink) {
    setSeenLink(linked);
    if (linked) setExpanded(true);
  }

  const ended = gateEndNote(gate);
  const answer = questionAnswer(gate.answer, question);
  const stamp = ended ? null : answerStamp(gate);
  const surface = answerSurface(gate);
  const others = answer
    ? optionViews(question).filter(o => !answer.picked.includes(o.value))
    : [];
  const context = question.context ?? gate.context ?? null;
  const expandable =
    !ended &&
    answer !== null &&
    (others.length > 0 || !!answer.note || !!answer.text || !!context);
  const open = expandable && expanded;
  const detailId = `decision-${gate.id}-${question.id}-detail`;

  let pick: string;
  if (ended) pick = ended;
  else if (answer) pick = pickedText(question, answer.picked);
  else if (gate.status === 'answered') pick = 'No answer recorded';
  else pick = 'Not answered yet';
  const muted = ended !== null || answer === null;

  const head = (
    <Group wrap="nowrap" gap={12} align="center" className={classes.head}>
      <Text
        fz={12.5}
        lh="normal"
        c="dimmed"
        className={classes.q}
        data-parity="q"
      >
        {question.label}
      </Text>
      <Text
        fz={13}
        fw={open ? 700 : 500}
        lh="normal"
        c={muted ? 'dimmed' : undefined}
        className={classes.a}
        data-parity="a"
      >
        {pick}
      </Text>
      {stamp ? (
        <Tooltip
          label={surface}
          disabled={!surface}
          events={{ hover: true, focus: true, touch: false }}
        >
          <Text
            fz={11.5}
            lh="normal"
            c="dimmed"
            tabIndex={0}
            className={classes.stamp}
            data-parity="s"
          >
            {stamp}
          </Text>
        </Tooltip>
      ) : null}
      {expandable ? (
        <UnstyledButton
          className={classes.chevron}
          aria-label={open ? 'Hide details' : 'Show details'}
          aria-expanded={open}
          aria-controls={open ? detailId : undefined}
          onClick={() => setExpanded(e => !e)}
        >
          <Icon
            name={open ? 'chevronUp' : 'chevronDown'}
            size={14}
            data-parity="c"
          />
        </UnstyledButton>
      ) : null}
    </Group>
  );
  const detail =
    open && answer ? (
      <Stack gap={8} id={detailId}>
        {others.length > 0 ? (
          <Stack gap={4} className={classes.inset}>
            <Text fz={11.5} fw={500} lh="normal" c="dimmed" data-parity="h">
              Passed on
            </Text>
            {others.map(o => (
              <Group key={o.value} gap={8} wrap="nowrap">
                <span className={classes.dash} data-parity="dash" />
                <Text fz={12.5} lh="normal" c="dimmed" data-parity="t">
                  {o.text}
                </Text>
              </Group>
            ))}
          </Stack>
        ) : null}
        {answer.note ? (
          <Group
            gap={8}
            wrap="nowrap"
            align="flex-start"
            className={classes.inset}
          >
            <Icon
              name="messageSquare"
              size={13}
              className={classes.noteIcon}
              data-parity="i"
            />
            <Text fz={12.5} lh="normal" data-parity="t">
              “{answer.note}”
            </Text>
          </Group>
        ) : null}
        {answer.text ? (
          <Text
            fz={12.5}
            lh="normal"
            fs="italic"
            className={classes.inset}
            data-parity="text"
          >
            {answer.text}
          </Text>
        ) : null}
        {context ? (
          <Found id={`${detailId}-context`} context={context} />
        ) : null}
      </Stack>
    ) : null;

  const root = {
    id: `decision-${gate.id}-${question.id}`,
    'data-gate-id': gate.id,
    'data-muted': muted ? 'true' : undefined,
  };
  if (!open && !linked)
    return (
      <div {...root} className={classes.row}>
        {head}
      </div>
    );
  return (
    <Paper
      {...root}
      variant="panel-outline"
      radius={10}
      className={classes.open}
      data-linked={linked ? 'true' : undefined}
      data-selected={linked ? true : undefined}
      data-parity={open ? 'decision open' : undefined}
    >
      {head}
      {detail}
    </Paper>
  );
}
