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

import { useAnatomy, usePendingChanges } from '../useWiring';
import {
  DRAWER_WIDTH,
  selectedContent,
  SkillDrawer,
} from './drawer/SkillDrawer';
import { FocusHeader, kindOf, statusOf } from './FocusHeader';
import classes from './graph.module.css';
import { layoutTemplate } from './layout/templateLayout';
import { workTypeOf } from './model/focusModel';
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

/** The Graph tab's stage: the focused skill's header over its canvas. */
export function GraphTab({ pack, height }: { pack: string; height: string }) {
  const {
    url,
    patch,
    compositionQuery,
    checkQuery,
    groups,
    focused,
    pipeline,
  } = useGraphFocus(pack);
  const anatomyQuery = useAnatomy(pack, focused?.skill ?? null);
  const changesQuery = usePendingChanges(pack);

  const composition = compositionQuery.data;
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
  const drawerOpen = useMemo(
    () => selectedContent(url, view, anatomy) !== null,
    [url, view, anatomy]
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
              <Text size="sm">{(anatomyQuery.error as Error).message}</Text>
              <Button
                variant="default"
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
            cover={drawerOpen ? DRAWER_WIDTH : 0}
            headerBottom={focused ? header.bottom : 0}
            onSelect={onSelect}
          />
        </Suspense>
      )}
      <SkillDrawer
        pack={pack}
        view={view}
        anatomy={anatomy}
        composition={composition}
        check={check}
        groups={groups}
        pipeline={pipeline}
        url={url}
        setUrl={patch}
      />
      {focused ? (
        <FocusHeader
          ref={header.ref}
          title={focused.step !== null ? focused.label : focused.skill}
          kind={kindOf(focused, pipeline)}
          description={anatomy?.description ?? null}
          loading={anatomyQuery.isPending}
          status={statusOf(view, anatomy)}
          checkError={
            checkQuery.isError ? (checkQuery.error as Error).message : null
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
