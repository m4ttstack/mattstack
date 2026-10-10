import { Button, PageShell, Stack, Text } from '@mattstack/app-kit/core';
import { Link } from 'wouter';

import classes from './NotFoundPage.module.css';
import { useRunsPruneDays } from './runs/useRuns';

/** Why an address can be empty, naming rt's prune window once it is known. */
export function notFoundReason(days: number | undefined): string {
  const pruned =
    days === undefined
      ? 'the run was pruned'
      : `the run was pruned after ${days} day${days === 1 ? '' : 's'}`;
  return `The link may be from an older console, or ${pruned}.`;
}

/** Rendered for any path the route table doesn't recognize. */
export function NotFoundPage() {
  const days = useRunsPruneDays().data;
  return (
    <PageShell>
      <PageShell.Main>
        <PageShell.Content contentContainer={false}>
          <div className={classes.page} data-parity="Not found">
            <Stack align="center" gap={8} ta="center">
              <Text fz="h2" fw={700} lh="normal" data-parity="h">
                Nothing at this address
              </Text>
              <Text fz="lg" lh="normal" c="dimmed" data-parity="p">
                {notFoundReason(days)}
              </Text>
              <Button component={Link} href="/" data-parity="btn">
                <span data-parity="l">Back to runs</span>
              </Button>
            </Stack>
          </div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
