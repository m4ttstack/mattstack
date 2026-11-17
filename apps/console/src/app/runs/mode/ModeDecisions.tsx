import { createContext, useContext, useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Stack,
  Text,
  Textarea,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import type { GateRow } from '@mattstack/rt-client';

import { modeOf, type ModeFeedRow, type PauseState } from '../derive/modeFeed';
import { Glyph } from '../Glyph';
import classes from './ModeDecisions.module.css';
import { useModeControls } from './useModeControls';

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const shortSha = (sha: string) => sha.slice(0, 7);

/** The run a page shows, for gate records deep in its story to offer Redo
    without threading the run through every component between. */
export const ModeRunContext = createContext<{
  repo: string;
  runId: string;
  canControl: boolean;
} | null>(null);

/** Redo for one gate record in a run's story: whether it can be redone, a
    toggle for its link, and the open note to draw under the record. */
export function useGateRedo(gate: GateRow): {
  canRedo: boolean;
  open: boolean;
  toggle: () => void;
  note: ReactNode;
} {
  const run = useContext(ModeRunContext);
  const [open, setOpen] = useState(false);
  const stage = typeof gate.meta?.stage === 'string' ? gate.meta.stage : null;
  const headCommit =
    typeof gate.meta?.headCommit === 'string' ? gate.meta.headCommit : null;
  const canRedo = Boolean(run?.canControl && stage && modeOf(gate) !== null);
  return {
    canRedo,
    open,
    toggle: () => setOpen(o => !o),
    note:
      run && canRedo && open && stage ? (
        <GateRedoNote
          repo={run.repo}
          runId={run.runId}
          gate={gate.id}
          step={stage}
          headCommit={headCommit}
          onClose={() => setOpen(false)}
        />
      ) : null,
  };
}

/** A story record's open Redo note; it talks to the console only once
    opened. */
function GateRedoNote({
  repo,
  runId,
  gate,
  step,
  headCommit,
  onClose,
}: {
  repo: string;
  runId: string;
  gate: string;
  step: string;
  headCommit: string | null;
  onClose: () => void;
}) {
  const { redo } = useModeControls(repo, runId);
  const [error, setError] = useState<string | null>(null);
  const send = async (note: string) => {
    const err = await redo(gate, note);
    if (err) setError(err);
    else onClose();
  };
  return (
    <RedoNote
      step={step}
      headCommit={headCommit}
      error={error}
      onSend={n => void send(n)}
      onCancel={onClose}
    />
  );
}

/** The run page's notice while a console Pause is on its way or has
    landed. */
export function PausedBanner({
  pause,
  at,
  stage,
  mode,
}: {
  pause: Exclude<PauseState, 'none'>;
  at: number;
  stage: string | null;
  mode: string | null;
}) {
  const where = stage ? ` after ${stage}` : '';
  const title =
    pause === 'pausing'
      ? `Pausing from the console: it stops${where}.`
      : `Paused from the console at ${clock(at)}. It stopped${where}.`;
  const asks = mode
    ? `Gates that open now ask you instead of the ${mode} mode.`
    : 'Gates that open now ask you.';
  return (
    <Alert
      color="yellow"
      variant="light"
      icon={<Glyph name="hand" size={16} />}
      data-testid="paused-banner"
    >
      <Text fz="sm" fw={600}>
        {title}
      </Text>
      <Text fz="sm">{asks}</Text>
    </Alert>
  );
}

/** The note box a Redo opens: what the worker should do differently, sent
    back to the gate's step. */
export function RedoNote({
  step,
  headCommit,
  error,
  onSend,
  onCancel,
}: {
  step: string;
  headCommit: string | null;
  error: string | null;
  onSend: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const since = headCommit ? ` since ${shortSha(headCommit)}` : '';
  return (
    <Stack gap={8} className={classes.note} data-testid="redo-note">
      <Text fz="sm" fw={600}>
        {`Send back to ${step}`}
      </Text>
      <Textarea
        autosize
        minRows={2}
        aria-label="What the worker should do differently"
        placeholder="What should the worker do differently?"
        value={note}
        onChange={e => setNote(e.currentTarget.value)}
      />
      <Text fz="xs" c="dimmed">
        {`The worker goes back at its next step and reads this. Work${since} stays in history: it reverts or keeps each change with new commits.`}
      </Text>
      {error ? (
        <Group gap={6} wrap="nowrap" data-testid="redo-refused">
          <Glyph name="circleAlert" size={13} color="red" />
          <Text fz="xs" c="red">
            {`Can't redo: ${error}`}
          </Text>
        </Group>
      ) : null}
      <Group gap={8}>
        <Button variant="default" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={note.trim() === ''}
          onClick={() => onSend(note.trim())}
        >
          {`Send back to ${step}`}
        </Button>
      </Group>
    </Stack>
  );
}

/** One gate a mode answered: its step, the choice, when, and Redo. */
export function ModeDecisionRow({
  row,
  canRedo,
  active,
  onRedo,
}: {
  row: ModeFeedRow;
  canRedo: boolean;
  active: boolean;
  onRedo: () => void;
}) {
  return (
    <Group gap={8} wrap="nowrap" data-testid={`mode-row-${row.gate.id}`}>
      <Glyph name="signpost" size={13} color="dimmed" />
      {row.stage ? (
        <Text fz="xs" ff="monospace" c="dimmed">
          {row.stage}
        </Text>
      ) : null}
      <Text fz="sm" truncate>
        {row.choice}
      </Text>
      <Text fz="xs" c="dimmed" style={{ flexShrink: 0 }}>
        {clock(row.answeredAt)}
      </Text>
      {canRedo && row.stage ? (
        <Button
          ml="auto"
          size="compact-xs"
          variant={active ? 'light' : 'subtle'}
          color={active ? undefined : 'gray'}
          onClick={onRedo}
        >
          Redo
        </Button>
      ) : null}
    </Group>
  );
}

/** A run's mode at a glance, with Pause and every decision it made alone
    and a Redo on each. The live lanes and the run page both draw this. */
export function ModePanel({
  repo,
  runId,
  mode,
  rows,
  canControl,
  pause,
  stage,
  defaultOpen = false,
}: {
  repo: string;
  runId: string;
  mode: string;
  rows: ModeFeedRow[];
  canControl: boolean;
  pause: PauseState;
  /** The step the run is on, for "stops after <step>". */
  stage: string | null;
  defaultOpen?: boolean;
}) {
  const { pause: hold, redo } = useModeControls(repo, runId);
  const [open, setOpen] = useState(defaultOpen);
  const [redoing, setRedoing] = useState<string | null>(null);
  const [redoError, setRedoError] = useState<string | null>(null);
  const [pressed, setPressed] = useState(false);
  const shown: PauseState = pause === 'none' && pressed ? 'pausing' : pause;

  const summary = [
    rows.length > 0
      ? `decided ${rows.length} without you`
      : 'nothing decided alone yet',
    shown === 'pausing' && stage ? `stops after ${stage}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const onPause = async () => {
    setPressed(true);
    const err = await hold();
    if (err) setPressed(false);
  };

  const send = async (gate: string, note: string) => {
    const err = await redo(gate, note);
    if (err) {
      setRedoError(err);
      return;
    }
    setRedoing(null);
    setRedoError(null);
  };

  return (
    <Stack gap={8} data-testid="mode-panel">
      <Group gap={8} wrap="nowrap">
        <Badge color="blue" size="sm">
          {mode}
        </Badge>
        {shown !== 'none' ? (
          <Badge color="yellow" size="sm">
            {shown}
          </Badge>
        ) : null}
        <Text fz="xs" c="dimmed" truncate>
          {summary}
        </Text>
        {rows.length > 0 ? (
          <UnstyledButton
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            style={{ flexShrink: 0 }}
          >
            <Group gap={3} wrap="nowrap">
              <Text fz="xs" fw={500} c="blue">
                {open ? 'Hide' : 'Show'}
              </Text>
              <Glyph
                name={open ? 'chevronUp' : 'chevronDown'}
                size={12}
                color="blue"
              />
            </Group>
          </UnstyledButton>
        ) : null}
        {canControl && shown === 'none' ? (
          <Button
            ml="auto"
            size="compact-sm"
            variant="default"
            onClick={onPause}
          >
            Pause
          </Button>
        ) : null}
        {shown === 'pausing' ? (
          <Text ml="auto" fz="xs" c="dimmed" style={{ flexShrink: 0 }}>
            Pausing…
          </Text>
        ) : null}
      </Group>
      {open
        ? rows.map(row => (
            <Stack key={row.gate.id} gap={6}>
              <ModeDecisionRow
                row={row}
                canRedo={canControl}
                active={redoing === row.gate.id}
                onRedo={() => {
                  setRedoing(redoing === row.gate.id ? null : row.gate.id);
                  setRedoError(null);
                }}
              />
              {redoing === row.gate.id && row.stage ? (
                <RedoNote
                  step={row.stage}
                  headCommit={row.headCommit}
                  error={redoError}
                  onSend={note => void send(row.gate.id, note)}
                  onCancel={() => setRedoing(null)}
                />
              ) : null}
            </Stack>
          ))
        : null}
    </Stack>
  );
}
