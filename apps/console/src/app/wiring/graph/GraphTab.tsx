import {
  Alert,
  Box,
  Button,
  Center,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { BlockSidebar } from '../blocks/BlockSidebar';
import { BlockStage } from '../blocks/BlockStage';
import { useReportReady } from '../contentReady';
import { FailureText } from '../FailureText';
import { GraphSidebar } from './FocusList';
import classes from './graph.module.css';
import { useGraphFocus } from './useGraphFocus';

/** The stage before a skill stands in focus: the pack's load error, or a
    focus the URL names that the pack does not have. */
function NoFocus({ pack, height }: { pack: string; height: string }) {
  const { url, compositionQuery, groups } = useGraphFocus(pack);
  const composition = compositionQuery.data;
  const failed = compositionQuery.isError && !composition;
  useReportReady(failed || Boolean(groups));

  return (
    <Box
      className={classes.stage}
      h={height}
      bg="var(--tk-bg)"
      data-parity="Stage"
    >
      {failed && (
        <Center className={classes.canvasError}>
          <Alert
            variant="light"
            color="bad"
            title="This pack's skills failed to load"
            icon={<Icon name="warning" size={16} />}
            classNames={{ root: classes.canvasErrorAlert }}
            data-testid="pack-error"
          >
            <Stack gap="xs" align="flex-start">
              <FailureText
                message={(compositionQuery.error as Error).message}
                testId="pack-error"
              />
              <Button
                variant="outline"
                color="bad"
                size="compact-sm"
                loading={compositionQuery.isFetching}
                onClick={() => void compositionQuery.refetch()}
              >
                Retry
              </Button>
            </Stack>
          </Alert>
        </Center>
      )}
      {groups && url.focus && (
        <Text size="sm" className={classes.header} data-testid="focus-missing">
          Nothing named {url.focus} is in this pack.
        </Text>
      )}
    </Box>
  );
}

/** The focus list beside the map; the block tree once a skill is named in
    the URL. With no focus named, the list stays, so "All skills" always
    lands back on it. */
export function GraphTabSidebar({ pack }: { pack: string }) {
  const { url, focused } = useGraphFocus(pack);
  if (url.focus !== null && focused) {
    return <BlockSidebar key={focused.key} pack={pack} />;
  }
  return <GraphSidebar pack={pack} />;
}

/** The Overview tab's stage: a focused skill's block view, a pipeline's
    own included; the first pipeline stands in when the URL names none. */
export function GraphTab({ pack, height }: { pack: string; height: string }) {
  const { focused } = useGraphFocus(pack);
  if (focused) {
    return <BlockStage pack={pack} height={height} focused={focused} />;
  }
  return <NoFocus pack={pack} height={height} />;
}
