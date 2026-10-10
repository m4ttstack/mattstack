import { useState, type ReactNode } from 'react';
import {
  Accordion,
  Anchor,
  Badge,
  Paper,
  Skeleton,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import type { RunDecisionRow } from '@mattstack/rt-client';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';

import type {
  ConfigDepRow,
  EffectiveInputsPayload,
  PackVersionRow,
} from '../../server/effectiveInputs';
import { client } from '../api';
import accordion from './accordion.module.css';
import { decisionSentence, packState, settingValue } from './derive/inputs';
import classes from './EffectiveInputs.module.css';
import { Eyebrow } from './Eyebrow';
import {
  StageDocText,
  useStageDoc,
  useStageDocDrawer,
} from './run-page/StageDoc';
import { readApiError, retryOnce } from './useRuns';

export const INPUTS_SUB =
  'What this run was told, from the pack versions it recorded';

export function useEffectiveInputs(repo: string, runId: string) {
  return useQuery({
    queryKey: ['effective-inputs', repo, runId],
    queryFn: async () => {
      const res = await client.api.runs[':repo'][':runId'][
        'effective-inputs'
      ].$get({ param: { repo, runId } });
      if (!res.ok) throw await readApiError(res, 'effective inputs failed');
      const body = await res.json();
      return body as EffectiveInputsPayload;
    },
    retry: retryOnce,
  });
}

function Section({ name, children }: { name: string; children: ReactNode }) {
  return (
    <Stack gap={8}>
      <Eyebrow data-parity="h">{name}</Eyebrow>
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
      size="sm"
      variant={tone === 'quiet' ? 'panel-outline' : 'light'}
      color={tone === 'quiet' ? undefined : tone}
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
      <Text fz="lg" fw={500} lh="normal" data-parity="n">
        {pack.pack}
      </Text>
      <Text ff="monospace" fz="md" lh="normal" c="dimmed" data-parity="s">
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
        <Text fz="md" lh="normal" c="dimmed">
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
        <Text fz="md" lh="normal" c="dimmed">
          pack tree had uncommitted changes — the as-run text may exist in no
          commit
        </Text>
      )}
    </Section>
  );
}

/** Accordion's parts, through `classNames`: layout and spacing only. */
const ROW_CLASSES = {
  item: classes.item,
  control: classes.control,
  label: classes.head,
};

