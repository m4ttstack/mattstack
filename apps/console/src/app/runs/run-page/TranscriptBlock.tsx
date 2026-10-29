import { Code, Spoiler, Text } from '@mattstack/app-kit/core';
import { useQuery } from '@tanstack/react-query';

import { StepLoader, useStepLoading } from '../../StepLoader';
import { GateContext } from '../GateContext';
import { transcriptUrl } from './evidenceImages';

/** About 40 lines of the block's monospace text. */
const PREVIEW_HEIGHT = 680;

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
  const res = await fetch(transcriptUrl(repo, runId));
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
    monospace block whose first 40 lines or so show until it is opened. */
export function TranscriptBlock({ repo, runId }: TranscriptBlockProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['evidence-transcript', repo, runId],
    queryFn: () => fetchTranscript(repo, runId),
    retry: false,
  });

  const { show: held, bind: heldBind } = useStepLoading(isPending);
  if (isPending || held) {
    return <StepLoader {...heldBind} steps={['reading the transcript']} />;
  }
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
        <GateContext text={data.text} fill />
      </div>
    );
  }

  const lines = data.text.replace(/\n$/, '').split('\n');
  return (
    <Spoiler
      maxHeight={PREVIEW_HEIGHT}
      showLabel={`show all ${lines.length} lines`}
      hideLabel="show fewer lines"
      data-parity="Transcript"
      data-transcript="plain"
    >
      <Code block>{lines.join('\n')}</Code>
    </Spoiler>
  );
}
