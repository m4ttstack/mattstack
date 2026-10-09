import {
  ActionIcon,
  Anchor,
  Group,
  Skeleton,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { useQuery } from '@tanstack/react-query';

import { client } from '../api';
import { useEditorHref } from '../editorHref';
import classes from './FailureExcerpt.module.css';

export interface FailureExcerptProps {
  repo: string;
  runId: string;
  detailPath: string;
}

/** Thrown for the 403 case specifically, so the render branch can tell
    "outside every allowed root" apart from a genuine fetch failure and word
    each one honestly instead of surfacing a raw status string. */
class ArtifactOutsideRunError extends Error {}

/**
 * The spec's one concession to a log surface: a bounded, one-shot excerpt.
 * No `refetchInterval`, no follow, no auto-scroll -- adding any of those
 * reopens a decision the spec already made against a log viewer.
 */
export function FailureExcerpt({
  repo,
  runId,
  detailPath,
}: FailureExcerptProps) {
  const editorHref = useEditorHref();

  const query = useQuery({
    queryKey: ['artifact', repo, runId, detailPath],
    queryFn: async () => {
      const res = await client.api.runs[':repo'][':runId'].artifact.$get({
        param: { repo, runId },
        query: { path: detailPath },
      });
      if (res.status === 403) throw new ArtifactOutsideRunError();
      if (!res.ok) throw new Error(`artifact read failed: ${res.status}`);
      return res.json();
    },
  });

  if (query.isPending) {
    return (
      <Skeleton
        height={40}
        className={classes.grow}
        data-testid="failure-excerpt-loading"
      />
    );
  }

  if (query.isError) {
    const outsideRun = query.error instanceof ArtifactOutsideRunError;
    return (
      <Group
        gap="xs"
        wrap="nowrap"
        className={classes.grow}
        data-testid="failure-excerpt-error"
      >
        <Text fz={12.5} lh="18px" c="bad">
          {outsideRun
            ? 'This artifact lives outside the run directory.'
            : `Could not load ${detailPath}: ${(query.error as Error).message}`}
        </Text>
        <Anchor href={editorHref(detailPath)} fz={12.5} lh="18px">
          open full artifact in editor
        </Anchor>
      </Group>
    );
  }

  const { lines, truncated } = query.data;

  return (
    <div
      className={classes.excerpt}
      data-testid="failure-excerpt"
      data-parity="excerpt"
    >
      <Text
        ff="monospace"
        fz={11.5}
        lh="17px"
        c="dimmed"
        className={classes.lines}
        data-parity="x"
      >
        {lines.length === 0 ? 'no artifact recorded' : lines.join('\n')}
      </Text>
      <Tooltip
        label={
          truncated
            ? `Last ${lines.length} lines. Open the full artifact in your editor`
            : 'Open the full artifact in your editor'
        }
      >
        <ActionIcon
          component="a"
          href={editorHref(detailPath)}
          variant="subtle"
          color="gray"
          size="sm"
          className={classes.open}
          aria-label="open full artifact in editor"
        >
          <Icon name="externalLink" size={13} />
        </ActionIcon>
      </Tooltip>
    </div>
  );
}
