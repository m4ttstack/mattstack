import { useState } from 'react';
import { Badge, Stack, Tabs, Text } from '@mattstack/app-kit/core';
import { parseEvidence } from '@mattstack/rt-client/evidence';

import {
  abandonedLine,
  answeredQuestionCount,
  decisionStages,
  defaultRecordTab,
  hasSettledGates,
  recordEnd,
  recordSpan,
  recordStats,
  type RecordTab,
} from '../derive/record';
import { EffectiveInputs } from '../EffectiveInputs';
import { DecisionsTab } from './DecisionsTab';
import { EvidenceCard } from './EvidenceCard';
import { InputsDrawer } from './InputsDrawer';
import { RecordHeader } from './RecordHeader';
import classesPage from './RunPage.module.css';
import { SideCards } from './SideCards';
import { RunStory } from './Story';
import { useRunParts, type RunPageData } from './useRunParts';

const TAB_LABEL: Record<RecordTab, string> = {
  story: 'Story',
  decisions: 'Decisions',
  evidence: 'Evidence',
  inputs: 'Inputs',
};

function TabCount({ count, active }: { count: number; active: boolean }) {
  return (
    <Badge
      size="sm"
      variant="light"
      color={active ? 'accent' : 'gray'}
      data-parity="count"
    >
      <span data-parity="n">{count}</span>
    </Badge>
  );
}

/** A finished run: what it was and how it ended, then its story, every
    decision with the evidence beside it, and the inputs it ran on. */
export function RecordPage({
  repo,
  runId,
  data,
}: {
  repo: string;
  runId: string;
  data: RunPageData;
}) {
  const { run, stages, fields, decisions } = data;
  const parts = useRunParts(repo, runId, data);
  const { now, kind, gates, facts, drawer } = parts;
  const [tab, setTab] = useState<RecordTab | null>(null);
  const shown = tab ?? defaultRecordTab(gates);

  const end = recordEnd(run, now);
  const meta = `${run.pipeline} pipeline · ${recordSpan(run.started_at, end.at)}`;
  const stats = recordStats({ run, gates, now });
  const groups = decisionStages(
    gates,
    stages,
    run,
    now,
    fields.find(f => f.key === 'pipeline-stages')?.value ?? null
  );
  const answered = answeredQuestionCount(gates);
  const withDecisions = hasSettledGates(gates);
  const evidenceValue = parts.evidenceField?.value;
  const evidence =
    kind === 'work' ? parseEvidence(evidenceValue ?? undefined) : null;
  const hasEvidence = evidence != null && evidence.version !== null;
  const mrIid =
    run.outcome?.mr && run.outcome.mr.state !== 'unknown'
      ? String(run.outcome.mr.iid)
      : null;
  const evidenceColumn =
    evidence && hasEvidence ? (
      <EvidenceCard
        repo={repo}
        runId={runId}
        evidence={evidence}
        variant="record"
        mrIid={mrIid}
        pathHref={parts.pathHref}
      />
    ) : null;

  const tabs: RecordTab[] = [
    'story',
    ...(withDecisions ? (['decisions'] as const) : []),
    ...(kind === 'work' ? (['evidence'] as const) : []),
    'inputs',
  ];
  const counts: Partial<Record<RecordTab, number>> = {
    decisions: answered || undefined,
    evidence:
      evidence?.version === 1
        ? evidence.images.length || undefined
        : evidence?.version === 0
          ? evidence.links.length || undefined
          : undefined,
  };

  return (
    <Stack gap={20} data-testid="run-record">
      <RecordHeader
        ticket={facts.hero.ticket}
        ticketUrl={facts.hero.ticketUrl}
        meta={meta}
        title={parts.title}
        outcome={run.outcome}
        stats={stats}
        abandoned={abandonedLine(run, fields)}
      />
      <Tabs
        value={shown}
        onChange={v => v && setTab(v as RecordTab)}
        keepMounted={false}
      >
        <Stack gap={20}>
          <Tabs.List data-parity="Tabs">
            {tabs.map(t => (
              <Tabs.Tab
                key={t}
                value={t}
                rightSection={
                  counts[t] != null ? (
                    <TabCount count={counts[t]} active={t === shown} />
                  ) : null
                }
                data-parity={t === shown ? `tab ${TAB_LABEL[t]}` : undefined}
              >
                <span data-parity="label">{TAB_LABEL[t]}</span>
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <Tabs.Panel value="story">
            <div className={classesPage.columns}>
              <Stack gap={14} className={classesPage.story}>
                <RunStory
                  repo={repo}
                  runId={runId}
                  label={kind === 'utility' ? run.work_type : kind}
                  storyLabel="Story"
                  story={parts.story}
                  block={parts.block}
                  evidenceField={parts.evidenceField}
                  pathHref={parts.pathHref}
                />
                {!parts.story?.entries.length && !parts.block ? (
                  <Text fz={13} lh="normal" c="dimmed">
                    This run recorded nothing to tell.
                  </Text>
                ) : null}
              </Stack>
              <SideCards
                facts={parts.factRows}
                inputs={parts.sideInputs}
                onViewInputs={drawer.open}
              />
            </div>
          </Tabs.Panel>
          {withDecisions ? (
            <Tabs.Panel value="decisions">
              <DecisionsTab
                groups={groups}
                byStage={kind === 'work'}
                evidence={evidenceColumn}
              />
            </Tabs.Panel>
          ) : null}
          {kind === 'work' ? (
            <Tabs.Panel value="evidence">
              {evidenceColumn ?? (
                <Text fz={13} lh="normal" c="dimmed">
                  This run recorded no evidence.
                </Text>
              )}
            </Tabs.Panel>
          ) : null}
          <Tabs.Panel value="inputs">
            <EffectiveInputs repo={repo} runId={runId} decisions={decisions} />
          </Tabs.Panel>
        </Stack>
      </Tabs>
      <InputsDrawer
        repo={repo}
        runId={runId}
        decisions={decisions}
        opened={drawer.opened}
        onClose={drawer.close}
      />
    </Stack>
  );
}
