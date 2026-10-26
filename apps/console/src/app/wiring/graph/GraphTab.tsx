import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Center,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { loadSteps, StepLoader, useStepLoading } from '../../StepLoader';
import { BlockSidebar } from '../blocks/BlockSidebar';
import { BlockStage } from '../blocks/BlockStage';
import { FailureText } from '../FailureText';
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

/** A focused pipeline opens the map between skills, and its orchestrator's
    block view once the URL names a block; any other focus opens that
    skill's block view. */
export function opensBlockView(
  focused: FocusItem | null,
  pipeline: FocusItem | null,
  block: string | null = null
): focused is FocusItem {
  return focused !== null && (focused.key !== pipeline?.key || block !== null);
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
  // Every section starts folded; ids are block ids, so they never clash
  // between skills.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const onToggle = useCallback(
    (section: string) =>
      setOpen(current => {
        const next = new Set(current);
        if (!next.delete(section)) next.add(section);
        return next;
      }),
    []
  );
  const layout = useMemo(
    () => (view ? layoutTemplate(view, open) : null),
    [view, open]
  );
  const onSelect = useCallback((select: string) => patch({ select }), [patch]);
  const focusOf = useCallback(
    (skill: string) => focusUnder(pipeline, skill),
    [pipeline]
  );
  const header = useBottomInStage();
  const failed =
    (compositionQuery.isError && !composition) ||
    (anatomyQuery.isError && !anatomy);
  const { show: held, bind: heldBind } = useStepLoading(
    focused !== null && !failed && !(view && layout)
  );

  return (
    <Box
      className={classes.stage}
      h={height}
      bg="var(--tk-bg)"
      data-parity="Stage"
    >
      {compositionQuery.isError && !composition && (
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
              <FailureText
                message={(anatomyQuery.error as Error).message}
                testId="canvas-error"
              />
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
      {held && focused && (
        <div className={classes.canvasLoading}>
          <StepLoader
            {...heldBind}
            placement="centre"
            testId="canvas-loading"
            steps={loadSteps([
              {
                step: `rt skills composition --pack ${pack}`,
                done: Boolean(composition),
              },
              {
                step: `rt skills anatomy --skill ${focused.skill}`,
                done: Boolean(anatomy),
              },
            ])}
          />
        </div>
      )}
      {!held && view && layout && (
        <Suspense fallback={null}>
          <TemplateCanvas
            key={view.skill}
            layout={layout}
            view={view}
            height={height}
            headerBottom={focused ? header.bottom : 0}
            focusOf={focusOf}
            focusKey={focused?.key ?? null}
            onSelect={onSelect}
            open={open}
            onToggle={onToggle}
          />
        </Suspense>
      )}
      {focused ? (
        <FocusHeader
          ref={header.ref}
          title={focused.step !== null ? focused.label : focused.skill}
          kind={kindOf(focused, pipeline)}
          description={anatomy?.description ?? null}
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
  if (url.focus !== null && opensBlockView(focused, pipeline, url.block)) {
    return <BlockSidebar key={focused.key} pack={pack} />;
  }
  return <GraphSidebar pack={pack} />;
}

/** The Graph tab's stage: a focused pipeline's map, or a focused skill's
    block view. */
export function GraphTab({ pack, height }: { pack: string; height: string }) {
  const { url, focused, pipeline } = useGraphFocus(pack);
  if (opensBlockView(focused, pipeline, url.block)) {
    return <BlockStage pack={pack} height={height} focused={focused} />;
  }
  return <PipelineMap pack={pack} height={height} />;
}
