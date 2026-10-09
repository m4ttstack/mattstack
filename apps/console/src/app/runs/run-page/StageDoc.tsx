import { useState } from 'react';
import { Anchor, Code, Modal, Skeleton, Text } from '@mattstack/app-kit/core';
import { useQuery } from '@tanstack/react-query';

import { client } from '../../api';

type StageDocResult = { text: string } | { error: string };

function StageDocBody({
  repo,
  runId,
  stage,
}: {
  repo: string;
  runId: string;
  stage: string;
}) {
  const query = useQuery({
    queryKey: ['stage-doc', repo, runId, stage],
    queryFn: async () => {
      const res = await client.api.runs[':repo'][':runId']['stage-doc'].$get({
        param: { repo, runId },
        query: { stage },
      });
      return (await res.json()) as StageDocResult;
    },
  });
  if (query.isPending) return <Skeleton height={200} />;
  if (query.isError)
    return (
      <Text size="sm" c="dimmed">
        {(query.error as Error).message}
      </Text>
    );
  if ('error' in query.data)
    return (
      <Text size="sm" c="dimmed" data-testid="stage-doc-no-doc">
        {query.data.error}
      </Text>
    );
  return <Code block>{query.data.text}</Code>;
}

/** The "stage doc" link of a story section: the compiled stage doc the run
    read, in a modal. */
export function StageDocLink({
  repo,
  runId,
  stage,
}: {
  repo: string;
  runId: string;
  stage: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Anchor
        component="button"
        type="button"
        fz={12}
        lh="normal"
        c="dimmed"
        onClick={() => setOpen(true)}
        aria-label={`stage doc for ${stage}`}
        data-parity="stage doc"
      >
        stage doc
      </Anchor>
      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title={stage}
        size="xl"
      >
        {open ? <StageDocBody repo={repo} runId={runId} stage={stage} /> : null}
      </Modal>
    </>
  );
}
