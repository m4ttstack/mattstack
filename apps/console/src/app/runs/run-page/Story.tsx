import { useState } from 'react';
import { Paper } from '@mattstack/app-kit/core';
import type { RunFieldRow } from '@mattstack/rt-client';

import type { StoryEntry } from '../derive/story';
import { Eyebrow } from '../Eyebrow';
import { StageNavItem, StagePane } from './StageRow';
import classes from './Story.module.css';

export interface StoryProps {
  repo: string;
  runId: string;
  /** "Story so far" over a work run's attempts; the run's kind over a
      one-stage run's block. */
  label: string;
  entries: StoryEntry[];
  evidenceField: RunFieldRow | null;
  pathHref?: (path: string) => string | null;
  /** The gate a deep link names: its stage and its decision open, and the
      decision rings until the next click or key. */
  linkedGateId?: string | null;
  ticket?: string | null;
}

const keyOfGate = (entries: StoryEntry[], gateId: string | null) =>
  gateId
    ? (entries.find(e => e.gates.some(g => g.id === gateId))?.key ?? null)
    : null;

/** The stage a story opens on: its newest finished attempt, or its newest
    attempt when none has finished yet. */
const startingKey = (entries: StoryEntry[]) =>
  (entries.findLast(e => e.attempt.status !== 'running') ?? entries.at(-1))
    ?.key ?? null;

/** The run's attempts so far: a list of them on the left, oldest first, and
    the picked one in full beside it. The story starts on its newest finished
    attempt; a deep link picks the attempt holding its gate. */
export function Story({
  repo,
  runId,
  label,
  entries,
  evidenceField,
  pathHref,
  linkedGateId = null,
  ticket = null,
}: StoryProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const [seenLink, setSeenLink] = useState<string | null>(null);
  const linked = keyOfGate(entries, linkedGateId);
  if (linked && linkedGateId !== seenLink) {
    setSeenLink(linkedGateId);
    setPicked(linked);
  }

  if (entries.length === 0) return null;
  const shown =
    entries.find(e => e.key === picked) ??
    entries.find(e => e.key === startingKey(entries))!;
  const pane = (
    <StagePane
      entry={shown}
      repo={repo}
      runId={runId}
      evidenceField={evidenceField}
      pathHref={pathHref}
      linkedGateId={linkedGateId}
      ticket={ticket}
    />
  );

  return (
    <>
      <Eyebrow data-parity="Story label">{label}</Eyebrow>
      <Paper
        variant="ground"
        withBorder
        radius={12}
        className={classes.list}
        data-testid="story"
        data-parity="Story list"
      >
        {entries.length > 1 ? (
          <div className={classes.split}>
            <nav aria-label="Stages" className={classes.stages}>
              {entries.map(entry => (
                <StageNavItem
                  key={entry.key}
                  entry={entry}
                  evidenceField={evidenceField}
                  active={entry.key === shown.key}
                  onPick={() => setPicked(entry.key)}
                />
              ))}
            </nav>
            <div className={classes.pane}>{pane}</div>
          </div>
        ) : (
          <div className={classes.pane}>
            <StagePane
              entry={shown}
              repo={repo}
              runId={runId}
              evidenceField={evidenceField}
              pathHref={pathHref}
              linkedGateId={linkedGateId}
              ticket={ticket}
              heading
            />
          </div>
        )}
      </Paper>
    </>
  );
}

/** A work run's story, or a one-stage run's single block under its kind. */
export function RunStory({
  repo,
  runId,
  label,
  storyLabel = 'Story so far',
  story,
  block,
  evidenceField,
  pathHref,
  linkedGateId,
  ticket,
}: {
  repo: string;
  runId: string;
  /** The block's label: the run's kind, or the work type of a utility run. */
  label: string;
  /** The work run's label: "Story so far" live, "Story" on the record. */
  storyLabel?: string;
  story: { entries: StoryEntry[] } | null;
  block: StoryEntry | null;
  evidenceField: RunFieldRow | null;
  pathHref?: (path: string) => string | null;
  linkedGateId?: string | null;
  ticket?: string | null;
}) {
  const entries = story ? story.entries : block ? [block] : [];
  return (
    <Story
      repo={repo}
      runId={runId}
      label={story ? storyLabel : label}
      entries={entries}
      evidenceField={evidenceField}
      pathHref={pathHref}
      linkedGateId={linkedGateId}
      ticket={ticket}
    />
  );
}
