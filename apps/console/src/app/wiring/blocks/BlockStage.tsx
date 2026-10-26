import { useMemo } from 'react';
import {
  Alert,
  Anchor,
  Box,
  Button,
  Code,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { StepLoader, useHeldLoading } from '../../StepLoader';
import { FailureText } from '../FailureText';
import { FocusHeader, statusOf } from '../graph/FocusHeader';
import { workTypeOf, type FocusItem } from '../graph/model/focusModel';
import { buildTemplateView } from '../graph/model/templateModel';
import { useGraphFocus } from '../graph/useGraphFocus';
import { useAnatomy, usePendingChanges } from '../useWiring';
import classes from './blocks.module.css';
import { BlockView, type SkillHeader } from './BlockView';
import { skillKindOf } from './skillKind';
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
  const held = useHeldLoading(skill.state === 'loading');

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
    kind: skillKindOf(focused, pipeline),
    description:
      anatomy?.description ??
      composition?.verbs.find(verb => verb.name === focused.skill)
        ?.description ??
      null,
    // A green in-sync badge beside the stale-plugin note reads as two answers.
    status:
      skill.state === 'stale' && view?.output?.status === 'in-sync'
        ? null
        : statusOf(view, anatomy),
    checkError:
      checkQuery.isError && !check ? (checkQuery.error as Error).message : null,
    loading: !board && anatomyQuery.isPending,
    version: anatomy?.template.version ?? null,
  };

  return (
    <Box
      className={classes.page}
      h={height}
      bg="var(--tk-card)"
      data-testid="block-stage"
    >
      {skill.state === 'ready' && !held ? (
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
          <FocusHeader
            inline
            title={header.title}
            kind={header.kind}
            description={header.description}
            status={header.status}
            checkError={header.checkError}
            loading={header.loading}
          />
          {held && (
            <StepLoader
              testId="block-view-loading"
              steps={[
                board
                  ? 'reading its SKILL.md'
                  : `rt skills blocks --skill ${focused.skill}`,
              ]}
            />
          )}
          {!held && skill.state === 'note' && (
            <Text fz={13} c="dimmed" data-testid="block-view-note">
              {skill.message}
            </Text>
          )}
          {!held && skill.state === 'refused' && (
            <Alert
              variant="light"
              color="warn"
              title="rt won't build this skill"
              icon={<Icon name="warning" size={16} />}
              data-testid="block-view-refused"
            >
              <Stack gap="xs" align="flex-start">
                <FailureText
                  message={skill.message}
                  testId="block-view-refused"
                />
                <Anchor
                  component="button"
                  type="button"
                  size="sm"
                  onClick={() => patch({ tab: 'health' })}
                >
                  Open Health
                </Anchor>
              </Stack>
            </Alert>
          )}
          {!held && skill.state === 'stale' && (
            <Alert
              variant="light"
              color="warn"
              title="Update the mattstack plugin"
              icon={<Icon name="warning" size={16} />}
              data-testid="block-view-stale"
            >
              <Text size="sm">
                The installed mattstack plugin is older than this app. Update it
                with <Code>claude plugin update mattstack@mattstack</Code>, then
                reload this page.
              </Text>
            </Alert>
          )}
          {!held && skill.state === 'error' && (
            <Alert
              variant="light"
              color="bad"
              title="This skill's blocks failed to load"
              icon={<Icon name="warning" size={16} />}
              data-testid="block-view-error"
            >
              <Stack gap="xs" align="flex-start">
                <FailureText
                  message={skill.message}
                  testId="block-view-error"
                />
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
