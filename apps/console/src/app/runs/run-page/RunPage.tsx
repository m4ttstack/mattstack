import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Stack } from '@mattstack/app-kit/core';
import type { GateRow } from '@mattstack/rt-client';
import { useSearch } from 'wouter';

import { gateStage } from '../derive/gates';
import { heroLiveness } from '../derive/liveness';
import { heldSpans } from '../derive/run';
import { railStages, stageAttempts } from '../derive/stages';
import { GatePanels, typingTarget } from './GatePanel';
import { HandoffCard } from './HandoffCard';
import { InputsDrawer } from './InputsDrawer';
import { NowCard } from './NowCard';
import { RunHeader } from './RunHeader';
import classes from './RunPage.module.css';
import { SideCards } from './SideCards';
import { RunStory } from './Story';
import { usePruneGateDrafts } from './useGateDraft';
import { useRunParts, type RunPageData } from './useRunParts';

export type { RunPageData } from './useRunParts';

/** The gate the URL names, as `?gate=<id>` or `#gate-<id>`. */
function linkedGate(search: string): string | null {
  const fromQuery = new URLSearchParams(search).get('gate');
  const fromHash = /^#gate-(.+)$/.exec(location.hash)?.[1];
  return fromQuery ?? (fromHash ? decodeURIComponent(fromHash) : null);
}

/** Scrolls a gate in the page into view when the URL names it, as
    `?gate=<id>` (stripped once it lands) or `#gate-<id>`, and leaves focus in
    its panel so the number keys answer at once. An answered gate is a
    decision in the story, which opens its stage for it. With no gate named, the
    first panel the user owns takes focus the first time one shows, unless
    they are typing somewhere; a shepherd's gate never takes the keys
    unasked. A gate the queries have not caught up with yet waits
    for the next gates update. Returns the linked gate until the next click
    or key, once per link. */
function useGateDeepLink(gates: GateRow[]): string | null {
  const search = useSearch();
  const consumed = useRef<string | null>(null);
  const focusedFirst = useRef(false);
  const fromUrl = linkedGate(search);
  const [linked, setLinked] = useState(fromUrl);
  const [seenUrl, setSeenUrl] = useState(fromUrl);
  if (fromUrl !== seenUrl) {
    setSeenUrl(fromUrl);
    if (fromUrl) setLinked(fromUrl);
  }
  useEffect(() => {
    if (!linked) return;
    const clear = () => setLinked(null);
    window.addEventListener('pointerdown', clear, true);
    window.addEventListener('keydown', clear, true);
    return () => {
      window.removeEventListener('pointerdown', clear, true);
      window.removeEventListener('keydown', clear, true);
    };
  }, [linked]);
  useEffect(() => {
    const fromQuery = new URLSearchParams(search).get('gate');
    const id = linkedGate(search);
    if (!id) {
      if (focusedFirst.current) return;
      const first = document.querySelector<HTMLElement>(
        '[data-testid="gate-panel"][data-tone="mine"]'
      );
      if (!first) return;
      focusedFirst.current = true;
      const active = document.activeElement;
      if (!active || !typingTarget(active)) {
        first.focus({ preventScroll: true });
      }
      return;
    }
    if (consumed.current === id) return;
    const el = document.querySelector(`[data-gate-id="${CSS.escape(id)}"]`);
    if (!el) return;
    consumed.current = id;
    focusedFirst.current = true;
    el.scrollIntoView({ block: 'center' });
    if (el instanceof HTMLElement && el.hasAttribute('tabindex')) {
      el.focus({ preventScroll: true });
    }
    if (fromQuery) {
      const params = new URLSearchParams(search);
      params.delete('gate');
      const qs = params.toString();
      history.replaceState(
        null,
        '',
        location.pathname + (qs ? `?${qs}` : '') + location.hash
      );
    }
  }, [search, gates]);
  return linked;
}

/** The run page while a run is live: header and rail, what it is doing now
    or the gate it waits on, the story so far, and the side cards. */
export function RunPage({
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
  const { now, kind, gates, facts, story, drawer, pathHref } = parts;
  const linkedGateId = useGateDeepLink(gates);
  usePruneGateDrafts(gates);
  const { live, answerable, handoff, mine } = facts;

  const rail =
    kind === 'work'
      ? railStages(
          fields.find(f => f.key === 'pipeline-stages')?.value ?? null,
          stageAttempts(stages, run, now),
          heldSpans(stages, decisions),
          mine ? gateStage(mine, stages) : null,
          now
        )
      : null;

  const gatePanels =
    answerable.length > 0 ? (
      <GatePanels
        gates={answerable}
        stageOf={g => gateStage(g, stages)}
        now={now}
      />
    ) : null;
  let slot: ReactNode = null;
  if (!gatePanels && handoff) {
    slot = (
      <div id={`gate-${handoff.id}`} className={classes.slot}>
        <HandoffCard
          gate={handoff}
          boardUrl={data.boardUrl ?? null}
          now={now}
        />
      </div>
    );
  } else if (!gatePanels && kind === 'work' && story?.current) {
    slot = (
      <NowCard
        label={story.currentLabel ?? story.current.stage}
        startedAt={story.current.startedAt}
        lastEventAt={run.last_event_at}
        now={now}
        fields={story.currentFields}
        pathHref={pathHref}
      />
    );
  }

  return (
    <Stack gap={20} data-testid="run-page">
      <RunHeader
        repo={repo}
        runId={runId}
        ticket={facts.hero.ticket}
        ticketUrl={facts.hero.ticketUrl}
        meta={facts.hero.meta}
        title={parts.title}
        liveness={heroLiveness(run, { handoff, mine }, now)}
        rail={rail}
        finished={!live}
        focusPane={
          run.agent && run.agent.status !== 'done' ? run.agent.pane : null
        }
        canResume={facts.canResume}
        canAbandon={run.attention.needs && run.attention.reason === 'stale'}
        onViewInputs={drawer.open}
      />
      <div className={classes.columns}>
        <Stack gap={14} className={classes.story} data-parity="Story">
          {gatePanels ?? slot}
          <RunStory
            repo={repo}
            runId={runId}
            label={kind === 'utility' ? run.work_type : kind}
            story={story}
            block={parts.block}
            evidenceField={parts.evidenceField}
            pathHref={pathHref}
            linkedGateId={linkedGateId}
          />
        </Stack>
        <SideCards
          facts={parts.factRows}
          inputs={parts.sideInputs}
          onViewInputs={drawer.open}
        />
      </div>
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
