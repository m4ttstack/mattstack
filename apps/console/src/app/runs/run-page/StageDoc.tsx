import { useCallback } from 'react';
import {
  Anchor,
  Drawer,
  List,
  Skeleton,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useQuery } from '@tanstack/react-query';
import type { Components } from 'react-markdown';

import { client } from '../../api';
import { docPreview, packState, stageDocBody } from '../derive/inputs';
import { useEffectiveInputs } from '../EffectiveInputs';
import { GateContext } from '../GateContext';
import { ApiError, readApiError, retryOnce } from '../useRuns';
import { DOC_PARAM, useDrawerParams } from './drawerParams';
import drawer from './InputsDrawer.module.css';
import classes from './StageDoc.module.css';

/** The doc the stage-doc route found. A design fixture may leave out where
    it came from. */
export interface StageDocHit {
  text: string;
  pack?: string;
  sha?: string;
}

/** A stage's compiled doc, or null when nothing resolves at the recorded
    version (the route's 404). */
export function useStageDoc(repo: string, runId: string, stage: string | null) {
  return useQuery({
    queryKey: ['stage-doc', repo, runId, stage],
    queryFn: async (): Promise<StageDocHit | null> => {
      const res = await client.api.runs[':repo'][':runId']['stage-doc'].$get({
        param: { repo, runId },
        query: { stage: stage ?? '' },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw await readApiError(res, 'stage doc failed');
      const body = (await res.json()) as StageDocHit | { error?: string };
      if (!('text' in body))
        throw new ApiError(res.status, `stage doc failed: ${res.status}`);
      return body;
    },
    enabled: stage !== null,
    retry: retryOnce,
  });
}

/** The one open stage doc, kept in the URL as `?doc=<stage>`. It takes the
    inputs drawer's place while open, and closing it brings that back when
    the doc was opened from there. */
export function useStageDocDrawer() {
  const { doc, write } = useDrawerParams();
  return {
    stage: doc,
    open: useCallback(
      (stage: string) => write(params => params.set(DOC_PARAM, stage)),
      [write]
    ),
    close: useCallback(
      () => write(params => params.delete(DOC_PARAM)),
      [write]
    ),
  };
}

const bulleted: Components['ul'] = ({ children }) => (
  <List
    spacing={8}
    fz="inherit"
    c="dimmed"
    icon={
      <Text span c="dimmed" data-parity="b" aria-hidden>
        •
      </Text>
    }
    className={classes.list}
  >
    {children}
  </List>
);

const FULL: Components = {
  h1: ({ children }) => <h1 data-parity="h1">{children}</h1>,
  h2: ({ children }) => <h2 data-parity="h2">{children}</h2>,
  p: ({ children }) => <p data-parity="p">{children}</p>,
  ul: bulleted,
};

const PREVIEW: Components = {
  p: ({ children }) => <p data-parity="p1">{children}</p>,
  ul: bulleted,
};

/** A stage doc rendered as Markdown, its frontmatter and comments dropped.
    `preview` keeps only its opening paragraph and first list. */
export function StageDocText({
  text,
  preview = false,
}: {
  text: string;
  preview?: boolean;
}) {
  return (
    <GateContext
      text={preview ? docPreview(text) : stageDocBody(text)}
      className={preview ? `${classes.doc} ${classes.preview}` : classes.doc}
      components={preview ? PREVIEW : FULL}
    />
  );
}

const isSha = (s: string) => /^[0-9a-f]{8,}$/i.test(s);

function StageDocBody({
  repo,
  runId,
  stage,
}: {
  repo: string;
  runId: string;
  stage: string;
}) {
  const query = useStageDoc(repo, runId, stage);
  if (query.isPending) return <Skeleton height={200} />;
  if (query.isError)
    return (
      <Text fz="lg" lh="normal" c="dimmed">
        {(query.error as Error).message}
      </Text>
    );
  if (query.data === null)
    return (
      <Text fz="lg" lh="normal" c="dimmed" data-testid="stage-doc-no-doc">
        No doc at this version.
      </Text>
    );
  return <StageDocText text={query.data.text} />;
}

function useDocSource(repo: string, runId: string, stage: string | null) {
  const doc = useStageDoc(repo, runId, stage).data;
  const packs = useEffectiveInputs(repo, runId).data?.packVersions ?? null;
  if (!doc?.pack) return null;
  const sha = doc.sha ? (isSha(doc.sha) ? doc.sha.slice(0, 7) : doc.sha) : '';
  const row = packs?.find(p => p.pack === doc.pack);
  return [
    sha ? `${doc.pack} @ ${sha}` : doc.pack,
    row ? packState(row).label : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The one stage doc surface, for the story's "Stage doc" link and the
    inputs' "Open the full doc". */
export function StageDocDrawer({
  repo,
  runId,
}: {
  repo: string;
  runId: string;
}) {
  const { stage, close } = useStageDocDrawer();
  const source = useDocSource(repo, runId, stage);
  return (
    <Drawer
      opened={stage !== null}
      onClose={close}
      position="right"
      size={640}
      padding={24}
      classNames={{ header: drawer.header, body: drawer.body }}
      title={
        <Stack gap={2}>
          <Text fz="xl" fw={700} lh="normal" data-parity="t">
            {stage} · stage doc
          </Text>
          {source ? (
            <Text fz="md" lh="normal" c="dimmed" data-parity="s">
              {source}
            </Text>
          ) : null}
        </Stack>
      }
      attributes={{
        content: {
          'data-parity': 'Stage doc drawer',
          'data-testid': 'stage-doc-drawer',
        },
        header: { 'data-parity': 'head' },
        close: { 'data-parity': 'x' },
        body: { 'data-parity': 'doc' },
      }}
    >
      {stage ? <StageDocBody repo={repo} runId={runId} stage={stage} /> : null}
    </Drawer>
  );
}

/** The "Stage doc" link in an opened stage row's head. */
export function StageDocLink({
  stage,
  className,
}: {
  stage: string;
  className?: string;
}) {
  const { open } = useStageDocDrawer();
  return (
    <Anchor
      component="button"
      type="button"
      fz="md"
      fw={500}
      lh="normal"
      c="accent"
      className={className}
      onClick={e => {
        e.stopPropagation();
        open(stage);
      }}
      aria-label={`stage doc for ${stage}`}
      data-parity="doc"
    >
      Stage doc
    </Anchor>
  );
}
