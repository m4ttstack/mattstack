import { Stack, Text } from '@mattstack/app-kit/core';
import type { RunFieldRow } from '@mattstack/rt-client';

import type { StoryEntry } from '../derive/story';
import { StorySection } from './StorySection';

export interface StoryProps {
  repo: string;
  runId: string;
  /** "Story so far" over a work run's attempts; the run's kind over a
      one-stage run's block. */
  label: string;
  entries: StoryEntry[];
  evidenceField: RunFieldRow | null;
  pathHref?: (path: string) => string | null;
  /** A one-stage run's single block, which draws no line below it. */
  block?: boolean;
}

/** The run's attempts so far, oldest first. */
export function Story({
  repo,
  runId,
  label,
  entries,
  evidenceField,
  pathHref,
  block = false,
}: StoryProps) {
  if (entries.length === 0) return null;
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
      <Stack gap={0} w="100%" data-testid="story" data-parity="Story list">
        {entries.map(entry => (
          <StorySection
            key={entry.key}
            repo={repo}
            runId={runId}
            entry={entry}
            evidenceField={evidenceField}
            pathHref={pathHref}
            last={block}
          />
        ))}
      </Stack>
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
}) {
  if (story)
    return (
      <Story
        repo={repo}
        runId={runId}
        label={storyLabel}
        entries={story.entries}
        evidenceField={evidenceField}
        pathHref={pathHref}
      />
    );
  if (block)
    return (
      <Story
        repo={repo}
        runId={runId}
        label={label}
        entries={[block]}
        evidenceField={evidenceField}
        pathHref={pathHref}
        block
      />
    );
  return null;
}
