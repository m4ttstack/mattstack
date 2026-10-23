import { useMemo } from 'react';
import {
  Anchor,
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
import {
  buildSpine,
  spineRows,
  type SkillsCheck,
  type SkillsComposition,
} from '../outline';
import type { SkillsAnatomy } from '../useWiring';
import { VersionTimeline } from '../VersionTimeline';
import { BuiltFromTable } from './BuiltFromTable';
import classes from './history.module.css';
import {
  builtFrom,
  fileNote,
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
      <Text fz={12} lh="normal" c={MUTED} data-parity="t">
        {children}
      </Text>
    </Paper>
  );
}

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

/** One file's copy in the open skill: the version the skill was built with,
    the one installed, and whether the copy is current. */
function FileHistory({
  anatomy,
  check,
  file,
  onOpenSkill,
}: Pick<HistoryProps, 'anatomy' | 'check'> & {
  file: string;
  onOpenSkill?: () => void;
}) {
  const row = check?.verbs.find(verb => verb.name === anatomy.skill);
  const own = builtFrom(anatomy, row).find(source => source.path === file);
  return (
    <>
      <TabHeading parity="h1" testId="history-heading">
        In {anatomy.skill}
      </TabHeading>
      {own ? (
        <>
          <BuiltFromTable rows={[own]} />
          <HistoryNote>{fileNote(own, anatomy.skill)}</HistoryNote>
        </>
      ) : (
        <Text fz={12} lh="normal" c={MUTED} data-testid="history-no-copy">
          {'No history for this block. '}
          {onOpenSkill ? (
            <Anchor
              component="button"
              type="button"
              fz={12}
              onClick={onOpenSkill}
            >
              {`Open ${anatomy.skill}`}
            </Anchor>
          ) : (
            `Open ${anatomy.skill}`
          )}
          {' for its build history.'}
        </Text>
      )}
    </>
  );
}

/** What a compiled skill was built from and whether any of it changed since,
    the other steps of its pipeline that need a rebuild, and, for a roster
    verb, its commit history. */
function SkillHistory({
  pack,
  anatomy,
  composition,
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
  const entry = useMemo(
    () =>
      spineRows(buildSpine(composition, check ?? { verbs: [] })).find(
        candidate => candidate.verb === anatomy.skill
      ) ?? null,
    [composition, check, anatomy.skill]
  );

  return (
    <>
      <TabHeading parity="h1" testId="history-heading">
        Built from
      </TabHeading>
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
      {entry?.verb && (
        <Box className={classes.timeline}>
          <VersionTimeline
            pack={pack}
            verb={entry.verb}
            refName={entry.ref}
            health={entry.health}
            staleFiles={entry.staleFiles}
            sourcePath={entry.sourcePath}
            artifactPath={entry.artifactPath}
            props={entry.props}
          />
        </Box>
      )}
    </>
  );
}

/**
 * A block's History. On a block it is that block file's copy in the open
 * skill; on the skill itself it is the whole compiled skill.
 */
export function HistoryTab({
  file,
  onOpenSkill,
  ...props
}: HistoryProps & {
  /** The block's own file; null for the skill as a whole. */
  file: string | null;
  /** Opens the skill itself, whose History covers its build. */
  onOpenSkill?: () => void;
}) {
  return (
    <Box data-parity="history" data-testid="block-history">
      <Stack gap={12}>
        {file ? (
          <FileHistory
            anatomy={props.anatomy}
            check={props.check}
            file={file}
            onOpenSkill={onOpenSkill}
          />
        ) : (
          <SkillHistory {...props} />
        )}
      </Stack>
    </Box>
  );
}
