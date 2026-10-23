import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Center,
  Code,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { BlockSidebar } from '../blocks/BlockSidebar';
import { BlockStage } from '../blocks/BlockStage';
import { useAnatomy, usePendingChanges } from '../useWiring';
import { FocusHeader, kindOf, statusOf } from './FocusHeader';
import { GraphSidebar } from './FocusList';
import classes from './graph.module.css';
import { layoutTemplate } from './layout/templateLayout';
import { focusUnder, workTypeOf, type FocusItem } from './model/focusModel';
import { buildTemplateView } from './model/templateModel';
import { useGraphFocus } from './useGraphFocus';

const TemplateCanvas = lazy(() => import('./TemplateCanvas'));

/** An element's bottom edge within the stage it is positioned in, kept
    current as it resizes. */
function useBottomInStage() {
  const [bottom, setBottom] = useState(0);
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const measure = () => setBottom(element.offsetTop + element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, bottom };
}

/** rt's failure text with the command it suggests (its `next:` line) set
    apart, so the command reads as one to run. */
function FailureText({ message }: { message: string }) {
  const [said, next] = message.split(/\n\s*next:\s*/);
  return (
    <>
      <Text size="sm" data-testid="canvas-error-message">
        {said}
      </Text>
      {next && <Code data-testid="canvas-error-next">{next.trim()}</Code>}
    </>
  );
}

/** A focused pipeline opens the map between skills; any other focus opens
    that skill's block view. */
export function opensBlockView(
  focused: FocusItem | null,
  pipeline: FocusItem | null
): focused is FocusItem {
  return focused !== null && focused.key !== pipeline?.key;
}

/** The pipeline's template canvas, linking out to each stage, under its
    header. */
function PipelineMap({ pack, height }: { pack: string; height: string }) {
  const {
    url,
    patch,
    compositionQuery,
    checkQuery,
    groups,
    focused,
    pipeline,
  } = useGraphFocus(pack);
  const composition = compositionQuery.data;
  const anatomyQuery = useAnatomy(pack, focused?.skill ?? null);
  const changesQuery = usePendingChanges(pack);

  const anatomy = anatomyQuery.data;
  const check = checkQuery.data;
  const changes = changesQuery.data;
  const workType = pipeline ? workTypeOf(pipeline.key) : null;
  const step = focused?.step ?? null;

  const view = useMemo(() => {
    if (!anatomy || !composition) return null;
    const known =
      workType !== null && Object.hasOwn(composition.pipelines ?? {}, workType);
    return buildTemplateView({
      anatomy,
      composition,
      check,
      changes,
      step,
      workType: known ? workType : null,
    });
  }, [anatomy, composition, check, changes, step, workType]);
  const layout = useMemo(() => (view ? layoutTemplate(view) : null), [view]);
  const onSelect = useCallback((select: string) => patch({ select }), [patch]);
  const focusOf = useCallback(
    (skill: string) => focusUnder(pipeline, skill),
    [pipeline]
  );
  const header = useBottomInStage();

  return (
    <Box
      className={classes.stage}
      h={height}
      bg="var(--tk-bg)"
      data-parity="Stage"
    >
      {focused && anatomyQuery.isError && !anatomy && (
        <Center className={classes.canvasError}>
          <Alert
            variant="light"
            color="bad"
            title="This skill failed to load"
            icon={<Icon name="warning" size={16} />}
            classNames={{ root: classes.canvasErrorAlert }}
            data-testid="canvas-error"
          >
            <Stack gap="xs" align="flex-start">
              <FailureText message={(anatomyQuery.error as Error).message} />
              <Button
                variant="outline"
                color="bad"
                size="compact-sm"
                loading={anatomyQuery.isFetching}
                onClick={() => void anatomyQuery.refetch()}
              >
                Retry
              </Button>
            </Stack>
          </Alert>
        </Center>
      )}
      {view && layout && (
        <Suspense fallback={null}>
          <TemplateCanvas
            key={view.skill}
            layout={layout}
            view={view}
            height={height}
            headerBottom={focused ? header.bottom : 0}
            focusOf={focusOf}
            onSelect={onSelect}
          />
        </Suspense>
      )}
      {focused ? (
        <FocusHeader
          ref={header.ref}
          title={focused.step !== null ? focused.label : focused.skill}
          kind={kindOf(focused, pipeline)}
          description={anatomy?.description ?? null}
          loading={anatomyQuery.isPending}
          status={statusOf(view, anatomy)}
          checkError={
            checkQuery.isError && !check
              ? (checkQuery.error as Error).message
              : null
          }
        />
      ) : (
        groups &&
        url.focus && (
          <Text
            size="sm"
            className={classes.header}
            data-testid="focus-missing"
          >
            Nothing named {url.focus} is in this pack.
          </Text>
        )
      )}
    </Box>
  );
}

/** The focus list beside the map; the block tree once a skill is named in
    the URL. With no focus named, the list stays, so "All skills" always
    lands back on it. */
export function GraphTabSidebar({ pack }: { pack: string }) {
  const { url, focused, pipeline } = useGraphFocus(pack);
  if (url.focus !== null && opensBlockView(focused, pipeline)) {
    return <BlockSidebar key={focused.key} pack={pack} />;
  }
  return <GraphSidebar pack={pack} />;
}

/** The Graph tab's stage: a focused pipeline's map, or a focused skill's
    block view. */
export function GraphTab({ pack, height }: { pack: string; height: string }) {
  const { focused, pipeline } = useGraphFocus(pack);
  if (opensBlockView(focused, pipeline)) {
    return <BlockStage pack={pack} height={height} focused={focused} />;
  }
  return <PipelineMap pack={pack} height={height} />;
}
