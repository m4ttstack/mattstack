import { useState } from 'react';
import { Button, Code, Skeleton, Stack, Text } from '@mattstack/app-kit/core';
import { useQuery } from '@tanstack/react-query';

import { GateContext } from '../GateContext';
import { evidenceUrl } from './evidenceImages';
import classes from './TranscriptBlock.module.css';

const PREVIEW_LINES = 40;

interface Transcript {
  text: string;
  markdown: boolean;
}

/** `null` is a 404: the run has no readable transcript, which is not an
    error worth drawing. */
async function fetchTranscript(
  repo: string,
  runId: string
): Promise<Transcript | null> {
  const res = await fetch(evidenceUrl(repo, runId, 'transcript'));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`transcript failed: ${res.status}`);
  return {
    text: await res.text(),
    markdown: (res.headers.get('content-type') ?? '').startsWith(
      'text/markdown'
    ),
  };
}

export interface TranscriptBlockProps {
  repo: string;
  runId: string;
}

/** The evidence transcript: a `.md` file as markdown, anything else as a
    monospace block of its first 40 lines. */
export function TranscriptBlock({ repo, runId }: TranscriptBlockProps) {
  const [all, setAll] = useState(false);
  const { data, isPending, isError } = useQuery({
    queryKey: ['evidence-transcript', repo, runId],
    queryFn: () => fetchTranscript(repo, runId),
    retry: false,
  });

  if (isPending) return <Skeleton height={64} radius="md" />;
  if (isError) {
    return (
      <Text size="sm" c="dimmed">
        transcript unavailable
      </Text>
    );
  }
  if (!data) return null;

  if (data.markdown) {
    return (
      <div data-parity="Transcript" data-transcript="markdown">
        <GateContext text={data.text} />
      </div>
    );
  }

  const lines = data.text.replace(/\n$/, '').split('\n');
  const clipped = !all && lines.length > PREVIEW_LINES;
  return (
    <Stack gap="xs" data-parity="Transcript" data-transcript="plain">
      <Code block>
        {(clipped ? lines.slice(0, PREVIEW_LINES) : lines).join('\n')}
      </Code>
      {clipped && (
        <Button
          variant="subtle"
          size="compact-sm"
          className={classes.more}
          onClick={() => setAll(true)}
        >
          show all {lines.length} lines
        </Button>
      )}
    </Stack>
  );
}
