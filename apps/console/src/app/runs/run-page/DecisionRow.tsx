import {
  ActionIcon,
  Badge,
  Collapse,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import { useDisclosure } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import type { GateQuestion, GateRow } from '@mattstack/rt-client';

import { answerStamp, answerSurface } from '../derive/answers';
import {
  gateEndNote,
  optionViews,
  pickedText,
  questionAnswer,
  tookRecommendation,
} from '../derive/gates';
import classes from './DecisionRow.module.css';

export interface DecisionRowProps {
  gate: GateRow;
  question: GateQuestion;
}

/** One answered gate question in the story: the question, the pick, who
    answered and when. Expands to the note, the other options and whether the
    pick went against the recommendation. A closed or superseded gate draws
    muted with why it ended. */
export function DecisionRow({ gate, question }: DecisionRowProps) {
  const [expanded, { toggle }] = useDisclosure(false);
  const ended = gateEndNote(gate);
  const answer = questionAnswer(gate.answer, question);
  const stamp = ended ? null : answerStamp(gate);
  const surface = answerSurface(gate);
  const views = optionViews(question);
  const others = answer
    ? views.filter(o => !answer.picked.includes(o.value))
    : [];
  const against = tookRecommendation(question, gate.answer) === false;
  const expandable =
    !ended &&
    answer !== null &&
    (others.length > 0 || !!answer.note || !!answer.text || against);
  const detailId = `decision-${gate.id}-${question.id}-detail`;

  let pick: string;
  if (ended) pick = ended;
  else if (answer) pick = pickedText(question, answer.picked);
  else if (gate.status === 'answered') pick = 'No answer recorded';
  else pick = 'Not answered yet';
  const muted = ended !== null || answer === null;

  return (
    <Paper
      id={`decision-${gate.id}-${question.id}`}
      variant="ground"
      withBorder
      radius={10}
      className={classes.row}
      data-muted={muted ? 'true' : undefined}
      data-gate-id={gate.id}
      data-parity="Decision"
    >
      <Group wrap="nowrap" gap={10} align="center">
        <Icon name="signpost" size={14} data-parity="signpost" />
        <Stack gap={2} className={classes.qa}>
          <Text fz={12} lh="normal" c="dimmed" data-parity="q">
            {question.label}
          </Text>
          <Text
            fz={13.5}
            fw={500}
            lh="normal"
            c={muted ? 'dimmed' : undefined}
            data-parity="a"
          >
            {pick}
          </Text>
        </Stack>
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
              data-parity="stamp"
            >
              {stamp}
            </Text>
          </Tooltip>
        ) : null}
        {expandable ? (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={expanded ? 'Hide details' : 'Show details'}
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={toggle}
          >
            <Icon
              name={expanded ? 'chevronUp' : 'chevronDown'}
              size={14}
              data-parity="chevron-down"
            />
          </ActionIcon>
        ) : null}
      </Group>
      {expandable ? (
        <Collapse expanded={expanded} id={detailId}>
          <Stack gap="xs" pt="sm">
            {answer?.note ? (
              <Group gap="xs" wrap="nowrap" align="flex-start">
                <Icon name="messageSquare" size={14} />
                <Text size="sm">{answer.note}</Text>
              </Group>
            ) : null}
            {answer?.text ? (
              <Text size="sm" fs="italic">
                {answer.text}
              </Text>
            ) : null}
            {others.length > 0 ? (
              <Stack gap={4}>
                {others.map(o => (
                  <Group key={o.value} gap="xs" wrap="nowrap">
                    <Icon name="circle" size={13} />
                    <Text size="sm" c="dimmed">
                      {o.text}
                    </Text>
                    {o.recommended ? (
                      <Badge size="xs" variant="default" tt="none">
                        recommended
                      </Badge>
                    ) : null}
                  </Group>
                ))}
              </Stack>
            ) : null}
            {against ? (
              <Badge size="sm" variant="light" color="warn" tt="none">
                went against the recommendation
              </Badge>
            ) : null}
          </Stack>
        </Collapse>
      ) : null}
    </Paper>
  );
}
