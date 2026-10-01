import { useMemo } from 'react';
import { Box, Text } from '@mattstack/app-kit/core';

import { useAnatomy, usePendingChanges } from '../useWiring';
import { FocusHeader, kindOf, statusOf } from './FocusHeader';
import classes from './graph.module.css';
import { workTypeOf } from './model/focusModel';
import { buildTemplateView } from './model/templateModel';
import { useGraphFocus } from './useGraphFocus';

/** The Graph tab's stage: the focused skill's header over its canvas. */
export function GraphTab({ pack, height }: { pack: string; height: string }) {
  const { url, compositionQuery, checkQuery, groups, focused, pipeline } =
    useGraphFocus(pack);
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

  return (
    <Box className={classes.stage} h={height} data-parity="Stage">
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
