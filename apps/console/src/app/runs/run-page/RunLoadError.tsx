import {
  Button,
  Group,
  Paper,
  Stack,
  Text,
  ThemeIcon,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { Link } from 'wouter';

import { ApiError, isNotFound } from '../useRuns';
import classes from './RunLoadError.module.css';

const sentence = (text: string) => text.trim().replace(/\.$/, '');

function copyFor(error: Error, name: string, runId: string) {
  if (isNotFound(error))
    return {
      title: `No run ${runId} in this repo`,
      body: 'rt has no run with this id. Old runs are pruned, so a link can outlive its run.',
    };
  if (error instanceof ApiError && error.status >= 500)
    return {
      title: `Couldn't load ${name}`,
      body: `The rt daemon didn't answer (${sentence(error.message)}). The run itself is fine; this page just can't read it right now.`,
    };
  return {
    title: `Couldn't load ${name}`,
    body: `${sentence(error.message)}.`,
  };
}

export interface RunLoadErrorProps {
  error: Error;
  /** The run's name in the breadcrumb: its ticket when known, else its id. */
  name: string;
  runId: string;
  onRetry: () => void;
}

/** Why a run page could not load, with Retry and the way back to the runs. */
export function RunLoadError({
  error,
  name,
  runId,
  onRetry,
}: RunLoadErrorProps) {
  const { title, body } = copyFor(error, name, runId);
  return (
    <div
      className={classes.mid}
      data-testid="run-load-error"
      data-parity="Run load error"
    >
      <Paper
        variant="ground"
        withBorder
        radius={12}
        className={classes.card}
        role="alert"
        data-parity="card"
      >
        <Stack gap={10}>
          <ThemeIcon
            variant="light"
            color="bad"
            radius="xl"
            size={32}
            data-parity="ic"
          >
            <Icon name="circleAlert" size={16} data-parity="i" />
          </ThemeIcon>
          <Text fz={16} fw={700} lh="normal" data-parity="h">
            {title}
          </Text>
          <Text fz={13} lh={1.55} c="dimmed" data-parity="p">
            {body}
          </Text>
          <Group gap={8} className={classes.btns}>
            <Button onClick={onRetry} data-parity="btn Retry">
              <span data-parity="l">Retry</span>
            </Button>
            <Button
              variant="default"
              component={Link}
              href="/"
              data-parity="btn Back to runs"
            >
              <span data-parity="l">Back to runs</span>
            </Button>
          </Group>
        </Stack>
      </Paper>
    </div>
  );
}
