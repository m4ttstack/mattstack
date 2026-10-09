import { useState } from 'react';
import { Paper, Text } from '@mattstack/app-kit/core';
import type { RunFieldRow } from '@mattstack/rt-client';

import type { StoryEntry } from '../derive/story';
import { StageRow } from './StageRow';
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

/** The run's attempts so far, oldest first, as one list of stage rows. The
    newest starts opened; the rest start folded. */
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
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(
    () => new Map()
  );
  const [seenLink, setSeenLink] = useState<string | null>(null);
  const linked = keyOfGate(entries, linkedGateId);
  if (linked && linkedGateId !== seenLink) {
    setSeenLink(linkedGateId);
    setOverrides(new Map(overrides).set(linked, true));
  }

  if (entries.length === 0) return null;
  const newest = entries.at(-1)!.key;
  const isOpen = (key: string) => overrides.get(key) ?? key === newest;
  const toggle = (key: string) =>
    setOverrides(prev =>
      new Map(prev).set(key, !(prev.get(key) ?? key === newest))
    );

  return (
    <>
      <Text
        fz={10.5}
        fw={500}
        lh="normal"
        tt="uppercase"
        lts={0.8}
        c="dimmed"
        data-parity="Story label"
      >
        {label}
      </Text>
      <Paper
        variant="ground"
        withBorder
        radius={12}
        className={classes.list}
        data-testid="story"
        data-parity="Story list"
      >
        {entries.map(entry => (
          <StageRow
            key={entry.key}
            entry={entry}
            open={isOpen(entry.key)}
            onToggle={() => toggle(entry.key)}
            repo={repo}
            runId={runId}
            evidenceField={evidenceField}
            pathHref={pathHref}
            linkedGateId={linkedGateId}
            ticket={ticket}
          />
        ))}
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
