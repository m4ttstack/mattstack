import { useId, useState, type ReactNode } from 'react';
import {
  Anchor,
  Badge,
  Paper,
  Skeleton,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { RunDecisionRow } from '@mattstack/rt-client';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';

import type {
  ConfigDepRow,
  EffectiveInputsPayload,
  PackVersionRow,
} from '../../server/effectiveInputs';
import { client } from '../api';
import { decisionSentence, packState, settingValue } from './derive/inputs';
import classes from './EffectiveInputs.module.css';
import { LABEL_TYPE } from './run-page/SideCards';
import {
  StageDocText,
  useStageDoc,
  useStageDocDrawer,
} from './run-page/StageDoc';

export const INPUTS_SUB =
  'What this run was told, from the pack versions it recorded';

export function useEffectiveInputs(repo: string, runId: string) {
  return useQuery({
    queryKey: ['effective-inputs', repo, runId],
    queryFn: async () => {
      const res = await client.api.runs[':repo'][':runId'][
        'effective-inputs'
      ].$get({ param: { repo, runId } });
      const body = await res.json();
      if (!res.ok) {
        const message =
          body &&
          typeof body === 'object' &&
          'error' in body &&
          typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : `effective inputs failed: ${res.status}`;
        throw new Error(message);
      }
      return body as EffectiveInputsPayload;
    },
  });
}

function Section({ name, children }: { name: string; children: ReactNode }) {
  return (
    <Stack gap={8}>
      <Text {...LABEL_TYPE} data-parity="h">
        {name}
      </Text>
      {children}
    </Stack>
  );
}

function Box({ children }: { children: ReactNode }) {
  return (
    <Paper
      variant="ground"
      withBorder
      radius={10}
      className={classes.box}
      data-parity="box"
    >
      {children}
    </Paper>
  );
}

const Spacer = () => <span className={classes.sp} />;

function Pill({ label, tone }: ReturnType<typeof packState>) {
  return (
    <Badge
      size="xs"
      variant={tone === 'quiet' ? 'panel-outline' : 'light'}
      color={tone === 'quiet' ? 'gray' : tone}
      tt="none"
      data-parity="pill"
      attributes={{ label: { 'data-parity': 'l' } }}
    >
      {label}
    </Badge>
  );
}

function PackRow({ pack, last }: { pack: PackVersionRow; last: boolean }) {
  return (
    <div
      className={`${classes.rule} ${classes.flat}`}
      data-parity={last ? undefined : 'row'}
      data-testid={`pack-row-${pack.pack}`}
    >
      <Text fz={13.5} fw={500} lh="normal" data-parity="n">
        {pack.pack}
      </Text>
      <Text ff="monospace" fz={12} lh="normal" c="dimmed" data-parity="s">
        {pack.recordedSha.slice(0, 7)}
      </Text>
      <Spacer />
      <Pill {...packState(pack)} />
    </div>
  );
}

function PacksSection({ payload }: { payload: EffectiveInputsPayload }) {
  return (
    <Section name="Packs">
      {payload.packVersions === null ? (
        <Text fz={12.5} lh="normal" c="dimmed">
          pre-v2 run — pack version not recorded
        </Text>
      ) : (
        <Box>
          {payload.packVersions.map((pack, i, all) => (
            <PackRow key={pack.pack} pack={pack} last={i === all.length - 1} />
          ))}
        </Box>
      )}
      {payload.packDirty && (
        <Text fz={12.5} lh="normal" c="dimmed">
          pack tree had uncommitted changes — the as-run text may exist in no
          commit
        </Text>
      )}
    </Section>
  );
}

function StageDocRow({
  repo,
  runId,
  stage,
}: {
  repo: string;
  runId: string;
  stage: string;
}) {
  const [open, setOpen] = useState(false);
  const doc = useStageDoc(repo, runId, stage);
  const drawer = useStageDocDrawer();
  const bodyId = useId();
  const missing = doc.data === null;
  const meta = missing
    ? 'no doc at this version'
    : doc.isError
      ? `couldn't read the doc: ${(doc.error as Error).message}`
      : open && doc.data?.pack
        ? `from ${doc.data.pack}`
        : '';
  const expanded = open && !missing && !doc.isError;
  return (
    <div
      className={`${classes.rule} ${classes.row}`}
      data-open={expanded || undefined}
      data-parity={`doc ${stage}`}
      data-testid={`stage-row-${stage}`}
    >
      <UnstyledButton
        className={classes.head}
        aria-expanded={expanded}
        aria-controls={expanded ? bodyId : undefined}
        disabled={missing || doc.isError}
        onClick={() => setOpen(o => !o)}
      >
        <Icon
          name={expanded ? 'chevronDown' : 'chevronRight'}
          size={14}
          className={classes.chev}
          data-parity="chev"
        />
        <Text fz={13.5} fw={expanded ? 500 : 400} lh="normal" data-parity="n">
          {stage}
        </Text>
        <Spacer />
        <Text
          fz={12}
          lh="normal"
          c="dimmed"
          data-parity={meta ? 'm' : undefined}
        >
          {meta}
        </Text>
      </UnstyledButton>
      {expanded ? (
        <Stack gap={8} className={classes.body} id={bodyId}>
          {doc.data ? (
            <>
              <StageDocText text={doc.data.text} preview />
              <Anchor
                component="button"
                type="button"
                fz={12.5}
                fw={500}
                lh="normal"
                c="accent"
                className={classes.start}
                onClick={() => drawer.open(stage)}
                data-parity="more"
              >
                Open the full doc →
              </Anchor>
            </>
          ) : (
            <Skeleton height={60} />
          )}
        </Stack>
      ) : null}
    </div>
  );
}

function DecisionRow({ decision }: { decision: RunDecisionRow }) {
  const { label, value, meta } = decisionSentence(decision);
  return (
    <Stack
      gap={3}
      className={`${classes.rule} ${classes.decision}`}
      data-testid={`decision-row-${decision.contract}`}
    >
      <div className={classes.line}>
        <Text
          fz={13}
          lh="normal"
          c="dimmed"
          className={classes.key}
          data-parity="k"
        >
          {label}
        </Text>
        <Text fz={13} fw={500} lh="normal" data-parity="v">
          {value}
        </Text>
      </div>
      <Text fz={11.5} lh="normal" c="dimmed" data-parity="m">
        {meta}
      </Text>
    </Stack>
  );
}

function ConfigRow({ row }: { row: ConfigDepRow }) {
  const [open, setOpen] = useState(false);
  const inEffect = new Set(row.provenance.map(p => p.scope));
  const scope = row.provenance.at(-1)?.scope ?? null;
  const whereId = useId();
  return (
    <div
      className={`${classes.rule} ${classes.row}`}
      data-open={open || undefined}
      data-parity={`row ${row.key}`}
      data-testid={`config-row-${row.key}`}
    >
      <UnstyledButton
        className={classes.head}
        aria-expanded={open}
        aria-controls={open ? whereId : undefined}
        onClick={() => setOpen(o => !o)}
      >
        <Text
          ff="monospace"
          fz={12}
          lh="normal"
          className={classes.key}
          data-parity="k"
        >
          {row.key}
        </Text>
        <Text fz={13} lh="normal" c="dimmed" truncate data-parity="v">
          {'value' in row ? settingValue(row.value) : 'unset'}
        </Text>
        <Spacer />
        {scope ? <Pill label={scope} tone="quiet" /> : null}
        <Icon
          name={open ? 'chevronDown' : 'chevronRight'}
          size={14}
          className={classes.chev}
          data-parity="go"
        />
      </UnstyledButton>
      {open ? (
        <Stack
          gap={6}
          className={classes.where}
          id={whereId}
          data-parity="where"
        >
          {row.description ? (
            <Text fz={12.5} lh="normal" c="dimmed" data-parity="d">
              {row.description}
            </Text>
          ) : null}
          {[...(row.layers ?? [])].reverse().map(layer => {
            const live = inEffect.has(layer.scope);
            return (
              <div
                key={layer.scope}
                className={classes.scope}
                data-parity={`scope ${layer.scope}`}
                data-testid={`scope-${layer.scope}`}
              >
                <Text
                  fz={12}
                  fw={live ? 500 : 400}
                  lh="normal"
                  c={live ? undefined : 'dimmed'}
                  className={classes.scopeName}
                  data-parity="s"
                >
                  {layer.scope}
                </Text>
                <Text
                  ff="monospace"
                  fz={11.5}
                  lh="normal"
                  c={live ? undefined : 'dimmed'}
                  truncate
                  data-parity="v"
                >
                  {'value' in layer ? settingValue(layer.value) : 'not set'}
                </Text>
                {live ? (
                  <Text
                    fz={11.5}
                    fw={500}
                    lh="normal"
                    c="ok"
                    className={classes.push}
                    data-parity="w"
                  >
                    in effect
                  </Text>
                ) : null}
              </div>
            );
          })}
          <Anchor
            component={Link}
            href={`/settings?explain=${encodeURIComponent(row.key)}`}
            fz={12.5}
            fw={500}
            lh="normal"
            c="accent"
            className={classes.start}
            data-parity="open"
          >
            Change it in Settings →
          </Anchor>
        </Stack>
      ) : null}
    </div>
  );
}

export interface EffectiveInputsProps {
  repo: string;
  runId: string;
  decisions: RunDecisionRow[];
  /** Says what the panel is, where no drawer header says it already. */
  intro?: boolean;
}

/**
 * What this run was told, joined from three sources rt never joins itself:
 * the run row, the pack roster, and the pack repo at the sha the run
 * recorded. A plain `useQuery` (not suspense) on purpose: a join across
 * three sources is more likely to fail than any single-source panel.
 */
export function EffectiveInputs({
  repo,
  runId,
  decisions,
  intro = false,
}: EffectiveInputsProps) {
  const query = useEffectiveInputs(repo, runId);

  return (
    <Stack gap={22} data-testid="effective-inputs">
      {intro ? (
        <Text fz={13} lh="normal" c="dimmed">
          {INPUTS_SUB}
        </Text>
      ) : null}
      {query.isPending && (
        <Skeleton height={160} data-testid="effective-inputs-loading" />
      )}
      {query.isError && (
        <Text fz={13} lh="normal" c="bad" data-testid="effective-inputs-error">
          Could not load effective inputs: {(query.error as Error).message}
        </Text>
      )}
      {query.data && (
        <>
          <PacksSection payload={query.data} />
          <Section name="Stage docs">
            <Box>
              {query.data.stages.map(stage => (
                <StageDocRow
                  key={stage}
                  repo={repo}
                  runId={runId}
                  stage={stage}
                />
              ))}
            </Box>
          </Section>
          <Section name="Decisions in force">
            {decisions.length === 0 ? (
              <Text fz={12.5} lh="normal" c="dimmed">
                No decisions were recorded for this run.
              </Text>
            ) : (
              <Box>
                {decisions.map(decision => (
                  <DecisionRow
                    key={`${decision.contract}-${decision.decided_at}`}
                    decision={decision}
                  />
                ))}
              </Box>
            )}
          </Section>
          <Section name="Configuration (current values)">
            <Box>
              {query.data.config.map(row => (
                <ConfigRow key={row.key} row={row} />
              ))}
            </Box>
          </Section>
          <Text fz={12} lh="normal" c="dimmed" data-parity="foot">
            Runs don&apos;t record the config they read, so these are
            today&apos;s values.
          </Text>
        </>
      )}
    </Stack>
  );
}
