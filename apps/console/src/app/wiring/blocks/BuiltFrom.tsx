import {
  Box,
  Code,
  CopyActionIcon,
  Group,
  NavLink,
  Paper,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import type { FocusItem } from '../graph/model/focusModel';
import { StatusDot } from '../graph/StatusDot';
import type { SkillsCheck, SkillsComposition } from '../outline';
import type { SkillsAnatomy } from '../useWiring';
import { BuiltFromTable } from './BuiltFromTable';
import classes from './history.module.css';
import {
  blockBuiltFrom,
  blockNote,
  builtFrom,
  staleSteps,
  stampNote,
  type StaleStep,
} from './model/history';
import { TabHeading } from './TabHeading';

const MUTED = 'var(--tk-text-3)';
const BODY = 'var(--tk-text-1)';
const WARN = 'var(--tk-text-warn)';

const STALE_ROW = { root: classes.staleRow, section: classes.staleSection };

/** The outline is the row's own layer; the button inside it only paints on
    hover. */
function StaleStepRow({
  step,
  onOpen,
}: {
  step: StaleStep;
  onOpen: (step: StaleStep) => void;
}) {
  return (
    <Paper
      variant="soft-outline"
      radius={6}
      data-parity={`stale · ${step.skill}`}
    >
      <NavLink
        component="button"
        type="button"
        label={
          <Text
            span
            ff="monospace"
            fz={11}
            lh="normal"
            c={BODY}
            className={classes.rowLabel}
            data-parity="f"
          >
            {step.skill}/SKILL.md
          </Text>
        }
        leftSection={<StatusDot tone="warn" data-parity="dot" />}
        rightSection={
          <Group gap={8}>
            <Text span fz={11} lh="normal" c={WARN} data-parity="w">
              {step.reason ? `stale: ${step.reason}` : 'stale'}
            </Text>
            <Icon
              name="chevronRight"
              size={12}
              color={MUTED}
              data-parity="go"
            />
          </Group>
        }
        classNames={STALE_ROW}
        data-testid="stale-step"
        onClick={() => onOpen(step)}
      />
    </Paper>
  );
}

function SyncCommand({ pack }: { pack: string }) {
  const command = `rt skills sync --pack ${pack}`;
  return (
    <Code
      block
      color="bg-level-1"
      className={classes.fix}
      data-parity="fix"
      data-testid="sync-command"
    >
      <Text
        span
        ff="monospace"
        fz={11}
        lh="normal"
        c={BODY}
        className={classes.command}
        data-parity="cmd"
      >
        {command}
      </Text>
      <CopyActionIcon
        value={command}
        label="Copy command"
        size={21}
        className={classes.copy}
        icon={<Icon name="copy" size={13} color={MUTED} data-parity="copy" />}
      />
    </Code>
  );
}

function HistoryNote({ children }: { children: string }) {
  return (
    <Paper
      variant="panel-outline"
      radius={7}
      className={classes.note}
      data-parity="note"
      data-testid="history-note"
    >
      <Text fz={13} lh={1.5} c="var(--tk-text-2)" data-parity="t">
        {children}
      </Text>
    </Paper>
  );
}

type HistoryBlock = { id: string; path: string };

type HistoryProps = {
  pack: string;
  anatomy: SkillsAnatomy;
  composition: SkillsComposition;
  check: SkillsCheck | undefined;
  /** The pipeline the open skill runs in, or leads. */
  pipeline: FocusItem | null;
  /** Opens a stale step's own history. */
  onOpen: (focus: string) => void;
};

/** One block's copy in the open skill: its text and the files its props
    paste in, with the versions built and installed. */
function BlockHistory({
  anatomy,
  check,
  block,
}: Pick<HistoryProps, 'anatomy' | 'check'> & {
  block: HistoryBlock;
}) {
  const row = check?.verbs.find(verb => verb.name === anatomy.skill);
  const rows = blockBuiltFrom(anatomy, row, block);
  return (
    <>
      <TabHeading parity="h1" testId="history-heading">
        In {anatomy.skill}
      </TabHeading>
      <BuiltFromTable rows={rows} />
      <HistoryNote>{blockNote(rows, anatomy.skill)}</HistoryNote>
    </>
  );
}

/** What a compiled skill was built from and whether any of it changed since,
    and the other steps of its pipeline that need a rebuild. */
function SkillHistory({
  pack,
  anatomy,
  check,
  pipeline,
  onOpen,
}: HistoryProps) {
  const row = check?.verbs.find(verb => verb.name === anatomy.skill);
  const rows = builtFrom(anatomy, row);
  const note = stampNote(rows, row);
  const stale = pipeline ? staleSteps(pipeline, check, anatomy.skill) : [];
  const rebuild =
    stale.length > 0 ||
    row?.status === 'stale' ||
    row?.status === 'never-compiled';
  return (
    <>
      <BuiltFromTable rows={rows} />
      {note && <HistoryNote>{note}</HistoryNote>}
      {stale.length > 0 && (
        <>
          <TabHeading parity="h2">Elsewhere in this pipeline</TabHeading>
          <Stack gap={6}>
            {stale.map(step => (
              <StaleStepRow
                key={step.skill}
                step={step}
                onOpen={() => onOpen(step.focus)}
              />
            ))}
          </Stack>
        </>
      )}
      {rebuild && (
        <>
          <SyncCommand pack={pack} />
          <Text fz={11} lh="normal" c={MUTED} data-parity="fixnote">
            Rebuilds every stale {pipeline ? 'step' : 'skill'} from the
            installed sources.
          </Text>
        </>
      )}
    </>
  );
}

/**
 * What a block or skill was built from: on a block, that block's copy in the open skill; on the
 * skill itself, the whole compiled skill.
 */
export function BuiltFrom({
  block,
  ...props
}: HistoryProps & {
  /** The open block; null for the skill as a whole. */
  block: HistoryBlock | null;
}) {
  return (
    <Box data-parity="history" data-testid="block-history">
      <Stack gap={12}>
        {block ? (
          <BlockHistory
            anatomy={props.anatomy}
            check={props.check}
            block={block}
          />
        ) : (
          <SkillHistory {...props} />
        )}
      </Stack>
    </Box>
  );
}
