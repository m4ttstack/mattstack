import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  Kbd,
  Paper,
  Radio,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { modals } from '@mattstack/app-kit/modals';
import {
  answeredGateSummary,
  resolveAnswerOutcome,
  type GateAnswers,
  type GateSelections,
} from '@mattstack/gate-kit';
import {
  answersFromForm,
  gateItems,
  noteFieldName,
  type GateItemChoice,
  type GateItemDisplay,
} from '@mattstack/gate-kit/react';
import type { GateRow } from '@mattstack/rt-client';
import { useQueryClient } from '@tanstack/react-query';

import { isMine } from '../../../shared/gate-waiting';
import { client } from '../../api';
import { formatDuration } from '../derive/duration';
import { contextBlocks, splitCommand } from '../derive/gates';
import { Eyebrow } from '../Eyebrow';
import { GateContext } from '../GateContext';
import { Glyph } from '../Glyph';
import { RetryAlert } from '../RetryAlert';
import { StatusCard } from '../StatusCard';
import classes from './GatePanel.module.css';
import { useGateDraft } from './useGateDraft';

const NUMBER_WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
];

function answersNeeded(count: number): string {
  const n = NUMBER_WORDS[count] ?? String(count);
  return `${n} ${count === 1 ? 'answer' : 'answers'}`;
}

/** A step's name: the question id as words ("code-changes" is "Code
    changes"), since questions carry no short title. */
function stepName(id: string): string {
  const words = id.replace(/[-_]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isAnswered(item: GateItemDisplay, value: unknown): boolean {
  if (item.multiple) return Array.isArray(value) && value.length > 0;
  return typeof value === 'string' && value.length > 0;
}

/** The panel's picks and notes as the native form the gate-kit answer
    builder reads, so this panel and the board build one wire shape. */
function formOf(
  display: GateItemDisplay[],
  selections: GateSelections,
  notes: Record<string, string>
): FormData {
  const form = new FormData();
  for (const item of display) {
    const value = selections[item.name];
    if (Array.isArray(value)) for (const v of value) form.append(item.name, v);
    else if (typeof value === 'string') form.set(item.name, value);
    const note = notes[item.name];
    if (note) form.set(noteFieldName(item.name), note);
  }
  return form;
}

const REFUSED = 'the daemon refused the answer';

/** Why a submit failed, in the words the strip reads: the server's own
    `error`, else the daemon refused it. */
function refusalReason(body: unknown): string {
  const error =
    body && typeof body === 'object' && 'error' in body
      ? (body as { error: unknown }).error
      : null;
  return typeof error === 'string' && error.trim()
    ? error.trim().replace(/\.$/, '')
    : REFUSED;
}

export function typingTarget(target: EventTarget): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement &&
      target.type !== 'radio' &&
      target.type !== 'checkbox')
  );
}

type Payload = { answers: GateAnswers };

export interface GatePanelProps {
  gate: GateRow;
  /** The stage the gate stops, or null when the run does not say. */
  stage: string | null;
  now: number;
}

/** Where Matt answers an open or parked `run:` gate on the live run page:
    what the agent found beside a stepped form, one question at a time. A
    gate a shepherd owns reads neutral and asks before its answer overrides
    the shepherd. */
