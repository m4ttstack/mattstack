import { useMemo, useState, type ReactNode } from 'react';
import { Badge, Group, Kbd, Text } from '@mattstack/app-kit/core';
import { Icon, type IconName } from '@mattstack/app-kit/icons';
import { Spotlight } from '@mattstack/app-kit/spotlight';
import type { RunSummary } from '@mattstack/rt-client';
import { navigate } from 'wouter/use-browser-location';

import { nowOf } from '../runs/derive/clock';
import { runDetailKey } from '../runs/derive/day';
import { waitingOnMe } from '../runs/derive/lanes';
import { runHref, ticketOf } from '../runs/runs-page/runLinks';
import { useLinkedGates } from '../runs/runs-page/useLinkedGates';
import { matchRun, parseQuery } from '../runs/search';
import { useRunList } from '../runs/useRuns';
import { useRunTitles } from '../runs/useRunTitles';
import classes from './ConsolePalette.module.css';
import { paletteStatus } from './paletteStatus';

/** wouter's `navigate` pushes a history entry even when `to` is the current
    URL; the palette can select the page you are already on, so this guards
    the no-op to avoid a dead back-button entry (the retired router did the
    same). */
function go(to: string) {
  const current =
    window.location.pathname + window.location.search + window.location.hash;
  if (to !== current) navigate(to);
}

const RESULT_LIMIT = 10;
const NO_RUNS: RunSummary[] = [];

function Section({ children }: { children: string }) {
  return (
    <div className={classes.section}>
      <Text
        fz={10.5}
        fw={500}
        lh="normal"
        tt="uppercase"
        lts={0.8}
        c="dimmed"
        data-parity="t"
      >
        {children}
      </Text>
    </div>
  );
}

function GoTo({
  icon,
  onClick,
  children,
}: {
  icon: IconName;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Spotlight.Action
      variant="wash"
      className={classes.action}
      onClick={onClick}
    >
      <Group gap={10} wrap="nowrap">
        <Icon name={icon} size={14} color="var(--tk-text-3)" data-parity="i" />
        <Text fz={13} lh="normal" data-parity="l">
          {children}
        </Text>
      </Group>
    </Spotlight.Action>
  );
}

/**
 * One global instance, mounted once in App -- Spotlight owns its own portal
 * and keyboard shortcut, so a second instance would fight the first over the
 * same `mod+K`.
 */
export function ConsolePalette() {
  const runsQuery = useRunList();
  const [query, setQuery] = useState('');
  const q = query.trim();
  const typing = q !== '';
  const gates = useLinkedGates({ enabled: typing }).all;
  const now = nowOf(runsQuery.data);

  const allRuns = useMemo(
    () => (runsQuery.data?.runs ?? []) as RunSummary[],
    [runsQuery.data]
  );
  const runs = useMemo(() => {
    const terms = parseQuery(q);
    if (terms.length === 0) return [];
    return allRuns
      .filter(run => matchRun(run, terms))
      .sort((a, b) => b.started_at - a.started_at)
      .slice(0, RESULT_LIMIT);
  }, [allRuns, q]);
  // Every run, so typing keeps one cached enrich read (the runs page's).
  const titleOf = useRunTitles(typing ? allRuns : NO_RUNS);
  const onYou = useMemo(
    () =>
      new Set(waitingOnMe(allRuns, gates, now).map(b => runDetailKey(b.run))),
    [allRuns, gates, now]
  );

  return (
    <Spotlight.Root
      query={query}
      onQueryChange={setQuery}
      shortcut="mod + K"
      size={520}
      classNames={{ content: classes.content, actionsList: classes.list }}
      attributes={{ content: { 'data-parity': 'palette' } }}
    >
      <Spotlight.Search
        placeholder="Search runs, or jump to a page…"
        leftSection={<Icon name="search" size={16} />}
        data-parity="input"
      />
      {q ? (
        <Spotlight.ActionsList>
          {runs.length > 0 ? (
            <>
              <Section>Runs</Section>
              {runs.map(run => {
                const ticket = ticketOf(run);
                const status = paletteStatus(run, onYou);
                return (
                  <Spotlight.Action
                    key={`${run.repo}/${run.id}`}
                    variant="wash"
                    className={classes.action}
                    onClick={() => go(runHref(run))}
                    data-parity="item"
                    data-testid={`palette-run-${run.id}`}
                  >
                    <Group gap={10} wrap="nowrap" className={classes.row}>
                      {ticket ? (
                        <Text
                          fz={13}
                          fw={700}
                          lh="normal"
                          c="accent"
                          className={classes.keep}
                          data-parity="tk"
                        >
                          {ticket}
                        </Text>
                      ) : null}
                      <Text
                        fz={13}
                        lh="normal"
                        truncate
                        className={classes.title}
                        data-parity="ti"
                      >
                        {titleOf(run)}
                      </Text>
                      <Badge
                        size="sm"
                        color={status.color}
                        className={classes.keep}
                        data-parity="pill"
                      >
                        <span data-parity="l">{status.label}</span>
                      </Badge>
                      <Kbd className={classes.keep} data-parity="enter">
                        <span data-parity="k">↵</span>
                      </Kbd>
                    </Group>
                  </Spotlight.Action>
                );
              })}
            </>
          ) : null}
          <Section>Go to</Section>
          <GoTo icon="layers" onClick={() => go('/')}>
            Runs
          </GoTo>
          <GoTo
            icon="search"
            onClick={() => go(`/search?q=${encodeURIComponent(q)}`)}
          >
            {`Search runs for “${q}”`}
          </GoTo>
        </Spotlight.ActionsList>
      ) : null}
      <Spotlight.Footer className={classes.footer} data-parity="foot">
        {['↑↓ move', '↵ open', 'esc close'].map(key => (
          <Text key={key} fz={11.5} lh="normal" c="dimmed" data-parity="k">
            {key}
          </Text>
        ))}
      </Spotlight.Footer>
    </Spotlight.Root>
  );
}
