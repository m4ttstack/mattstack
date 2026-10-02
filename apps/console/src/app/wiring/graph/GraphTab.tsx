import { lazy, Suspense, useCallback, useMemo } from 'react';
import { Box, Text } from '@mattstack/app-kit/core';

import { useAnatomy, usePendingChanges } from '../useWiring';
import { FocusHeader, kindOf, statusOf } from './FocusHeader';
import classes from './graph.module.css';
import { layoutTemplate } from './layout/templateLayout';
import { workTypeOf } from './model/focusModel';
import { buildTemplateView } from './model/templateModel';
import { useGraphFocus } from './useGraphFocus';

const TemplateCanvas = lazy(() => import('./TemplateCanvas'));

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

  return (
    <Box
      className={classes.stage}
      h={height}
      bg="var(--tk-bg)"
      data-parity="Stage"
    >
      {view && layout && (
        <Suspense fallback={null}>
          <TemplateCanvas
            key={view.skill}
            layout={layout}
            view={view}
            height={height}
            onSelect={onSelect}
          />
        </Suspense>
      )}
      {focused ? (
        <FocusHeader
          title={focused.step !== null ? focused.label : focused.skill}
          kind={kindOf(focused, pipeline)}
          description={anatomy?.description ?? null}
          loading={anatomyQuery.isPending}
          status={statusOf(view, anatomy)}
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