export function GatePanel({ gate, stage, now }: GatePanelProps) {
  const queryClient = useQueryClient();
  const mine = isMine(gate);
  const draft = useGateDraft(gate.id);
  const [selections, setSelections] = useState<GateSelections>(
    () => draft.initial?.selections ?? {}
  );
  const [notes, setNotes] = useState<Record<string, string>>(
    () => draft.initial?.notes ?? {}
  );
  const { display } = useMemo(
    () => gateItems({ kind: gate.kind, questions: gate.questions }, selections),
    [gate.kind, gate.questions, selections]
  );
  const [item, setItem] = useState<string | null>(
    () => draft.initial?.item ?? null
  );
  const [skipped, setSkipped] = useState<string[]>(
    () => draft.initial?.skipped ?? []
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{
    reason: string;
    payload: Payload;
  } | null>(null);
  const [lostChip, setLostChip] = useState<string | null>(null);
  const [focusError, setFocusError] = useState<string | null>(null);
  const [focusBusy, setFocusBusy] = useState(false);
  const { save } = draft;

  useEffect(() => {
    save({ selections, notes, item, skipped });
  }, [save, selections, notes, item, skipped]);

  const found = display.findIndex(d => d.name === item);
  const index = found < 0 ? 0 : found;
  const active = display[index];
  const last = index === display.length - 1;
  const stepped = display.length > 1;
  const activeValue = active ? selections[active.name] : undefined;
  const answered = active ? isAnswered(active, activeValue) : false;
  const skippable = active !== undefined && !active.required && !answered;

  const goTo = (i: number) => {
    const target = display[i];
    if (target) setItem(target.name);
  };

  const choose = (name: string, value: string | string[]) => {
    setFailure(null);
    setSelections(prev => ({ ...prev, [name]: value }));
    setSkipped(prev => prev.filter(n => n !== name));
  };

  const pick = (choice: string) => {
    if (!active) return;
    if (!active.multiple) {
      choose(active.name, choice);
      return;
    }
    const name = active.name;
    setFailure(null);
    setSelections(prev => {
      const current = prev[name];
      const set = new Set(Array.isArray(current) ? current : []);
      if (set.has(choice)) set.delete(choice);
      else set.add(choice);
      return { ...prev, [name]: [...set] };
    });
    setSkipped(prev => prev.filter(n => n !== name));
  };

  const post = async (payload: Payload) => {
    setBusy(true);
    setFailure(null);
    let body: unknown = null;
    try {
      const res = await client.api.gates[':id'].answer.$post({
        param: { id: gate.id },
        json: payload,
      });
      body = await res.json().catch(() => null);
      const outcome = resolveAnswerOutcome(res.status, body);
      if (outcome.kind === 'lost') {
        setLostChip(
          answeredGateSummary({
            subject: gate.subject,
            kind: gate.kind,
            status: 'answered',
            questions: gate.questions,
            answer: { answers: outcome.answers, by: outcome.by },
          }).chip
        );
        draft.clear();
        void queryClient.invalidateQueries({ queryKey: ['gates'] });
        setBusy(false);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setBusy(false);
      setFailure({ reason: refusalReason(body), payload });
      return;
    }
    setBusy(false);
    draft.clear();
    void queryClient.invalidateQueries({ queryKey: ['gates'] });
  };

  /** A multi counts as answered only once something is picked or it was
      skipped on purpose, so a step jumped over is never posted as "none". */
  const submit = (skips: string[]) => {
    if (busy) return;
    const open = display.findIndex(
      d => !isAnswered(d, selections[d.name]) && !skips.includes(d.name)
    );
    if (open >= 0) {
      goTo(open);
      return;
    }
    const payload = answersFromForm(
      { kind: gate.kind, questions: gate.questions },
      formOf(display, selections, notes)
    );
    if (!payload) return;
    if (mine) {
      void post(payload);
      return;
    }
    modals.confirm({
      title: 'Answer for the shepherd?',
      message:
        'A shepherd owns this gate. Your answer overrides it and the shepherd is not asked.',
      labels: { confirm: 'Override and submit' },
      onConfirm: () => void post(payload),
    });
  };

  const advance = () => {
    if (!active || (active.required && !answered)) return;
    const skips =
      skippable && !skipped.includes(active.name)
        ? [...skipped, active.name]
        : skipped;
    if (skips !== skipped) setSkipped(skips);
    if (last) submit(skips);
    else goTo(index + 1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      advance();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (!/^[1-9]$/.test(event.key) || typingTarget(event.target)) return;
    const choice = active?.choices[Number(event.key) - 1];
    if (!choice) return;
    event.preventDefault();
    pick(choice.value);
  };

  const parked = gate.status === 'parked';
  const focusReason = parked
    ? 'parked; resume is board-owned'
    : gate.origin?.paneId || gate.origin?.worktree
      ? null
      : 'no origin on this gate';
  const openPane = async () => {
    if (focusBusy) return;
    setFocusBusy(true);
    setFocusError(null);
    try {
      const res = await client.api.gates[':id'].focus.$post({
        param: { id: gate.id },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setFocusError(body?.error ?? `Couldn't open the pane (${res.status})`);
      }
    } catch {
      setFocusError("Couldn't open the pane");
    } finally {
      setFocusBusy(false);
    }
  };

  const context =
    active?.context ??
    (typeof gate.context === 'string' && gate.context.length > 0
      ? gate.context
      : null);
  const tone = mine ? 'mine' : 'herd';
  const age = formatDuration(now - gate.openedAt);
  const primaryLabel = `${last ? 'Submit' : 'Next'}${skippable ? ' · none' : ''}`;

  return (
    <StatusCard
      tone={mine ? 'bad' : undefined}
      attention={mine ? 'bad' : undefined}
      head={
        <>
          <Glyph
            name={mine ? 'hand' : 'bot'}
            size={18}
            color={mine ? 'bad' : 'dimmed'}
            data-parity={mine ? 'hand' : 'bot'}
          />
          <Stack gap={2} className={classes.ttl}>
            <Text
              fz="xl"
              fw={700}
              lh="normal"
              c={mine ? 'bad' : undefined}
              data-parity="title"
            >
              {stage
                ? `The ${stage} stage needs ${answersNeeded(display.length)}`
                : `This gate needs ${answersNeeded(display.length)}`}
            </Text>
            <Text fz="md" lh="normal" c="dimmed" data-parity="sub">
              {mine
                ? `Opened ${age} ago · the agent waits until you submit`
                : `Opened ${age} ago. A shepherd owns this gate; answering here overrides it.`}
            </Text>
          </Stack>
          {parked && (
            <Badge color="warn" variant="light" data-testid="gate-parked-badge">
              parked
            </Badge>
          )}
          {stepped && (
            <SegmentedControl
              variant="quiet"
              size="sm"
              withItemsBorders={false}
              value={active?.name ?? ''}
              onChange={setItem}
              classNames={{ root: classes.steps }}
              data-testid="gate-stepper"
              data-parity="steps"
              data={display.map((d, i) => ({
                value: d.name,
                label: (
                  <StepLabel
                    n={i + 1}
                    name={stepName(d.name)}
                    current={i === index}
                    done={i !== index && isAnswered(d, selections[d.name])}
                    mine={mine}
                  />
                ),
              }))}
            />
          )}
        </>
      }
      headClassName={classes.head}
      headProps={{ 'data-parity': 'head' }}
      className={classes.panel}
      data-tone={tone}
      data-testid="gate-panel"
      data-gate-id={gate.id}
      data-parity={mine ? 'Gate mine' : 'Gate herd-owned'}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {lostChip !== null ? (
        <div className={classes.lost}>
          <Text fz="lg" lh="normal" c="bad">
            Answered elsewhere: {lostChip}
          </Text>
        </div>
      ) : (
        <div className={classes.split}>
          {context !== null && <Findings text={context} />}
          <Stack gap={10} className={classes.form}>
            {active && (
              <Question
                key={active.name}
                item={active}
                value={activeValue}
                note={notes[active.name] ?? ''}
                onPick={value => choose(active.name, value)}
                onNote={value => {
                  setFailure(null);
                  setNotes(prev => ({ ...prev, [active.name]: value }));
                }}
              />
            )}
            {failure && (
              <RetryAlert
                color="bad"
                icon="circleAlert"
                retryLabel="Try again"
                busy={busy}
                onRetry={() => void post(failure.payload)}
                data-parity="error"
              >
                Couldn&apos;t submit: {failure.reason}. Your picks and note are
                kept.
              </RetryAlert>
            )}
            <Group gap={12} wrap="nowrap" className={classes.footer}>
              <Tooltip
                label={focusReason ?? 'Jump to the pane behind this gate'}
              >
                <span className={classes.tipTarget}>
                  <Button
                    variant="subtle"
                    color="gray"
                    leftSection={
                      <Icon name="squareTerminal" size={14} data-parity="i" />
                    }
                    disabled={focusReason !== null}
                    loading={focusBusy}
                    onClick={() => void openPane()}
                  >
                    <span data-parity="l">Open the pane</span>
                  </Button>
                </span>
              </Tooltip>
              <span className={classes.grow} />
              {focusError && (
                <Text fz="md" lh="normal" c="bad">
                  {focusError}
                </Text>
              )}
              {draft.saved && (
                <Text fz="md" lh="normal" c="dimmed" data-parity="draft">
                  Draft saved
                </Text>
              )}
              <Button
                loading={busy}
                disabled={!skippable && !answered}
                rightSection={
                  <Kbd variant="on-fill" data-parity="key ⌘↵">
                    <span data-parity="k">⌘↵</span>
                  </Kbd>
                }
                onClick={advance}
                data-parity="Next"
              >
                <span data-parity="l">{primaryLabel}</span>
              </Button>
            </Group>
          </Stack>
        </div>
      )}
    </StatusCard>
  );
}

function StepLabel({
  n,
  name,
  current,
  done,
  mine,
}: {
  n: number;
  name: string;
  current: boolean;
  done: boolean;
  mine: boolean;
}) {
  const body = (
    <>
      <Text
        component="span"
        fz="sm"
        fw={500}
        lh="normal"
        c={current && mine ? 'bad' : undefined}
        className={classes.stepN}
        data-parity="n"
      >
        {done ? <Icon name="check" size={12} aria-label="answered" /> : n}
      </Text>
      <Text
        component="span"
        fz="md"
        fw={current ? 500 : 400}
        lh="normal"
        data-parity="l"
      >
        {name}
      </Text>
    </>
  );
  return current ? (
    <span className={classes.step} data-parity={`step ${name}`}>
      {body}
    </span>
  ) : (
    <span className={classes.step}>{body}</span>
  );
}

/** A fenced block's first line read as a `file:line` location. */
const LOCATION = /^\S+:\d+$/;

/** A fenced excerpt the agent quoted: where it is from, when its first line
    says, then the code. */
function CodeExcerpt({ lines }: { lines: string[] }) {
  const path = lines.length > 0 && LOCATION.test(lines[0]!) ? lines[0]! : null;
  const code = path === null ? lines : lines.slice(1);
  return (
    <Stack gap={4} data-parity="code">
      {path !== null ? (
        <Text ff="monospace" size="sm" c="dimmed" data-parity="path">
          {path}
        </Text>
      ) : null}
      <Paper
        variant="soft-outline"
        radius="sm"
        className={classes.code}
        data-parity="block"
      >
        <Code block>{code.join('\n')}</Code>
      </Paper>
    </Stack>
  );
}

function Findings({ text }: { text: string }) {
  const blocks = contextBlocks(text);
  return (
    <Stack
      gap={10}
      className={classes.context}
      data-parity="context"
      data-testid="gate-findings"
    >
      <Eyebrow data-parity="label">What the agent found</Eyebrow>
      {blocks.map((block, i) =>
        block.kind === 'markdown' ? (
          <div
            key={i}
            className={classes.findings}
            data-parity={i === 0 ? 'lead' : undefined}
          >
            <GateContext text={block.text} />
          </div>
        ) : block.kind === 'code' ? (
          <CodeExcerpt key={i} lines={block.lines} />
        ) : (
          <div key={i} className={classes.points}>
            {block.points.map((point, j) => (
              <div key={j} className={classes.point}>
                <Text fz="md" fw={500} lh="normal" data-parity="k">
                  {point.label}
                </Text>
                <div className={classes.pointText} data-parity="v">
                  <GateContext text={point.text} />
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </Stack>
  );
}

function OptionBody({
  choice,
  index,
  multiple,
}: {
  choice: GateItemChoice;
  index: number;
  multiple: boolean;
}) {
  const description = choice.subtitle ?? choice.description;
  const { prose, command } = description
    ? splitCommand(description)
    : { prose: '', command: null };
  return (
    <Group gap={12} wrap="nowrap" className={classes.optionRow}>
      {multiple ? (
        <Checkbox.Indicator data-parity="radio" />
      ) : (
        <Radio.Indicator data-parity="radio" />
      )}
      <Stack gap={3} className={classes.optionText}>
        <Group gap={8} wrap="nowrap">
          <Text fz="lg" fw={500} lh="normal" data-parity="t">
            {choice.label}
          </Text>
          {choice.recommended && (
            <Badge
              size="sm"
              variant="light"
              color="ok"
              tt="none"
              data-parity="recommended"
            >
              <span data-parity="l">Recommended</span>
            </Badge>
          )}
        </Group>
        {prose && (
          <Text fz="md" lh="normal" c="dimmed" data-parity="d">
            {prose}
          </Text>
        )}
        {command && (
          <Code className={classes.command} data-parity="cmd">
            <span data-parity="c">{command}</span>
          </Code>
        )}
      </Stack>
      {index < 9 && (
        <Kbd
          size="sm"
          className={classes.cap}
          data-testid="gate-option-key"
          data-parity={`key ${index + 1}`}
        >
          <span data-parity="n">{index + 1}</span>
        </Kbd>
      )}
    </Group>
  );
}

function Question({
  item,
  value,
  note,
  onPick,
  onNote,
}: {
  item: GateItemDisplay;
  value: string | string[] | undefined;
  note: string;
  onPick: (value: string | string[]) => void;
  onNote: (value: string) => void;
}) {
  const label = <span data-parity="q">{item.prompt}</span>;
  const labelProps = { fz: 'h2', fw: 700, lh: 'normal' };
  const options = (
    <Stack gap={10}>
      {item.choices.map((choice, i) => {
        const body: ReactNode = (
          <OptionBody choice={choice} index={i} multiple={item.multiple} />
        );
        const parity = `option ${choice.label}`;
        return item.multiple ? (
          <Checkbox.Card
            key={choice.value}
            value={choice.value}
            variant="wash"
            className={classes.card}
            data-parity={parity}
          >
            {body}
          </Checkbox.Card>
        ) : (
          <Radio.Card
            key={choice.value}
            value={choice.value}
            variant="wash"
            className={classes.card}
            data-parity={parity}
          >
            {body}
          </Radio.Card>
        );
      })}
    </Stack>
  );
  return (
    <>
      {item.multiple ? (
        <Checkbox.Group
          label={label}
          labelProps={labelProps}
          classNames={{ label: classes.question }}
          value={Array.isArray(value) ? value : []}
          onChange={onPick}
        >
          {options}
        </Checkbox.Group>
      ) : (
        <Radio.Group
          label={label}
          labelProps={labelProps}
          classNames={{ label: classes.question }}
          value={typeof value === 'string' ? value : ''}
          onChange={onPick}
        >
          {options}
        </Radio.Group>
      )}
      <Textarea
        autosize
        minRows={1}
        aria-label="Note for the agent"
        placeholder="Add a note for the agent (optional)"
        leftSection={<Icon name="messageSquare" size={14} data-parity="i" />}
        value={note}
        onChange={event => onNote(event.currentTarget.value)}
        wrapperProps={{ 'data-parity': 'note' }}
      />
    </>
  );
}

/** Every answerable gate of the run, oldest first, each in its own
    `#gate-<id>` anchor for the deep link. */
export function GatePanels({
  gates,
  stageOf,
  now,
}: {
  gates: GateRow[];
  stageOf: (gate: GateRow) => string | null;
  now: number;
}) {
  const ordered = [...gates].sort((a, b) => a.openedAt - b.openedAt);
  return (
    <Stack gap={14} className={classes.stack}>
      {ordered.map(g => (
        <div key={g.id} id={`gate-${g.id}`} className={classes.slot}>
          <GatePanel gate={g} stage={stageOf(g)} now={now} />
        </div>
      ))}
    </Stack>
  );
}
