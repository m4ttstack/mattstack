import type { Ref } from 'react';
import {
  Alert,
  Badge,
  Group,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { pluginOf } from '../outline';
import type { SkillsAnatomy } from '../useWiring';
import classes from './graph.module.css';
import { workTypeOf, type FocusItem } from './model/focusModel';
import { STATUS_TONE, type StatusTone } from './model/statusTone';
import { countOf, type TemplateView } from './model/templateModel';

const MUTED = 'var(--tk-text-3)';

export type HeaderStatus = {
  label: string;
  tone: StatusTone;
  icon: 'checkCircle' | 'circleDot';
};

const GLYPH: Record<StatusTone, string | undefined> = {
  ok: 'var(--tk-text-ok-vivid)',
  quiet: MUTED,
  warn: undefined,
};

/** What kind of skill is in focus, and where it runs. */
export function kindOf(item: FocusItem, pipeline: FocusItem | null): string {
  const workType = pipeline ? workTypeOf(pipeline.key) : null;
  if (pipeline && workType && item.key === pipeline.key)
    return `${workType} pipeline · ${countOf(pipeline.children.length, 'stage', 'stages')}`;
  if (pipeline && workType && item.step !== null)
    return `stage ${item.step} of ${pipeline.children.length} · ${pipeline.skill} · ${workType}`;
  if (item.icon === 'layoutDashboard') return 'board skill';
  return item.icon === 'lock' ? 'internal verb' : 'public verb';
}

/**
 * The status of the rendered file the canvas draws. A view that links to its
 * steps draws no rendered file of its own, so it states none: each step card
 * carries its own.
 */
export function statusOf(
  view: TemplateView | null,
  anatomy: SkillsAnatomy | undefined
): HeaderStatus | null {
  const output = view?.output;
  if (!output || !anatomy) return null;
  const tone = STATUS_TONE[output.status];
  const icon = tone === 'ok' ? 'checkCircle' : 'circleDot';
  switch (output.status) {
    case 'in-sync':
      return {
        label: `in sync with installed ${pluginOf(anatomy.template.ref)} ${anatomy.template.version}`,
        tone,
        icon,
      };
    case 'stale':
      return {
        label: output.reason ? `stale: ${output.reason}` : 'stale',
        tone,
        icon,
      };
    case 'unsynced':
      return { label: 'rebuilt here, not synced yet', tone, icon };
    case 'never-compiled':
      return { label: 'never compiled', tone, icon };
    case 'unknown':
      return { label: 'unmeasured', tone, icon };
  }
}

export function FocusHeader({
  ref,
  title,
  kind,
  description,
  loading,
  status,
  checkError = null,
}: {
  ref?: Ref<HTMLDivElement>;
  title: string;
  kind: string;
  description: string | null;
  loading: boolean;
  status: HeaderStatus | null;
  /** Why `rt skills check` failed; the status it would have given is then
      unknown, so none is drawn. */
  checkError?: string | null;
}) {
  return (
    <Stack
      ref={ref}
      gap={6}
      className={classes.header}
      data-parity="Focus header"
      data-testid="focus-header"
    >
      <Group gap={10} justify="space-between">
        <Group gap={10}>
          <Title order={3} fz={20} lh="normal">
            <Text span inherit c="var(--tk-text-1)" data-parity="title">
              {title}
            </Text>
          </Title>
          <Badge
            variant="quiet"
            classNames={{ root: classes.pill }}
            data-parity="badge"
            attributes={{ label: { 'data-parity': 'l' } }}
          >
            {kind}
          </Badge>
        </Group>
        {status && checkError === null && (
          <Badge
            variant={status.tone === 'warn' ? 'hue-outline' : 'quiet-outline'}
            color={status.tone === 'warn' ? 'warn' : undefined}
            classNames={{ root: classes.statusPill, section: classes.pillIcon }}
            leftSection={
              <Icon
                name={status.icon}
                size={12}
                color={GLYPH[status.tone]}
                data-parity="i"
              />
            }
            data-parity="status · engine behind"
            data-testid="focus-status"
            attributes={{ label: { 'data-parity': 'l' } }}
          >
            {status.label}
          </Badge>
        )}
      </Group>
      {description ? (
        <Text fz={13} lh="normal" c={MUTED} data-parity="desc">
          {description}
        </Text>
      ) : (
        loading && <Skeleton height={16} width={420} />
      )}
      {checkError !== null && (
        <Alert
          variant="light"
          color="warn"
          icon={<Icon name="warning" size={14} />}
          classNames={{ root: classes.statusAlert }}
          data-testid="status-unavailable"
        >
          <Text size="xs">Status unavailable: {checkError}</Text>
        </Alert>
      )}
    </Stack>
  );
}