function StageDocRow({
  repo,
  runId,
  stage,
  open,
}: {
  repo: string;
  runId: string;
  stage: string;
  /** Whether the section's accordion has this row open. */
  open: boolean;
}) {
  const doc = useStageDoc(repo, runId, stage);
  const drawer = useStageDocDrawer();
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
    <Accordion.Item
      value={stage}
      data-parity={`doc ${stage}`}
      data-testid={`stage-row-${stage}`}
    >
      <Accordion.Control disabled={missing || doc.isError}>
        <Text
          span
          fz="lg"
          fw={expanded ? 500 : 400}
          lh="normal"
          data-parity="n"
        >
          {stage}
        </Text>{' '}
        <Spacer />
        <Text
          span
          fz="md"
          lh="normal"
          c="dimmed"
          data-parity={meta ? 'm' : undefined}
        >
          {meta}
        </Text>
      </Accordion.Control>
      <Accordion.Panel
        classNames={{ content: `${accordion.content} ${classes.body}` }}
      >
        <Stack gap={8}>
          {doc.data ? (
            <>
              <StageDocText text={doc.data.text} preview />
              <Anchor
                component="button"
                type="button"
                fz="md"
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
      </Accordion.Panel>
    </Accordion.Item>
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
          fz="lg"
          lh="normal"
          c="dimmed"
          className={classes.key}
          data-parity="k"
        >
          {label}
        </Text>
        <Text fz="lg" fw={500} lh="normal" data-parity="v">
          {value}
        </Text>
      </div>
      <Text fz="sm" lh="normal" c="dimmed" data-parity="m">
        {meta}
      </Text>
    </Stack>
  );
}

function ConfigRow({ row }: { row: ConfigDepRow }) {
  const inEffect = new Set(row.provenance.map(p => p.scope));
  const scope = row.provenance.at(-1)?.scope ?? null;
  return (
    <Accordion.Item
      value={row.key}
      data-parity={`row ${row.key}`}
      data-testid={`config-row-${row.key}`}
    >
      <Accordion.Control>
        <Text
          span
          ff="monospace"
          fz="md"
          lh="normal"
          className={classes.key}
          data-parity="k"
        >
          {row.key}
        </Text>{' '}
        <Text
          span
          fz="lg"
          lh="normal"
          c="dimmed"
          truncate
          className={classes.value}
          data-parity="v"
        >
          {'value' in row ? settingValue(row.value) : 'unset'}
        </Text>{' '}
        <Spacer />
        {scope ? <Pill label={scope} tone="quiet" /> : null}
      </Accordion.Control>
      <Accordion.Panel
        classNames={{ content: `${accordion.content} ${classes.where}` }}
      >
        <Stack gap={6} data-parity="where">
          {row.description ? (
            <Text fz="md" lh="normal" c="dimmed" data-parity="d">
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
                  fz="md"
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
                  fz="sm"
                  lh="normal"
                  c={live ? undefined : 'dimmed'}
                  truncate
                  data-parity="v"
                >
                  {'value' in layer ? settingValue(layer.value) : 'not set'}
                </Text>
                {live ? (
                  <Text
                    fz="sm"
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
            fz="md"
            fw={500}
            lh="normal"
            c="accent"
            className={classes.start}
            data-parity="open"
          >
            Change it in Settings →
          </Anchor>
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

export interface EffectiveInputsProps {
  repo: string;
  runId: string;
  decisions: RunDecisionRow[];
  /** Says what the panel is, where no drawer header says it already. */
  intro?: boolean;
  /** Sets the sections in two columns, on a page wide enough for them. */
  wide?: boolean;
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
  wide = false,
}: EffectiveInputsProps) {
  const query = useEffectiveInputs(repo, runId);
  const [openDocs, setOpenDocs] = useState<string[]>([]);

  return (
    <Stack gap={22} data-testid="effective-inputs">
      {intro ? (
        <Text fz="lg" lh="normal" c="dimmed">
          {INPUTS_SUB}
        </Text>
      ) : null}
      {query.isPending && (
        <Skeleton height={160} data-testid="effective-inputs-loading" />
      )}
      {query.isError && (
        <Text fz="lg" lh="normal" c="bad" data-testid="effective-inputs-error">
          Could not load effective inputs: {(query.error as Error).message}
        </Text>
      )}
      {query.data && (
        <div className={wide ? classes.split : classes.single}>
          <div className={classes.half}>
            <PacksSection payload={query.data} />
            <Section name="Stage docs">
              <Box>
                <Accordion
                  multiple
                  value={openDocs}
                  onChange={setOpenDocs}
                  keepMounted={false}
                  chevronPosition="left"
                  chevron={<Accordion.Chevron size={14} data-parity="chev" />}
                  classNames={{ ...ROW_CLASSES, chevron: classes.chev }}
                >
                  {query.data.stages.map(stage => (
                    <StageDocRow
                      key={stage}
                      repo={repo}
                      runId={runId}
                      stage={stage}
                      open={openDocs.includes(stage)}
                    />
                  ))}
                </Accordion>
              </Box>
            </Section>
          </div>
          <div className={classes.half}>
            <Section name="Decisions in force">
              {decisions.length === 0 ? (
                <Text fz="md" lh="normal" c="dimmed">
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
                <Accordion
                  multiple
                  keepMounted={false}
                  chevron={<Accordion.Chevron size={14} data-parity="go" />}
                  classNames={{ ...ROW_CLASSES, chevron: classes.chevEnd }}
                >
                  {query.data.config.map(row => (
                    <ConfigRow key={row.key} row={row} />
                  ))}
                </Accordion>
              </Box>
            </Section>
          </div>
        </div>
      )}
      {query.data && (
        <Text fz="md" lh="normal" c="dimmed" data-parity="foot">
          Runs don&apos;t record the config they read, so these are today&apos;s
          values.
        </Text>
      )}
    </Stack>
  );
}
