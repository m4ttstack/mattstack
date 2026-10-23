import { useMemo } from 'react';
import {
  Alert,
  Box,
  Button,
  Skeleton,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { FocusHeader, kindOf, statusOf } from '../graph/FocusHeader';
import { workTypeOf, type FocusItem } from '../graph/model/focusModel';
import { buildTemplateView } from '../graph/model/templateModel';
import { useGraphFocus } from '../graph/useGraphFocus';
import { useAnatomy, usePendingChanges } from '../useWiring';
import classes from './blocks.module.css';
import { BlockView, type SkillHeader } from './BlockView';
import { useSkillBlocks } from './useSkillBlocks';

/** The Graph tab's stage for a focused skill or stage: its block view, or
    while that loads or cannot, the skill's header over a line saying why. */
export function BlockStage({
  pack,
  height,
  focused,
}: {
  pack: string;
  height: string;
  focused: FocusItem;
}) {
  const { url, patch, compositionQuery, checkQuery, groups, pipeline } =
    useGraphFocus(pack);
  const composition = compositionQuery.data;
  const check = checkQuery.data;
  const board = focused.icon === 'layoutDashboard';
  const anatomyQuery = useAnatomy(pack, board ? null : focused.skill);
  const changes = usePendingChanges(pack).data;
  const anatomy = anatomyQuery.data;
  const skill = useSkillBlocks(pack, focused, composition);

  const view = useMemo(() => {
    if (!anatomy || !composition) return null;
    const workType = pipeline ? workTypeOf(pipeline.key) : null;
    const known =
      workType !== null && Object.hasOwn(composition.pipelines ?? {}, workType);
    return buildTemplateView({
      anatomy,
      composition,
      check,
      changes,
      step: focused.step,
      workType: known ? workType : null,
    });
  }, [anatomy, composition, check, changes, focused.step, pipeline]);

  const header: SkillHeader = {
    title: focused.step !== null ? focused.label : focused.skill,
    kind: kindOf(focused, pipeline),
    description:
      anatomy?.description ??
      composition?.verbs.find(verb => verb.name === focused.skill)
        ?.description ??
      null,
    status: statusOf(view, anatomy),
    checkError:
      checkQuery.isError && !check ? (checkQuery.error as Error).message : null,
    loading: !board && anatomyQuery.isPending,
  };

  return (
    <Box
      className={classes.page}
      h={height}
      bg="var(--tk-bg)"
      data-testid="block-stage"
    >
      {skill.state === 'ready' ? (
        <BlockView
          key={focused.key}
          pack={pack}
          payload={skill.payload}
          url={url}
          patch={patch}
          readOnly={skill.readOnly}
          renderedPath={skill.renderedPath}
          skill={header}
          context={
            composition && groups
              ? {
                  composition,
                  check,
                  groups,
                  pipeline,
                  anatomy,
                  anatomyError:
                    !board && anatomyQuery.isError
                      ? (anatomyQuery.error as Error).message
                      : null,
                  onFocus: focus => patch({ focus }),
                }
              : null
          }
        />
      ) : (
        <Stack gap={16} className={classes.layout} data-rail="none">
          <FocusHeader inline {...header} />
          {skill.state === 'loading' && (
            <Stack gap={8} data-testid="block-view-loading">
              <Skeleton height={18} width="60%" />
              <Skeleton height={120} />
            </Stack>
          )}
          {skill.state === 'note' && (
            <Text fz={13} c="dimmed" data-testid="block-view-note">
              {skill.message}
            </Text>
          )}
          {skill.state === 'error' && (
            <Alert
              variant="light"
              color="bad"
              title="This skill's blocks failed to load"
              icon={<Icon name="warning" size={16} />}
              data-testid="block-view-error"
            >
              <Stack gap="xs" align="flex-start">
                <Text size="sm">{skill.message}</Text>
                <Button
                  variant="outline"
                  color="bad"
                  size="compact-sm"
                  loading={skill.retrying}
                  onClick={skill.retry}
                >
                  Retry
                </Button>
              </Stack>
            </Alert>
          )}
        </Stack>
      )}
    </Box>
  );
}
