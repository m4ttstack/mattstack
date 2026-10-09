import { Button, PageShell, Stack, Text } from '@mattstack/app-kit/core';
import { Link } from 'wouter';

import classes from './NotFoundPage.module.css';

/** Rendered for any path the route table doesn't recognize. */
export function NotFoundPage() {
  return (
    <PageShell>
      <PageShell.Main>
        <PageShell.Content bg="var(--tk-panel)" contentContainer={false}>
          <div className={classes.page} data-parity="Not found">
            <Stack align="center" gap={8} ta="center">
              <Text fz={18} fw={700} lh="normal" data-parity="h">
                Nothing at this address
              </Text>
              <Text fz={13} lh="normal" c="dimmed" data-parity="p">
                The link may be from an older console, or the run was pruned
                after 30 days.
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
